// Pestaña «Material» de la Biblioteca (solo programa de PC): sonidos, música, footage, overlays y LUTs
// de la carpeta «Material», con licencia verificada. Escuchar/ver antes de agregar; créditos a la vista.
import { h, toast, slider } from '../lib/dom.js';
import { clamp, fmtTime } from '../lib/util.js';
import { loadMaterial, importMaterial, fileUrl } from '../ai/material.js';

const CATS = [
  ['sfx', 'Sonidos'],
  ['music', 'Música'],
  ['footage', 'Footage'],
  ['overlays', 'Overlays'],
  ['luts', 'LUTs'],
  ['graficos', 'Stickers'],
];
const USOS = { transicion: 'Transición', texto: 'Texto/pop', interfaz: 'Interfaz/click', acento: 'Acento', remate: 'Remate', foley: 'Foley', reaccion: 'Reacción', ambiente: 'Ambiente', riser: 'Subida', jingle: 'Jingle', musical: 'Música/guitarra' };

/** Arrastrar desde el Material a la línea de tiempo (lo recibe editor.js con dropMaterial). */
export const DRAG_MAT = 'application/x-psico-mat';
const dragMat = (it) => (it.categoria === 'luts' ? {} : { draggable: true, ondragstart: (e) => { e.dataTransfer.setData(DRAG_MAT, it.ruta); e.dataTransfer.effectAllowed = 'copy'; } });

/** Agrega un ítem del Material en el instante t (botón ＋ o soltar en la línea de tiempo). */
export async function addAt(E, it, t) {
  const P = E.project;
  const total = E.player.total;
  const s = clamp(t, 0, Math.max(0, total - 0.3));
  if (it.categoria === 'sfx') {
    P.audio.sfx ||= [];
    P.audio.sfx.push({ t: +s.toFixed(2), kind: `mat:${it.ruta}`, vol: 0.3 });
    P.audio.sfxOn = true;
    E.player.preloadSfx?.();
    E.changed({ panelRefresh: true });
    return toast(`Sonido en ${fmtTime(s, true)}`, 'ok');
  }
  const m = await importMaterial(it);
  if (it.atribucion) (P.credits ||= []).includes(it.atribucion) || P.credits.push(it.atribucion);
  if (it.categoria === 'music') {
    Object.assign(P.audio, { musicId: m.id, musicName: it.nombre, musicVol: 0.3, musicOffset: 0, duck: true, fade: true });
    E.changed({ panelRefresh: true, music: true });
    return toast(`Música «${it.nombre}» al 30 %, baja sola cuando hablas.${it.atribucion ? ' Recuerda el crédito.' : ''}`, 'ok', 6000);
  }
  const id = `o_${Date.now().toString(36)}`;
  if (it.categoria === 'graficos') {
    (P.overlays ||= []).push({ id, kind: 'broll', mediaId: m.id, mediaKind: 'image', layout: 'free', anim: 'pop', name: it.nombre, start: s, end: Math.min(total, s + 2.5), x: 0.78, y: 0.22, w: 0.28 });
  } else {
    const overlay = it.categoria === 'overlays';
    const dur = Math.min(m.duration || 4, overlay ? 2.5 : 4);
    (P.overlays ||= []).push({ id, kind: 'broll', mediaId: m.id, mediaKind: 'video', layout: 'full', anim: 'fade', name: it.nombre, start: s, end: Math.min(total, s + dur), x: 0.5, y: 0.3, ...(overlay ? { blend: it.mezcla || 'screen', opacity: it.mezcla === 'overlay' ? 0.6 : 0.85 } : {}) });
  }
  await E.player.loadOverlays?.();
  E.changed({ panelRefresh: true });
  toast(`${it.categoria === 'graficos' ? 'Sticker' : it.categoria === 'overlays' ? 'Overlay' : 'Footage'} en ${fmtTime(s, true)}`, 'ok');
}

/** Soltar en la línea de tiempo: busca el ítem por su ruta y lo agrega en t. */
export async function dropMaterial(E, ruta, t) {
  const it = (await loadMaterial()).find((x) => x.ruta === ruta);
  if (!it) throw new Error('Ese archivo ya no está en el Material.');
  return addAt(E, it, t);
}

let preview = null;
function play(it) {
  try { preview?.pause(); } catch { /* nada */ }
  preview = new Audio(fileUrl(it));
  preview.volume = 0.8;
  preview.play().catch(() => {});
  if (it.categoria === 'music') setTimeout(() => preview?.pause(), 15000);
}

const row = (it, actions, sub) => h('div', { class: 'sfx-row', ...dragMat(it) },
  it.categoria === 'sfx' || it.categoria === 'music' ? h('button', { class: 'icon-btn', 'aria-label': `Escuchar ${it.nombre}`, onclick: () => play(it) }, '▶') : null,
  h('span', { class: 'grow' }, it.nombre, sub ? h('small', { class: 'tag' }, sub) : null, it.atribucion ? h('small', { class: 'tag', title: it.atribucion }, 'crédito') : null),
  ...actions);

export function panelMaterial(E) {
  const st = (E.state.mat ||= { cat: 'sfx', q: '', uso: '' });
  const box = h('div', null, h('p', { class: 'muted small' }, 'Cargando el Material…'));
  const P = E.project;
  const total = E.player.total;
  const at = () => clamp(E.player.t, 0, Math.max(0, total - 0.3));
  (async () => {
    const items = await loadMaterial();
    if (!items.length) {
      box.replaceChildren(
        h('p', { class: 'hint' }, 'No encuentro la carpeta «Material» en este PC (sonidos, música, footage y LUTs con licencia verificada).'),
        h('button', { class: 'btn btn-sm', onclick: async () => { const d = await window.psicoDesktop?.material?.choose(); if (d) { await loadMaterial(true); E.renderPanel(); } else toast('Esa carpeta no tiene manifest.json del Material.', 'error'); } }, 'Elegir carpeta…'));
      return;
    }
    const q = st.q.trim().toLowerCase();
    let list = items.filter((x) => x.categoria === st.cat);
    if (st.cat === 'sfx' && st.uso) list = list.filter((x) => x.uso === st.uso);
    if (q) list = list.filter((x) => `${x.nombre} ${x.descripcion} ${(x.etiquetas || []).join(' ')}`.toLowerCase().includes(q));
    const shown = list.slice(0, 120);
    const act = (it) => {
      if (it.categoria === 'luts') {
        const on = P.color.lut === it.ruta;
        return [h('button', { class: `btn btn-sm${on ? ' btn-primary' : ''}`, onclick: () => { Object.assign(P.color, on ? { lut: '', lutName: '' } : { lut: it.ruta, lutName: it.nombre, lutAmt: P.color.lutAmt ?? 0.8 }); E.changed({ panelRefresh: true }); } }, on ? 'Quitar' : 'Aplicar')];
      }
      const fn = () => addAt(E, it, at());
      return [h('button', { class: 'icon-btn', 'aria-label': `Agregar ${it.nombre}`, onclick: async (e) => { e.currentTarget.disabled = true; try { await fn(); } catch (err) { toast(err.message, 'error'); } e.currentTarget.disabled = false; } }, '＋')];
    };
    const visual = (it) => h('div', { class: 'lib-item mat-vid', title: `${it.descripcion || it.nombre}
Arrástralo a la línea de tiempo`, ...dragMat(it) },
      h('video', { src: fileUrl(it), muted: true, preload: 'metadata', playsinline: true, onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => e.target.pause() }),
      h('span', null, it.nombre.slice(0, 40)),
      ...act(it));
    box.replaceChildren(
      h('input', { class: 'input', type: 'search', placeholder: 'Buscar (pop, guitarra, calma, corazón, fuego…)', value: st.q, oninput: (e) => { st.q = e.target.value; clearTimeout(st.tm); st.tm = setTimeout(() => E.renderPanel(), 250); } }),
      st.cat === 'sfx' ? h('div', { class: 'chips' }, [['', 'Todos'], ...Object.entries(USOS)].map(([k, l]) => h('button', { class: `chip${st.uso === k ? ' active' : ''}`, onclick: () => { st.uso = k; E.renderPanel(); } }, l))) : null,
      st.cat === 'luts' ? slider({ label: 'Intensidad del LUT', value: P.color.lutAmt ?? 0.8, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { P.color.lutAmt = v; E.changed(); } }) : null,
      h('p', { class: 'muted small' }, `${list.length} ${list.length === 1 ? 'archivo' : 'archivos'}${list.length > shown.length ? ` (muestro ${shown.length}; busca para filtrar)` : ''}`),
      st.cat === 'graficos'
        ? h('div', { class: 'lib-grid' }, shown.map((it) => h('div', { class: 'lib-item mat-vid', title: it.nombre, ...dragMat(it) }, h('img', { src: fileUrl(it), alt: it.nombre, loading: 'lazy', style: { objectFit: 'contain' } }), h('span', null, it.nombre.slice(0, 40)), ...act(it))))
        : st.cat === 'footage' || st.cat === 'overlays'
        ? h('div', { class: 'lib-grid' }, shown.map(visual))
        : h('div', { class: 'sfx-list' }, shown.map((it) => row(it, act(it), it.duracion ? fmtTime(it.duracion, true) : it.descripcion?.slice(0, 40) || ''))),
      P.credits?.length ? h('div', { class: 'lib-group' }, h('h4', null, 'Créditos obligatorios (pégalos en la descripción)'),
        h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, P.credits.join('\n\n')),
        h('button', { class: 'btn btn-sm', onclick: () => navigator.clipboard.writeText(P.credits.join('\n\n')).then(() => toast('Créditos copiados', 'ok')) }, 'Copiar créditos')) : null,
      h('p', { class: 'hint' }, 'Material local con licencia verificada (Mixkit, Kenney CC0, Sonniss, Incompetech y Scott Buckley CC BY, emojis Noto Apache 2.0, LUTs propios). Solo para tus videos: no se redistribuye.'),
    );
  })();
  return [
    h('div', { class: 'lib-sub' }, CATS.map(([k, l]) => h('button', { class: `lib-chip${st.cat === k ? ' active' : ''}`, onclick: () => { st.cat = k; E.renderPanel(); } }, l))),
    box,
  ];
}
