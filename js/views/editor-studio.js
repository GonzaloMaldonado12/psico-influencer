// Biblioteca del editor (solo PC): transiciones, efectos, sonidos, formas, textos animados y fuentes.
import { h, toast, slider, segmented, toggle, pickFile, confirmDialog } from '../lib/dom.js';
import { addMedia, mediaUrl, deleteMedia } from '../store.js';
import { decodeAudio } from '../core/media.js';
import { libraryItems, addLibraryFile, loading } from './editor-pro.js';
import { fmtTime, uid, clamp } from '../lib/util.js';
import { TRANSITIONS, TRANSITION_CATS, EFFECTS, EFFECT_CATS, SHAPES } from '../core/fx-lib.js';
import { SFX_KINDS, loadSfx, sfxBuffer, sfxLabel } from '../core/sfx.js';
import { FONTS } from '../core/captions.js';
import { loadAllFonts } from '../core/fonts.js';
import { segKey } from '../core/render.js';
import { loadGlTransitions } from '../core/gl-transitions.js';
import { panelMaterial } from './material-panel.js';
import { locate } from '../core/timeline.js';

const SUB = [
  ['media', 'Mis medios'],
  ...(typeof window !== 'undefined' && window.psicoDesktop ? [['mat', 'Material']] : []),
  ['trans', 'Transiciones'],
  ['fx', 'Efectos'],
  ['sfx', 'Sonidos'],
  ['shape', 'Formas y textos'],
  ['font', 'Fuentes'],
];

let auditionCtx = null;

const chip = (label, active, onclick, title) => h('button', { class: `lib-chip${active ? ' active' : ''}`, title: title || label, onclick }, label);

function group(title, nodes) {
  return h('div', { class: 'lib-group' }, h('h4', null, title), h('div', { class: 'lb-grid' }, nodes));
}

export function panelLibrary(E) {
  const st = (E.state.lib ||= { sub: 'media', font: 'Todas' });
  const body = {
    media: () => myMedia(E),
    mat: () => panelMaterial(E),
    trans: () => transitions(E),
    fx: () => effects(E),
    sfx: () => sounds(E),
    shape: () => shapes(E),
    font: () => fonts(E),
  }[st.sub]();
  return [
    h('div', { class: 'lib-sub' }, SUB.map(([k, l]) => chip(l, st.sub === k, () => { st.sub = k; E.renderPanel(); }))),
    body,
  ];
}

// ---------- Transiciones ----------
function targetSeg(E) {
  const tl = E.player.tl;
  const i = E.tlSel.seg;
  if (i != null && tl.segs[i]?.type === 'video') return tl.segs[i];
  const { seg } = locate(tl, E.player.t);
  return seg?.type === 'video' ? seg : null;
}

async function previewCut(E, seg) {
  await E.player.seek(Math.max(0, seg.tlStart - 0.4));
  if (!E.player.playing) E.player.toggle();
  setTimeout(() => E.player.playing && E.player.pause(), 1500);
}

function transitions(E) {
  loadGlTransitions();
  const P = E.project;
  P.transitions ||= {};
  const seg = targetSeg(E);
  const own = seg ? P.transitions[segKey(seg)] : null;
  const apply = (kind) => {
    const seg = targetSeg(E); // el cursor pudo moverse desde que se dibujó el panel
    const own = seg ? P.transitions[segKey(seg)] : null;
    if (!seg) return toast('Pon el cursor sobre un tramo de video o toca uno en la línea de tiempo.');
    if (kind === 'none') delete P.transitions[segKey(seg)];
    else P.transitions[segKey(seg)] = { kind, dur: own?.dur || TRANSITIONS[kind].dur };
    E.changed({ panelRefresh: true });
    if (kind !== 'none') previewCut(E, seg);
  };
  const nodes = [
    h('p', { class: 'hint' }, seg
      ? `Corte elegido: inicio del tramo en ${fmtTime(seg.tlStart, true)}. Tocar una transición la aplica y la muestra. ${seg.cont ? 'Este tramo viene de una división (S), así que no hay salto de imagen.' : ''}`
      : 'Pon el cursor sobre un tramo de video (o tócalo en la línea de tiempo) y elige una transición.'),
  ];
  if (own) {
    nodes.push(slider({
      label: `Duración de «${TRANSITIONS[own.kind]?.label}»`, value: own.dur, min: 0.1, max: 1.2, step: 0.05, format: (v) => `${v.toFixed(2)} s`,
      onInput: (v) => { own.dur = v; E.changed(); },
    }));
  }
  nodes.push(h('div', { class: 'row' },
    h('button', { class: 'btn btn-sm', onclick: () => apply('none') }, 'Quitar de este corte'),
    h('button', {
      class: 'btn btn-sm',
      onclick: () => {
        const cs = targetSeg(E);
        const o2 = cs ? P.transitions[segKey(cs)] : null;
        const kind = o2?.kind;
        if (!kind) return toast('Primero elige una transición para este corte.');
        for (const s of E.player.tl.segs) if (s.type === 'video' && s.vi > 0 && !s.cont) P.transitions[segKey(s)] = { kind, dur: o2.dur };
        E.changed({ panelRefresh: true });
        toast('Aplicada a todos los cortes.', 'ok');
      },
    }, 'Usar en todos los cortes')
  ));
  for (const cat of TRANSITION_CATS) {
    const items = Object.entries(TRANSITIONS).filter(([, d]) => d.cat === cat);
    nodes.push(group(cat, items.map(([k, d]) => chip(d.label, (own?.kind || 'none') === k, () => apply(k)))));
  }
  return nodes;
}

// ---------- Efectos ----------
function effects(E) {
  const P = E.project;
  P.effects ||= [];
  const total = E.player.total;
  const sel = P.effects.find((f) => f.id === E.state.selFx);
  const add = (kind) => {
    const start = clamp(E.player.t, 0, Math.max(0, total - 0.5));
    const f = { id: uid('f_'), kind, start, end: Math.min(total, start + 2), amount: 0.7 };
    P.effects.push(f);
    E.state.selFx = f.id;
    E.tlSel.cur = { kind: 'fx', id: f.id };
    E.changed({ panelRefresh: true });
    E.player.seek(start + 0.2);
  };
  const nodes = [
    h('p', { class: 'hint' }, 'Se agregan en el cursor por 2 s. Arrastra la barra naranja en la línea de tiempo para moverla o estirar sus bordes. Afectan solo al video, no a los textos.'),
  ];
  if (sel) {
    nodes.push(
      h('h3', null, `Efecto: ${EFFECTS[sel.kind]?.label}`),
      slider({ label: 'Intensidad', value: sel.amount ?? 0.7, min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { sel.amount = v; E.changed(); } }),
      slider({ label: 'Empieza en', value: sel.start, min: 0, max: Math.max(0.1, total - 0.2), step: 0.05, format: (v) => fmtTime(v, true), onInput: (v) => { sel.start = v; sel.end = Math.max(sel.end, v + 0.2); E.changed(); } }),
      slider({ label: 'Duración', value: sel.end - sel.start, min: 0.2, max: Math.max(0.5, total), step: 0.1, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => { sel.end = Math.min(total, sel.start + v); E.changed(); } }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => { E.player.seek(sel.start); } }, 'Ir al efecto'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => { P.effects = P.effects.filter((f) => f !== sel); E.state.selFx = null; E.tlSel.cur = null; E.changed({ panelRefresh: true }); } }, 'Quitar')
      )
    );
  }
  if (P.effects.length) {
    nodes.push(h('h4', null, 'En este video'), h('div', { class: 'lb-grid' }, [...P.effects].sort((a, b) => a.start - b.start).map((f) =>
      chip(`${EFFECTS[f.kind]?.label} · ${fmtTime(f.start, true)}`, f.id === E.state.selFx, () => { E.state.selFx = f.id; E.tlSel.cur = { kind: 'fx', id: f.id }; E.renderPanel(); E.redrawTimeline(); E.player.seek(f.start + 0.05); }))));
  }
  for (const cat of EFFECT_CATS) {
    const items = Object.entries(EFFECTS).filter(([, d]) => d.cat === cat);
    nodes.push(group(cat, items.map(([k, d]) => chip(d.label, false, () => add(k)))));
  }
  return nodes;
}

// ---------- Sonidos ----------
async function audition(E, kind) {
  auditionCtx ||= E.player.ac || new (window.AudioContext || window.webkitAudioContext)();
  if (auditionCtx.state === 'suspended') await auditionCtx.resume();
  await loadSfx(auditionCtx, [{ kind }]);
  const buf = sfxBuffer(auditionCtx, kind);
  if (!buf) return;
  const s = auditionCtx.createBufferSource();
  s.buffer = buf;
  const g = auditionCtx.createGain();
  g.gain.value = 0.7;
  s.connect(g);
  g.connect(auditionCtx.destination);
  s.start();
}

function sounds(E) {
  const P = E.project;
  const A = P.audio;
  A.sfx ||= [];
  const st = E.state.lib;
  st.sfxVol ??= 0.6;
  const add = async (kind) => {
    A.sfx.push({ t: +clamp(E.player.t, 0, E.player.total).toFixed(2), kind, vol: st.sfxVol });
    A.sfxOn = true;
    E.player.preloadSfx();
    E.changed({ panelRefresh: true });
    audition(E, kind);
  };
  const cats = [...new Set(Object.values(SFX_KINDS).filter((d) => !d.legacy).map((d) => d.cat))];
  const nodes = [
    h('p', { class: 'hint' }, `Toca ▶ para escuchar y + para poner el sonido en el cursor (${fmtTime(E.player.t, true)}). Son ${Object.values(SFX_KINDS).filter((d) => !d.legacy).length} sonidos: el banco moderno (hecho para este programa) y sonidos reales libres de derechos (CC0, Kenney).`),
    toggle({ label: 'Sonidos activados en el video', checked: A.sfxOn !== false, onChange: (v) => { A.sfxOn = v; E.changed(); } }),
    slider({ label: 'Volumen al agregar', value: st.sfxVol, min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (st.sfxVol = v) }),
  ];
  if (A.sfx.length) {
    nodes.push(h('h4', null, `En este video (${A.sfx.length})`), h('div', { class: 'list' }, [...A.sfx].sort((a, b) => a.t - b.t).map((s) =>
      h('div', { class: `list-item${E.tlSel.cur?.id === s ? ' selected' : ''}` },
        h('button', { style: { all: 'unset', cursor: 'pointer', flex: 1 }, onclick: () => { E.tlSel.cur = { kind: 'sfx', id: s }; E.player.seek(s.t); E.redrawTimeline(); audition(E, s.kind); } },
          h('div', { class: 'title' }, sfxLabel(s.kind)), h('div', { class: 'sub' }, fmtTime(s.t, true))),
        h('button', { class: 'icon-btn', 'aria-label': 'Quitar sonido', onclick: () => { A.sfx = A.sfx.filter((x) => x !== s); E.changed({ panelRefresh: true }); } }, '✕')))));
  }
  for (const cat of cats) {
    const items = Object.entries(SFX_KINDS).filter(([, d]) => d.cat === cat && !d.legacy).sort((a, b) => (b[1].modern ? 1 : 0) - (a[1].modern ? 1 : 0));
    nodes.push(h('div', { class: 'lib-group' }, h('h4', null, cat), h('div', { class: 'sfx-list' }, items.map(([k, d]) =>
      h('div', { class: 'sfx-row' },
        h('button', { class: 'icon-btn', 'aria-label': `Escuchar ${d.label}`, onclick: () => audition(E, k) }, '▶'),
        h('span', { class: 'grow' }, d.label, d.real ? h('small', { class: 'tag' }, 'real') : null),
        h('button', { class: 'icon-btn', 'aria-label': `Poner ${d.label} en el cursor`, onclick: () => add(k) }, '＋'))))));
  }
  return nodes;
}

// ---------- Formas y textos animados ----------
const SHAPE_DEF = {
  rect: { w: 0.5, h: 0.1, fill: true },
  round: { w: 0.5, h: 0.1, fill: true },
  circle: { w: 0.22, h: 0.12, fill: true },
  ring: { w: 0.3, h: 0.16, fill: false },
  underline: { w: 0.5, h: 0.03, fill: false },
  highlight: { w: 0.55, h: 0.05, fill: true },
  arrow: { w: 0.3, h: 0.08, fill: false },
  frame: { w: 0.6, h: 0.35, fill: false },
  burst: { w: 0.3, h: 0.17, fill: true },
};

const TEXT_PRESETS = [
  ['Máquina de escribir', { anim: 'type', font: 'russo', upper: false, size: 6.5, color: '#FFFFFF', box: true, boxColor: '#000000', boxOpacity: 0.7 }],
  ['Rebote', { anim: 'bounce', font: 'bangers', upper: true, size: 9, color: '#FFE066', stroke: '#000000' }],
  ['Desenfoque', { anim: 'blur', font: 'montserrat', upper: true, size: 7, color: '#FFFFFF', stroke: '#000000' }],
  ['Zoom de impacto', { anim: 'zoomout', font: 'anton', upper: true, size: 11, color: '#FFFFFF', stroke: '#000000' }],
  ['Manuscrita', { anim: 'fade', font: 'caveat', upper: false, size: 9, color: '#FFFFFF', stroke: '#000000' }],
  ['Elegante', { anim: 'slide', font: 'playfair', upper: false, size: 7, color: '#FFFFFF', stroke: '#000000' }],
  ['Neón retro', { anim: 'pop', font: 'righteous', upper: true, size: 8, color: '#00F5D4', stroke: '#1b0033' }],
  ['Cómic', { anim: 'pop', font: 'marker', upper: false, size: 8, color: '#FFD23F', stroke: '#000000' }],
];

function addOverlay(E, ov) {
  const P = E.project;
  P.overlays ||= [];
  const total = E.player.total;
  const start = clamp(E.player.t, 0, Math.max(0, total - 0.5));
  const o = { id: uid('o_'), start, end: Math.min(total, start + 3), x: 0.5, y: 0.3, anim: 'pop', ...ov };
  P.overlays.push(o);
  E.state.selOverlay = o.id;
  E.tlSel.cur = { kind: 'ov', id: o.id };
  return o;
}

function shapes(E) {
  const brand = E.brand || {};
  return [
    h('p', { class: 'hint' }, 'Se agregan en el cursor. Luego se ajustan en la pestaña Capas (color, tamaño, giro, animación) o directo en la línea de tiempo.'),
    group('Formas', Object.entries(SHAPES).map(([k, label]) => chip(label, false, () => {
      const d = SHAPE_DEF[k];
      addOverlay(E, { kind: 'shape', shape: k, w: d.w, h: d.h, fill: d.fill, color: brand.accent || '#FFD166', y: 0.5, line: 0.8, anim: k === 'underline' || k === 'arrow' || k === 'highlight' ? 'draw' : 'pop' });
      E.changed({ panelRefresh: true });
      E.setTab('layers');
    }))),
    group('Textos animados', TEXT_PRESETS.map(([label, p]) => chip(label, false, () => {
      addOverlay(E, { kind: 'text', text: 'Tu texto aquí', ...p });
      E.player.loadOverlays().then(() => E.changed({ panelRefresh: true }));
      E.setTab('layers');
    }))),
  ];
}

// ---------- Fuentes ----------
function fonts(E) {
  const P = E.project;
  const st = E.state.lib;
  const cats = ['Todas', ...new Set(Object.values(FONTS).map((f) => f.cat || 'Sistema'))];
  const wrap = h('div');
  const list = h('div', { class: 'font-list' });
  const selOv = P.overlays?.find((o) => o.id === E.state.selOverlay && o.kind === 'text');
  const fill = () => {
    list.replaceChildren(...Object.entries(FONTS).filter(([, f]) => st.font === 'Todas' || (f.cat || 'Sistema') === st.font).map(([k, f]) =>
      h('div', { class: 'font-row' },
        h('div', { class: 'font-sample', style: { fontFamily: f.family, fontWeight: f.weight || 700 } }, 'Tu mensaje se lee bien'),
        h('div', { class: 'font-meta' },
          h('small', null, f.label),
          h('span', { class: 'font-apply' },
            chip('Subtítulos', P.captions.style.font === k, () => { P.captions.style.font = k; E.changed({ captions: true, panelRefresh: true }); }),
            chip('Título', P.headline.font === k, () => { P.headline.font = k; E.changed({ panelRefresh: true }); }),
            selOv ? chip('Capa', selOv.font === k, () => { selOv.font = k; E.changed({ panelRefresh: true }); }, 'Aplicar a la capa de texto elegida') : null)))));
  };
  fill();
  loadAllFonts().then(() => E.player.draw());
  wrap.append(
    h('p', { class: 'hint' }, `${Object.keys(FONTS).length} fuentes (libres OFL, incluidas en el programa). Elige dónde usarla.${selOv ? '' : ' Para aplicarla a un texto, elígelo antes en Capas.'}`),
    h('div', { class: 'lib-sub' }, cats.map((c) => chip(c, st.font === c, () => { st.font = c; E.renderPanel(); }))),
    list
  );
  return wrap;
}

// ---------- Mis medios: importar imágenes, videos y audios y ponerlos libremente en la línea de tiempo ----------
const isAudioFile = (f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name);

async function importFile(file) {
  if (isAudioFile(file)) {
    let duration = 0;
    try {
      duration = (await decodeAudio(file)).duration;
    } catch {
      throw new Error(`No se pudo leer «${file.name}» como audio.`);
    }
    return addMedia({ blob: file, name: file.name, kind: 'audio', duration, extra: { library: true } });
  }
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return addLibraryFile(file);
  throw new Error(`«${file.name}» no es imagen, video ni audio.`);
}

/** Pone un medio de la biblioteca en la línea de tiempo, en el instante t. */
export async function placeMedia(E, m, t = E.player.t) {
  const P = E.project;
  const total = E.player.total;
  const start = clamp(t, 0, Math.max(0, total - 0.3));
  if (m.kind === 'audio') {
    P.audioClips ||= [];
    const dur = Math.max(0.5, Math.min(m.duration || 5, Math.max(0.5, total - start)));
    const c = { id: uid('a_'), mediaId: m.id, name: m.name.replace(/\.[^.]+$/, ''), start, end: start + dur, in: 0, vol: 1, fadeIn: 0, fadeOut: Math.min(0.5, dur / 4) };
    P.audioClips.push(c);
    E.state.selAud = c.id;
    E.tlSel.cur = { kind: 'aud', id: c.id };
    E.changed({ panelRefresh: true });
    return c;
  }
  const isVideo = m.kind === 'video';
  const o = addOverlay(E, {
    kind: 'broll', mediaId: m.id, mediaKind: m.kind, layout: 'full', anim: 'fade', name: m.name,
    end: Math.min(Math.max(total, start + 1), start + (isVideo ? Math.min(m.duration || 4, 8) : 3)),
  });
  o.start = start;
  await E.player.loadOverlays();
  E.changed({ panelRefresh: true });
  return o;
}

/** Importa archivos (selector o arrastrar y soltar) y los coloca uno tras otro desde t. */
export async function importAndPlace(E, files, t = E.player.t) {
  const done = loading('Importando…');
  let at = t;
  let n = 0;
  try {
    for (const f of files) {
      try {
        const m = await importFile(f);
        const item = await placeMedia(E, m, at);
        at = item.end;
        n++;
      } catch (e) {
        toast(e.message, 'error');
      }
    }
  } finally {
    done();
  }
  if (n) toast(`${n} ${n === 1 ? 'archivo agregado' : 'archivos agregados'} a la línea de tiempo.`, 'ok');
}

// Tipo MIME propio para arrastrar medios de la biblioteca a la línea de tiempo (como el «bin» de Premiere/DaVinci).
export const DRAG_MEDIA = 'application/x-psico-media';
const ACCEPT = 'image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac';

/** ¿Este medio está usado en el proyecto? (para no borrar algo que está en la línea de tiempo). */
function usedIn(P, id) {
  return (P.overlays || []).some((o) => o.mediaId === id) || (P.audioClips || []).some((c) => c.mediaId === id)
    || P.audio?.musicId === id || (P.clips || []).some((c) => c.mediaId === id);
}

async function importLoose(files) {
  const done = loading(`Importando ${files.length} ${files.length === 1 ? 'archivo' : 'archivos'}…`);
  let n = 0;
  try {
    for (const f of files) {
      try {
        await importFile(f);
        n++;
      } catch (e) {
        toast(e.message, 'error');
      }
    }
  } finally {
    done();
  }
  if (n) toast(`${n} ${n === 1 ? 'archivo importado' : 'archivos importados'} a Mis medios.`, 'ok');
}

function myMedia(E) {
  const P = E.project;
  P.audioClips ||= [];
  const total = E.player.total;
  const st = (E.state.bin ||= { q: '', type: 'all', sort: 'new', view: 'grid' });
  const box = h('div');
  const refresh = () => E.renderPanel();
  const importMany = async (place) => {
    const fs = await pickFile(ACCEPT, true);
    if (!fs.length) return;
    if (place) await importAndPlace(E, fs);
    else await importLoose(fs);
    refresh();
  };
  const importFolder = () => {
    const inp = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    inp.setAttribute('webkitdirectory', '');
    inp.addEventListener('change', async () => {
      const fs = [...inp.files].filter((f) => /^(image|video|audio)\//.test(f.type) || isAudioFile(f));
      inp.remove();
      if (!fs.length) return toast('Esa carpeta no tiene imágenes, videos ni audios.', 'error');
      await importLoose(fs);
      refresh();
    });
    document.body.append(inp);
    inp.click();
  };
  const nodes = [
    h('p', { class: 'hint' }, 'Tu biblioteca: importa imágenes, videos y audios, búscalos y arrástralos a la línea de tiempo (o toca ＋ para ponerlos en el cursor).'),
    h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => importMany(true) }, '＋ Importar y agregar'),
      h('button', { class: 'btn btn-sm', onclick: () => importMany(false) }, 'Importar a Mis medios'),
      h('button', { class: 'btn btn-sm', onclick: importFolder }, 'Importar carpeta…'),
      window.psicoDesktop?.takes ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => window.psicoDesktop.takes.open() }, 'Grabaciones de video') : null
    ),
    h('input', { class: 'input', type: 'search', placeholder: 'Buscar en Mis medios…', value: st.q, oninput: (e) => { st.q = e.target.value; clearTimeout(st.tm); st.tm = setTimeout(refresh, 250); } }),
    h('div', { class: 'chips' },
      ...[['all', 'Todo'], ['video', 'Videos'], ['image', 'Imágenes'], ['audio', 'Audios'], ['unused', 'Sin usar']].map(([k, l]) => h('button', { class: `chip${st.type === k ? ' active' : ''}`, onclick: () => { st.type = k; refresh(); } }, l)),
      h('select', { class: 'input input-sm', 'aria-label': 'Ordenar', onchange: (e) => { st.sort = e.target.value; refresh(); } },
        [['new', 'Más recientes'], ['old', 'Más antiguos'], ['name', 'Nombre'], ['dur', 'Duración']].map(([v, l]) => h('option', { value: v, selected: st.sort === v }, l))),
      h('button', { class: 'chip', title: 'Cambiar vista', onclick: () => { st.view = st.view === 'grid' ? 'list' : 'grid'; refresh(); } }, st.view === 'grid' ? '☰ Lista' : '▦ Cuadrícula')
    ),
  ];
  const sel = P.audioClips.find((c) => c.id === E.state.selAud);
  if (sel) {
    nodes.push(
      h('h3', null, `Audio: ${sel.name}`),
      slider({ label: 'Volumen', value: sel.vol ?? 1, min: 0, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { sel.vol = v; E.changed(); } }),
      slider({ label: 'Entrada suave', value: sel.fadeIn || 0, min: 0, max: 5, step: 0.1, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => { sel.fadeIn = v; E.changed(); } }),
      slider({ label: 'Salida suave', value: sel.fadeOut || 0, min: 0, max: 5, step: 0.1, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => { sel.fadeOut = v; E.changed(); } }),
      slider({ label: 'Empieza en', value: sel.start, min: 0, max: Math.max(0.1, total - 0.2), step: 0.05, format: (v) => fmtTime(v, true), onInput: (v) => { const d = sel.end - sel.start; sel.start = v; sel.end = v + d; E.changed(); } }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => E.player.seek(sel.start) }, 'Ir al audio'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => { P.audioClips = P.audioClips.filter((c) => c !== sel); E.state.selAud = null; E.tlSel.cur = null; E.changed({ panelRefresh: true }); } }, 'Quitar de la línea de tiempo')
      )
    );
  }
  nodes.push(box);
  (async () => {
    let items = await libraryItems();
    const q = st.q.trim().toLowerCase();
    if (st.type === 'unused') items = items.filter((m) => !usedIn(P, m.id));
    else if (st.type !== 'all') items = items.filter((m) => m.kind === st.type);
    if (q) items = items.filter((m) => `${m.name} ${m.license || ''}`.toLowerCase().includes(q));
    const cmp = {
      new: (a, b) => b.createdAt - a.createdAt,
      old: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      dur: (a, b) => (b.duration || 0) - (a.duration || 0),
    }[st.sort];
    items.sort(cmp);
    const shown = items.slice(0, 150);
    const drag = (m) => ({ draggable: true, ondragstart: (e) => { e.dataTransfer.setData(DRAG_MEDIA, m.id); e.dataTransfer.effectAllowed = 'copy'; } });
    const remove = async (m) => {
      if (usedIn(P, m.id)) return toast('Ese archivo está en la línea de tiempo: quítalo de ahí primero.', 'error');
      if (!(await confirmDialog(`Se borra «${m.name}» de Mis medios (no de tus carpetas).`, { title: '¿Borrar de Mis medios?', ok: 'Borrar', danger: true }))) return;
      await deleteMedia(m.id);
      toast('Borrado de Mis medios.', 'ok');
      refresh();
    };
    const thumbOf = (m) => {
      if (m.kind === 'audio') return h('div', { class: 'bin-audio' }, '♪');
      const url = URL.createObjectURL(m.blob);
      return m.kind === 'video'
        ? h('video', { src: url, muted: true, preload: 'metadata', onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => { e.target.pause(); e.target.currentTime = 0; } })
        : h('img', { src: url, alt: m.name, loading: 'lazy' });
    };
    const info = (m) => (m.kind === 'image' ? 'Imagen' : `${m.kind === 'video' ? 'Video' : 'Audio'} · ${fmtTime(m.duration || 0)}`) + (m.width ? ` · ${m.width}×${m.height}` : '');
    const actions = (m) => [
      m.kind === 'audio' ? h('button', { class: 'icon-btn', 'aria-label': `Escuchar ${m.name}`, onclick: async (e) => { e.stopPropagation(); const a = new Audio(await mediaUrl(m.id)); a.volume = 0.8; a.play(); setTimeout(() => a.pause(), 8000); } }, '▶') : null,
      h('button', { class: 'icon-btn', 'aria-label': `Agregar ${m.name} en el cursor`, title: 'Agregar en el cursor', onclick: (e) => { e.stopPropagation(); placeMedia(E, m); } }, '＋'),
      h('button', { class: 'icon-btn', 'aria-label': `Borrar ${m.name}`, title: 'Borrar de Mis medios', onclick: (e) => { e.stopPropagation(); remove(m); } }, '🗑'),
    ];
    const icon = (m) => (m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎵' : '🖼️');
    const list = st.view === 'grid'
      ? h('div', { class: 'lib-grid' }, shown.map((m) => h('div', { class: 'lib-item mat-vid bin-item', title: `${m.name}\n${info(m)}\nArrástralo a la línea de tiempo`, ...drag(m) },
        thumbOf(m), h('span', null, `${icon(m)} ${m.name.slice(0, 28)}`), ...actions(m))))
      : h('div', { class: 'sfx-list' }, shown.map((m) => h('div', { class: 'sfx-row', ...drag(m) },
        h('span', { class: 'grow' }, `${icon(m)} ${m.name}`, h('small', { class: 'tag' }, info(m)), usedIn(P, m.id) ? h('small', { class: 'tag' }, 'en uso') : null), ...actions(m))));
    box.replaceChildren(
      h('p', { class: 'muted small' }, `${items.length} ${items.length === 1 ? 'archivo' : 'archivos'}${items.length > shown.length ? ` (muestro ${shown.length}; busca para filtrar)` : ''}`),
      items.length ? list : h('p', { class: 'muted small' }, q || st.type !== 'all' ? 'Nada coincide con el filtro.' : 'Aún no has importado nada. También puedes soltar archivos sobre la línea de tiempo.'),
    );
  })();
  return nodes;
}
