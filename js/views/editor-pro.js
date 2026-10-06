// Paneles profesionales del editor: fondo, luz y color, IA, capas y música.
import { h, icon, toast, modal, slider, toggle, segmented, select, colorPick, textInput, pickFile, confirmDialog, progressModal } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, uid, clamp, splitWords, IS_MOBILE } from '../lib/util.js';
import { addMedia, mediaUrl, saveProject } from '../store.js';
import { BG_GRADIENTS } from '../core/effects.js';
import { SCENES } from '../core/scenes.js';
import { LOOKS } from '../core/grade.js';
import { autoGrade } from '../core/lighting.js';
import { buildSegments, cutSource, trimBefore, trimAfter, mergeCuts } from '../core/timeline.js';
import { buildCaptionIndex, findFillers, pickKeywords, captionCues } from '../core/captions.js';
import { autoEmojis } from '../core/emoji.js';
import { findSilences, silenceCuts } from '../core/audio-analysis.js';
import { probeVideo } from '../core/media.js';
import { normalizeLoudness } from '../core/loudness.js';
import { copyText } from './script-dialogs.js';
import { SHAPES } from '../core/fx-lib.js';
import { FONTS } from '../core/captions.js';

const STOP = new Set('para porque cuando donde tambien siempre nunca mucho mucha muchos muchas entonces ahora aqui algo alguien nada tiene tienen hacer puede pueden estar estoy estas esta este esto como pero sobre entre desde hasta todos todas cada otra otro'.split(' '));

export function loading(text) {
  const el = h('div', { class: 'toast show' }, text);
  document.getElementById('toasts').append(el);
  return () => el.remove();
}

// ---------- Biblioteca de imágenes y videos ----------

export async function libraryItems(kind) {
  const all = await db.all('media');
  return all.filter((m) => m.library && (!kind || m.kind === kind)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function addLibraryFile(file) {
  const isVideo = file.type.startsWith('video/');
  let meta = {};
  if (isVideo) {
    const url = URL.createObjectURL(file);
    try {
      meta = await probeVideo(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return addMedia({ blob: file, name: file.name, kind: isVideo ? 'video' : 'image', ...meta, extra: { library: true } });
}

/** Elegir de la biblioteca o subir. kind: 'image' | 'video' | null (ambos). */
export async function pickMedia(kind, title = 'Elige un archivo') {
  const items = await libraryItems(kind);
  const urls = [];
  let closeFn;
  const grid = h('div', { class: 'lib-grid' });
  for (const m of items) {
    const url = URL.createObjectURL(m.blob);
    urls.push(url);
    grid.append(
      h('button', { class: 'lib-item', onclick: () => closeFn(m), title: m.name },
        m.kind === 'video' ? h('video', { src: url, muted: true, playsinline: true, preload: 'metadata' }) : h('img', { src: url, alt: m.name }),
        h('span', null, m.kind === 'video' ? `🎬 ${fmtTime(m.duration || 0)}` : '🖼️')
      )
    );
  }
  const accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'image/*,video/*';
  const res = await modal({
    title,
    wide: true,
    body: h('div', null,
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const [file] = await pickFile(accept);
          if (!file) return;
          const done = loading('Guardando…');
          try {
            closeFn(await addLibraryFile(file));
          } finally {
            done();
          }
        },
      }, icon('upload', 18), 'Subir desde el dispositivo'),
      items.length ? h('h3', null, 'Tu biblioteca') : h('p', { class: 'muted small' }, 'Aquí aparecerán tus imágenes, videos y lo que crees con IA.'),
      grid
    ),
    actions: [{ label: 'Cancelar', value: null }],
    onOpen: (_p, close) => (closeFn = close),
  });
  urls.forEach((u) => URL.revokeObjectURL(u));
  return res;
}

// ---------- Fondo ----------

export function panelBackground(E) {
  const { project } = E;
  const bg = project.fx.bg;
  const apply = async (patch) => {
    Object.assign(bg, patch);
    if (bg.mode !== 'none') {
      const done = loading('Preparando la IA de fondo…');
      try {
        await E.player.prepareFx();
      } catch (e) {
        toast(`No se pudo cargar la IA de fondo: ${e.message}`, 'error');
      } finally {
        done();
      }
    }
    E.changed({ panelRefresh: true });
  };
  const chooseImage = async () => {
    const m = await pickMedia('image', 'Imagen de fondo');
    if (m) await apply({ mode: 'image', imageId: m.id });
  };
  const nodes = [
    h('p', { class: 'hint' }, 'La IA separa tu silueta del fondo en tu propio dispositivo. Funciona mejor con buena luz y sin objetos detrás de ti.'),
    h('div', { class: 'chips' },
      [['none', 'Original'], ['scene', 'Box de atención'], ['blur', 'Desenfocar'], ['gradient', 'Degradado'], ['color', 'Color'], ['image', 'Imagen']].map(([k, l]) =>
        h('button', {
          class: `chip${bg.mode === k ? ' active' : ''}`,
          onclick: () => (k === 'image' && !bg.imageId ? chooseImage() : apply({ mode: k })),
        }, l)
      )
    ),
  ];
  if (bg.mode === 'blur') nodes.push(slider({ label: 'Intensidad del desenfoque', value: bg.blur, min: 4, max: 40, step: 1, onInput: (v) => { bg.blur = v; E.changed(); } }));
  if (bg.mode === 'scene') {
    nodes.push(
      h('div', { class: 'preset-grid' },
        Object.entries(SCENES).map(([k, sc]) =>
          h('button', {
            class: `preset${bg.scene === k ? ' active' : ''}`,
            style: { background: `linear-gradient(135deg, ${sc.wall[0]}, ${sc.wall[1]})`, color: k === 'estudio' ? '#fff' : '#2b2118', textShadow: k === 'estudio' ? '0 1px 3px rgba(0,0,0,.6)' : 'none' },
            onclick: () => apply({ mode: 'scene', scene: k }),
          }, sc.label)
        )
      ),
      h('p', { class: 'hint' }, 'Fondo de consulta desenfocado como con un lente real. Para que se vea natural: iluminación de frente, ropa que contraste con el fondo y una silla o pared detrás de ti sin objetos que se crucen.')
    );
  }
  if (bg.mode === 'color') nodes.push(colorPick({ label: 'Color de fondo', value: bg.color, onChange: (v) => { bg.color = v; E.changed(); } }));
  if (bg.mode === 'gradient') {
    nodes.push(
      h('div', { class: 'preset-grid' },
        Object.entries(BG_GRADIENTS).map(([k, g]) => {
          const stops = g.stops || [E.brand.primary, E.brand.secondary];
          return h('button', {
            class: `preset${bg.gradient === k ? ' active' : ''}`,
            style: { background: `linear-gradient(135deg, ${stops[0]}, ${stops[1]})`, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.6)' },
            onclick: () => apply({ mode: 'gradient', gradient: k }),
          }, g.label);
        })
      )
    );
  }
  if (bg.mode === 'image') {
    nodes.push(
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: chooseImage }, icon('image', 16), 'Cambiar imagen'),
        h('button', { class: 'btn btn-sm', onclick: () => E.go('ia?tab=imagenes') }, icon('magic', 16), 'Crear fondo con IA')
      )
    );
  }
  nodes.push(
    h('button', {
      class: 'btn btn-sm',
      onclick: async () => {
        const { getBrand, saveBrand } = await import('../store.js');
        const b = await getBrand();
        b.stdBg = { ...bg };
        await saveBrand(b);
        toast('Este fondo será el estándar de tus videos nuevos', 'ok');
      },
    }, icon('brand', 16), 'Usar como mi fondo estándar')
  );
  if (bg.mode !== 'none') {
    nodes.push(
      segmented({ label: 'Calidad del recorte', value: bg.hq ? 'hq' : 'fast', options: [['fast', 'Rápida'], ['hq', 'Alta (mejor pelo)']], onChange: (v) => apply({ hq: v === 'hq' }) }),
      segmented({ label: 'Ancho del cuerpo (quita restos de cama o silla)', value: bg.body ?? 2, options: [[1, 'Muy ajustado'], [2, 'Ajustado'], [3, 'Normal'], [4, 'Amplio'], [0, 'Sin límite']], onChange: (v) => { bg.body = v; E.changed(); } }),
      slider({ label: 'Recorte estricto (quita restos de muebles)', value: bg.strict ?? 0, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { bg.strict = v; E.changed(); } }),
      slider({ label: 'Suavidad del borde', value: bg.edge, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { bg.edge = v; E.changed(); } }),
      h('p', { class: 'hint' }, 'La vista previa puede ir más lenta con el fondo activo; la exportación siempre sale fluida.')
    );
  }
  return nodes;
}

// ---------- Luz y color ----------

export async function analyzeLight(E, { apply = true } = {}) {
  const { analyzeClip } = await import('../ai/face-track.js');
  const clip = E.project.clips[0];
  if (!clip) return null;
  const prog = progressModal('Analizando la luz de tu video…');
  try {
    const url = await mediaUrl(clip.mediaId);
    const res = await analyzeClip(url, clip.duration, { step: Math.max(0.5, clip.duration / 10), onProgress: (p) => prog.set(p, 'Buscando tu cara y midiendo la luz…'), isCancelled: () => prog.cancelled });
    prog.close();
    if (!res) return null;
    if (res.track.length) clip.faceTrack = res.track;
    if (apply && res.light) {
      Object.assign(E.project.fx.light, autoGrade(res.light.metrics), { auto: true });
      await E.player.prepareFx();
      E.changed({ panelRefresh: true });
    }
    return res;
  } catch (e) {
    prog.close();
    toast(`No se pudo analizar: ${e.message}`, 'error');
    return null;
  }
}

export function lightReport(res) {
  if (!res?.light) return;
  const { score, tips } = res.light;
  modal({
    title: `Iluminación: ${score}/100`,
    body: h('div', null,
      h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${score}%` } })),
      h('p', { class: 'muted small' }, 'Ya apliqué una corrección automática. Para la próxima grabación:'),
      h('ul', { class: 'install-steps' }, tips.map((t) => h('li', null, t.text))),
      res.faceRatio < 0.6 ? h('p', { class: 'hint' }, 'Tu cara no se detectó en todo el video: mira a la cámara y céntrate en el cuadro.') : ''
    ),
    actions: [{ label: 'Entendido', value: null, kind: 'primary' }],
  });
}

export function panelLight(E) {
  const C = E.project.color;
  const L = E.project.fx.light;
  const upd = (patch) => {
    Object.assign(C, patch);
    E.changed();
  };
  return [
    ...(IS_MOBILE ? [] : [
    h('h3', null, 'Iluminación con IA'),
    h('button', { class: 'btn btn-primary btn-block', onclick: async () => lightReport(await analyzeLight(E)) }, icon('magic', 18), 'Analizar y mejorar la luz'),
    L.auto ? h('p', { class: 'hint' }, `Corrección automática aplicada (exposición ${L.exposure > 0 ? '+' : ''}${L.exposure}).`) : '',
    slider({
      label: 'Luz en el rostro', value: L.faceBoost, min: 0, max: 0.6, step: 0.02, format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { L.faceBoost = v; E.changed(); },
      onChange: async () => { await E.player.prepareFx(); E.player.draw(); },
    }),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => E.go('luz') }, icon('bulb', 16), 'Guía de iluminación para grabar'),
    ]),

    h('h3', null, 'Estilo de color'),
    h('div', { class: 'chips' },
      Object.entries(LOOKS).map(([k, p]) => h('button', { class: `chip${C.preset === k ? ' active' : ''}`, onclick: () => { upd({ preset: k }); E.renderPanel(); } }, p.label))
    ),
    slider({ label: 'Exposición', value: C.brightness, min: 0.5, max: 1.6, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ brightness: v }) }),
    slider({ label: 'Contraste', value: C.contrast, min: 0.5, max: 1.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ contrast: v }) }),
    slider({ label: 'Saturación', value: C.saturation, min: 0, max: 2, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ saturation: v }) }),
    slider({ label: 'Temperatura (frío ↔ cálido)', value: C.temp || 0, min: -1, max: 1, step: 0.02, format: (v) => v.toFixed(2), onInput: (v) => upd({ temp: v }) }),
    slider({ label: 'Tinte (verde ↔ magenta)', value: C.tint || 0, min: -1, max: 1, step: 0.02, format: (v) => v.toFixed(2), onInput: (v) => upd({ tint: v }) }),
    h('h3', null, 'Calidad de cámara'),
    h('p', { class: 'hint' }, 'Mejora natural: limpia el ruido de la webcam, afina los bordes sin halos y agrega un grano fino para que la piel se vea real, no alisada.'),
    slider({ label: 'Limpieza de ruido', value: C.denoise ?? 0.45, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ denoise: v }) }),
    slider({ label: 'Nitidez natural', value: C.sharpen ?? 0.4, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ sharpen: v }) }),
    slider({ label: 'Grano fino (textura real)', value: C.grain ?? 0.3, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ grain: v }) }),
    slider({ label: 'Viñeta', value: C.vignette || 0, min: 0, max: 0.6, step: 0.02, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ vignette: v }) }),
    h('button', {
      class: 'btn btn-sm',
      onclick: () => {
        Object.assign(C, { preset: 'none', brightness: 1, contrast: 1, saturation: 1, temp: 0, tint: 0, vignette: 0, denoise: 0.45, sharpen: 0.4, grain: 0.3 });
        Object.assign(L, { auto: false, exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, faceBoost: 0, vignette: 0 });
        E.changed({ panelRefresh: true });
      },
    }, 'Restablecer'),
  ];
}

// ---------- IA ----------

function applyKeywords(project, on) {
  const idx = buildCaptionIndex(project);
  for (const [, e] of idx) {
    const kw = on ? pickKeywords(e.words, STOP) : new Set();
    e.words.forEach((w, i) => {
      if (kw.has(i)) w.kw = true;
      else delete w.kw;
    });
  }
  project.captions.keywords = on;
}

function applyEmojis(project, on) {
  const idx = buildCaptionIndex(project);
  for (const [, e] of idx) {
    const m = on ? autoEmojis(e.words, e.groups, 2) : new Map();
    e.words.forEach((w, i) => {
      if (m.has(i)) w.emoji = m.get(i);
      else delete w.emoji;
    });
  }
  project.captions.emojis = on;
}

async function faceTrackAll(E) {
  const { analyzeClip } = await import('../ai/face-track.js');
  const prog = progressModal('Siguiendo tu cara en el video…');
  try {
    for (let i = 0; i < E.project.clips.length; i++) {
      const c = E.project.clips[i];
      if (c.faceTrack?.length) continue;
      const res = await analyzeClip(await mediaUrl(c.mediaId), c.duration, {
        step: 0.4,
        onProgress: (p) => prog.set((i + p) / E.project.clips.length, `Toma ${i + 1} de ${E.project.clips.length}`),
        isCancelled: () => prog.cancelled,
      });
      if (!res) return false;
      c.faceTrack = res.track;
    }
    return true;
  } finally {
    prog.close();
  }
}

async function removeFillers(E) {
  const idx = buildCaptionIndex(E.project);
  const found = [];
  for (const [clip, e] of idx) for (const f of findFillers(e.words)) found.push({ clip, ...f, t0: e.words[f.from].t0, t1: e.words[f.to].t1, words: e.words.slice(f.from, f.to + 1) });
  if (!found.length) {
    if (E.project.captions.source !== 'ia') {
      if (await confirmDialog('Para encontrar muletillas necesito la transcripción exacta de tu voz (IA Whisper). ¿La hago ahora?', { title: 'Quitar muletillas', ok: 'Transcribir' })) {
        await E.captionsFromAI();
        if (E.project.captions.source === 'ia') return removeFillers(E);
      }
      return;
    }
    return toast('No encontré muletillas. ¡Muy bien hablado!', 'ok');
  }
  const checks = found.map(() => true);
  const v = await modal({
    title: `Muletillas encontradas: ${found.length}`,
    body: h('div', { class: 'list' },
      found.map((f, i) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => (checks[i] = cb.checked));
        return h('label', { class: 'list-item' }, cb, h('span', { class: 'grow' }, `«${f.text}»`), h('span', { class: 'muted small' }, `toma ${f.clip + 1} · ${fmtTime(f.t0, true)}`));
      })
    ),
    actions: [{ label: 'Cancelar', value: null }, { label: 'Cortar las marcadas', value: 'cut', kind: 'primary' }],
  });
  if (v !== 'cut') return;
  const drop = new Set();
  let n = 0;
  found.forEach((f, i) => {
    if (!checks[i]) return;
    cutSource(E.project, f.clip, Math.max(0, f.t0 - 0.03), f.t1 + 0.03);
    f.words.forEach((w) => drop.add(w));
    n++;
  });
  E.project.captions.words = E.project.captions.words.filter((w) => !drop.has(w));
  E.changed({ structure: true, captions: true, panelRefresh: true });
  toast(`${n} muletillas cortadas`, 'ok');
}

async function autoClips(E) {
  const tl = buildSegments(E.project);
  const cues = captionCues(tl, buildCaptionIndex(E.project));
  if (!cues.length) return toast('Primero crea los subtítulos: los uso para cortar en frases completas.');
  const target = 30;
  const max = 58;
  const chunks = [];
  let cur = null;
  for (const c of cues) {
    if (!cur) cur = { start: c.start, end: c.end, text: c.text };
    else {
      cur.end = c.end;
      cur.text += ` ${c.text}`;
    }
    const len = cur.end - cur.start;
    const sentenceEnd = /[.!?…]$/.test(c.text);
    if ((len >= target && sentenceEnd) || len >= max) {
      chunks.push(cur);
      cur = null;
    }
  }
  if (cur && cur.end - cur.start > 8) chunks.push(cur);
  if (chunks.length < 2) return toast('El video es corto: ya funciona como un solo clip.');
  const checks = chunks.map(() => true);
  const v = await modal({
    title: `Clips sugeridos: ${chunks.length}`,
    wide: true,
    body: h('div', { class: 'list' },
      chunks.map((c, i) => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => (checks[i] = cb.checked));
        return h('label', { class: 'list-item' }, cb, h('div', { class: 'grow' }, h('div', { class: 'title' }, `Clip ${i + 1} · ${fmtTime(c.end - c.start)}`), h('div', { class: 'sub' }, c.text.slice(0, 120))));
      })
    ),
    actions: [{ label: 'Cancelar', value: null }, { label: 'Crear clips', value: 'go', kind: 'primary' }],
  });
  if (v !== 'go') return;
  let n = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (!checks[i]) continue;
    const c = chunks[i];
    const copy = structuredClone(E.project);
    copy.id = uid('p_');
    copy.title = `${E.project.title} · Clip ${i + 1}`;
    copy.createdAt = copy.updatedAt = Date.now();
    copy.exports = [];
    copy.intro.enabled = false;
    trimAfter(copy, c.end + 0.15);
    trimBefore(copy, Math.max(0, c.start - 0.1));
    copy.headline.text = splitWords(c.text).slice(0, 8).join(' ');
    await saveProject(copy);
    n++;
  }
  toast(`${n} clips creados en Proyectos`, 'ok');
}

async function postWithAI(E) {
  const { generate, promptPost } = await import('../ai/llm.js');
  const { PLATFORMS } = await import('../core/platforms.js');
  let plat = 'Instagram Reels';
  const out = h('textarea', { class: 'input', rows: 12, placeholder: 'Aquí aparecerá el texto…' });
  const status = h('p', { class: 'hint' });
  const run = async () => {
    out.value = '';
    try {
      const texto = E.project.captions.words.map((w) => w.text).join(' ') || E.project.scriptText || E.project.title;
      out.value = await generate({
        prompt: promptPost({ texto, plataforma: plat, tema: E.project.title }),
        maxTokens: 420,
        onToken: (t) => (out.value = t),
        onStatus: (s) => (status.textContent = s),
        onProgress: (_p, s) => (status.textContent = s),
      });
      status.textContent = 'Listo. Revisa y ajusta antes de publicar.';
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
    }
  };
  modal({
    title: 'Título, descripción y hashtags con IA',
    wide: true,
    body: h('div', null,
      select({ label: 'Red social', value: plat, options: [...new Set(Object.values(PLATFORMS).map((p) => p.label))].map((l) => [l, l]), onChange: (v) => (plat = v) }),
      h('button', { class: 'btn btn-primary', onclick: run }, icon('magic', 18), 'Generar'),
      status,
      out
    ),
    actions: [{ label: 'Cerrar', value: null }, { label: 'Copiar', kind: 'primary', value: () => (copyText(out.value), null) }],
  });
}

/** Edición automática en un toque. */
export async function magicEdit(E) {
  const P = E.project;
  const prog = progressModal('Analizando tu video…');
  let info;
  try {
    prog.set(0.08, 'Analizando el audio…');
    await E.ensureAnalysis();
    const cutsByClip = P.clips.map((c) => {
      const a = E.analysis[c.mediaId];
      return a?.regions ? silenceCuts(findSilences(a.regions, c.duration, 0.55), c.duration, 0.12) : [];
    });
    const silN = cutsByClip.reduce((n, l) => n + l.length, 0);
    const silSec = cutsByClip.reduce((n, l) => n + l.reduce((s2, c) => s2 + (c.end - c.start), 0), 0);
    let light = null;
    if (!prog.cancelled) {
      prog.set(0.4, 'Midiendo la luz…');
      try {
        const { analyzeClip } = await import('../ai/face-track.js');
        const c = P.clips[0];
        const res = await Promise.race([
          analyzeClip(await mediaUrl(c.mediaId), c.duration, { step: Math.max(0.5, c.duration / 10) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), 25000)),
        ]);
        if (res?.track?.length) c.faceTrack = res.track;
        light = res?.light || null;
      } catch (e) {
        console.warn('Análisis de luz', e);
      }
    }
    info = { cutsByClip, silN, silSec, light };
  } catch (e) {
    prog.close();
    toast(`No se pudo analizar: ${e.message}`, 'error', 6000);
    return;
  }
  prog.close();

  // Sugerencias según lo que realmente tiene el video. La corrección de luz es opcional y solo se sugiere si hace falta.
  const hasCaps = P.captions.words.length > 0 || !!(P.scriptText || '').trim();
  const lightScore = info.light?.score ?? 100;
  const total = buildSegments(P).total;
  const cutCount = Math.max(0, buildSegments(P).segs?.length ? buildSegments(P).segs.length - 1 : 0);
  let fillerN = 0;
  try {
    if (P.captions.source === 'ia') for (const [, e] of buildCaptionIndex(P)) fillerN += findFillers(e.words).length;
  } catch { /* sin transcripción exacta */ }
  // Cada sugerencia se marca solo si el análisis muestra que realmente aporta. La luz NUNCA viene marcada: es opcional.
  const sel = {
    silences: info.silSec >= 1,
    fillers: fillerN >= 2,
    keywords: hasCaps && total >= 12,
    zoom: total >= 20,
    light: false,
    music: false,
    sfx: false, // los sonidos automáticos ya no se ofrecen: los eliges tú en Biblioteca › Sonidos
    lowerThird: !!E.brand.name && !P.brand.lowerThird.enabled,
  };
  let lightStrength = 0.5;
  const row = (key, label, hint) => toggle({ label, hint, checked: sel[key], onChange: (v) => (sel[key] = v) });
  const go = await modal({
    title: 'Edición con IA: elige qué aplicar',
    body: h('div', null,
      h('p', { class: 'hint' }, 'Marqué lo más conveniente para este video. Todo se puede cambiar o deshacer después.'),
      h('p', { class: 'hint' }, `Tu video dura ${fmtTime(total)}${info.silN ? ` y tiene ${info.silN} pausa${info.silN === 1 ? '' : 's'} larga${info.silN === 1 ? '' : 's'} (${info.silSec.toFixed(1)} s en total)` : ''}.`),
      row('silences', info.silN ? `Quitar silencios (${info.silN}, ${info.silSec.toFixed(1)} s)` : 'Quitar silencios', info.silN ? (info.silSec >= 1 ? 'Hace el video más ágil; las pausas cortas se respetan' : 'Son pocos; solo si quieres') : 'No se encontraron silencios largos'),
      row('fillers', fillerN ? `Quitar muletillas (${fillerN} encontradas)` : 'Quitar muletillas', fillerN ? 'Te muestro cada una para que confirmes antes de cortar' : P.captions.source === 'ia' ? 'No se encontraron muletillas' : 'Necesita la transcripción de tu voz (Subtítulos › IA)'),
      row('keywords', 'Resaltar palabras clave en los subtítulos', hasCaps ? 'Una palabra destacada por frase' : 'Necesita subtítulos o guion'),
      row('zoom', 'Zoom leve alternado en los cortes', total >= 20 ? 'Da ritmo a un video largo; cortes directos' : 'Tu video es corto; no hace falta'),
      row('light', 'Mejorar luz y color (opcional)', info.light ? `Tu luz sacó ${lightScore}/100. ${lightScore < 55 ? 'Podría mejorar un poco, pero tú decides.' : 'Está bien; déjala como está.'}` : 'No se pudo medir la luz'),
      segmented({ label: 'Intensidad de la luz', value: 'suave', options: [['suave', 'Suave'], ['media', 'Media']], onChange: (v) => (lightStrength = v === 'media' ? 0.8 : 0.5) }),
      row('music', 'Música de fondo suave', P.audio.musicId ? 'Ya tienes música' : 'Original, sin derechos; opcional'),
      row('lowerThird', 'Mostrar tu nombre (tercio inferior)', E.brand.name ? E.brand.name : 'Configura tu marca para usarlo')
    ),
    actions: [{ label: 'Cancelar', value: null }, { label: 'Aplicar', value: 'go', kind: 'primary' }],
  });
  if (go !== 'go') return;

  const steps = [];
  const run = progressModal('Editando…');
  try {
    if (sel.silences) {
      P.clips.forEach((c, i) => (c.cuts = mergeCuts([...(c.cuts || []), ...info.cutsByClip[i]])));
      steps.push(`${info.silN} silencios quitados`);
      E.player.rebuild();
    }
    if (!P.captions.words.length && hasCaps && (P.scriptText || '').trim()) {
      run.set(0.3, 'Creando subtítulos desde el guion…');
      await E.captionsFromText(P.scriptText, 'guion');
    }
    if (sel.keywords && P.captions.words.length) {
      applyKeywords(P, true);
      applyEmojis(P, false);
      steps.push('palabras clave destacadas en subtítulos');
    }
    if (sel.zoom) {
      P.layout.dynamicZoom = true;
      P.layout.transition = 'none';
      steps.push('cortes directos con zoom leve');
    }
    if (sel.light && info.light) {
      const g = autoGrade(info.light.metrics);
      const k = lightStrength; // corrección suave (0,5) o media (0,8); nunca deforma la imagen
      Object.assign(P.fx.light, {
        auto: true,
        exposure: +(g.exposure * k).toFixed(2),
        contrast: +(1 + (g.contrast - 1) * k).toFixed(3),
        saturation: +(1 + (g.saturation - 1) * k).toFixed(3),
        temp: +(g.temp * k).toFixed(2),
        tint: +(g.tint * k).toFixed(2),
        faceBoost: +(g.faceBoost * k).toFixed(2),
        vignette: 0,
      });
      steps.push(`luz mejorada de forma ${lightStrength > 0.6 ? 'media' : 'suave'} (se ajusta o apaga en «Luz y color»)`);
    }
    if (sel.music && !P.audio.musicId && !run.cancelled) {
      run.set(0.6, 'Componiendo música de fondo…');
      const style = /ansiedad|calma|dormir|emoci|duelo|triste/i.test(`${P.title} ${P.scriptText}`) ? 'calma' : 'inspirador';
      const rec = await makeMusic(style, buildSegments(P).total + 3, Math.floor(Math.random() * 1000));
      Object.assign(P.audio, { musicId: rec.id, musicName: rec.name, musicVol: 0.1, duck: true, fade: true });
      steps.push(`música «${rec.name}»`);
    }
    if (sel.lowerThird && E.brand.name) {
      P.brand.lowerThird.enabled = true;
      steps.push('tu nombre en pantalla');
    }
    if (sel.sfx) {
      const { autoSfx } = await import('../core/sfx.js');
      P.audio.sfx = autoSfx(buildSegments(P));
      P.audio.sfxOn = true;
      if (P.audio.sfx.length) steps.push(`${P.audio.sfx.length} sonidos de transición suaves`);
    }
    run.set(0.95, 'Aplicando…');
    await E.player.load();
    E.changed({ structure: true, captions: true, music: true, panelRefresh: true });
    run.close();
    if (sel.fillers && fillerN) {
      await removeFillers(E); // el usuario confirma cada muletilla
      steps.push('muletillas revisadas');
    }
    modal({
      title: 'Edición con IA lista',
      body: h('div', null, steps.length ? h('ul', { class: 'install-steps' }, steps.map((x) => h('li', null, x))) : h('p', null, 'No aplicaste cambios.'), h('p', { class: 'hint' }, 'Todo se puede ajustar o deshacer (flecha ↶ arriba).')),
      actions: [{ label: 'Ver resultado', value: null, kind: 'primary' }],
    });
  } catch (e) {
    run.close();
    toast(`Error en la edición con IA: ${e.message}`, 'error', 6000);
  }
}

export function panelAI(E) {
  const P = E.project;
  const cap = P.captions;
  const hasCaps = cap.words.length > 0;
  return [
    h('div', { class: 'card ai-hero' },
      h('h2', null, '✨ Edición automática'),
      h('p', { class: 'muted small' }, 'Quita silencios, agrega cortes con zoom leve, destaca palabras clave y, si tú quieres, mejora la luz y agrega música. Solo te propone lo que el análisis de tu video muestra que conviene; todo ajustable después.'),
      h('button', { class: 'btn btn-primary btn-block', onclick: () => magicEdit(E) }, icon('magic', 18), 'Editar automáticamente')
    ),
    h('h3', null, 'Subtítulos inteligentes'),
    hasCaps ? '' : h('p', { class: 'hint' }, 'Crea primero los subtítulos (pestaña Subtítulos).'),
    toggle({ label: 'Resaltar palabras clave', checked: !!cap.keywords, onChange: (v) => { applyKeywords(P, v); E.changed({ captions: true }); } }),
    colorPick({ label: 'Color de las palabras clave', value: cap.style.kwColor || cap.style.hlColor, onChange: (v) => { cap.style.kwColor = v; E.changed({ captions: true }); } }),
    toggle({ label: 'Emojis automáticos', checked: !!cap.emojis, onChange: (v) => { applyEmojis(P, v); E.changed({ captions: true }); } }),
    h('button', { class: 'btn btn-sm', onclick: () => removeFillers(E) }, icon('cut', 16), 'Quitar muletillas (eh, o sea, cachai…)'),
    ...(IS_MOBILE ? [] : [
    h('h3', null, 'Imagen'),
    toggle({
      label: 'Encuadre automático (sigue tu cara)',
      hint: 'Ideal al pasar un video horizontal a vertical.',
      checked: !!P.fx.reframe.enabled,
      onChange: async (v) => {
        if (v && !(await faceTrackAll(E))) return E.renderPanel();
        P.fx.reframe.enabled = v;
        E.changed({ panelRefresh: true });
      },
    }),
    toggle({
      label: 'Contacto visual IA (beta)',
      hint: 'Corrige la mirada hacia la cámara cuando lees el teleprompter.',
      checked: !!P.fx.gaze.enabled,
      onChange: async (v) => {
        P.fx.gaze.enabled = v;
        if (v) {
          const done = loading('Cargando la IA de rostro…');
          try {
            await E.player.prepareFx();
          } finally {
            done();
          }
        }
        E.changed({ panelRefresh: true });
      },
    }),
    P.fx.gaze.enabled ? slider({ label: 'Intensidad', value: P.fx.gaze.strength, min: 0.2, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { P.fx.gaze.strength = v; E.changed(); } }) : '',
    h('button', { class: 'btn btn-sm', onclick: async () => lightReport(await analyzeLight(E)) }, icon('bulb', 16), 'Mejorar iluminación'),
    ]),

    h('h3', null, 'Contenido'),
    h('button', { class: 'btn btn-sm', onclick: () => autoClips(E) }, icon('film', 16), 'Crear clips cortos automáticamente'),
    h('button', { class: 'btn btn-sm', onclick: () => postWithAI(E) }, icon('text', 16), 'Título, descripción y hashtags con IA'),
    h('button', { class: 'btn btn-sm', onclick: () => E.go('ia') }, icon('magic', 16), 'Estudio IA (guiones, fondos, portadas)'),
  ];
}

// ---------- Capas ----------

const STICKERS = ['😊', '😢', '😰', '🧠', '❤️', '💡', '✅', '❌', '⚠️', '🔥', '👏', '🙌', '💪', '🧘', '🌱', '⭐', '🎯', '📌', '👉', '💬', '🤔', '😮', '🙏', '✨'];

export function panelLayers(E) {
  const P = E.project;
  P.overlays ||= [];
  const total = E.player.total;
  const sel = P.overlays.find((o) => o.id === E.state.selOverlay);
  const add = (ov) => {
    const start = clamp(E.player.t, 0, Math.max(0, total - 0.5));
    const o = { id: uid('o_'), start, end: Math.min(total, start + 3), x: 0.5, y: 0.3, anim: 'pop', ...ov };
    P.overlays.push(o);
    E.state.selOverlay = o.id;
    return o;
  };
  const addMediaLayer = async () => {
    const m = await pickMedia(null, 'Imagen o video para la capa');
    if (!m) return;
    const o = add({ kind: 'broll', mediaId: m.id, mediaKind: m.kind, layout: 'full', anim: 'fade', name: m.name });
    if (m.kind === 'video' && m.duration) o.end = Math.min(total, o.start + Math.min(m.duration, 6));
    await E.player.loadOverlays();
    E.changed({ panelRefresh: true });
  };
  const list = h('div', { class: 'list' },
    [...P.overlays].sort((a, b) => a.start - b.start).map((o) =>
      h('div', { class: `list-item${o.id === E.state.selOverlay ? ' selected' : ''}` },
        h('span', null, o.kind === 'broll' ? (o.mediaKind === 'video' ? '🎬' : '🖼️') : o.kind === 'sticker' ? o.emoji : o.kind === 'shape' ? '⬛' : '🔤'),
        h('button', { class: 'grow', style: { all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }, onclick: () => { E.state.selOverlay = o.id; E.player.seek(o.start + 0.01); E.renderPanel(); } },
          h('div', { class: 'title' }, o.kind === 'broll' ? o.name || 'B-roll' : o.kind === 'shape' ? SHAPES[o.shape] || 'Forma' : o.text || o.emoji || 'Texto'),
          h('div', { class: 'sub' }, `${fmtTime(o.start, true)} – ${fmtTime(o.end, true)}`)
        ),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Eliminar capa',
          onclick: async () => {
            P.overlays = P.overlays.filter((x) => x !== o);
            await E.player.loadOverlays();
            E.changed({ panelRefresh: true });
          },
        }, icon('trash', 18))
      )
    )
  );
  const nodes = [
    h('p', { class: 'hint' }, 'Agrega textos, emojis e imágenes o videos de apoyo (B-roll) en el momento del cursor.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', onclick: () => { add({ kind: 'text', text: 'Escribe aquí', size: 7, color: '#FFFFFF', box: true, boxColor: E.brand.primary || '#000000', boxOpacity: 0.85, font: 'impact', upper: true }); E.changed({ panelRefresh: true }); } }, icon('text', 16), 'Texto'),
      h('button', { class: 'btn btn-sm', onclick: () => { add({ kind: 'sticker', emoji: '✨', size: 16, x: 0.78, y: 0.2 }); E.changed({ panelRefresh: true }); } }, '😊 Emoji'),
      h('button', { class: 'btn btn-sm', onclick: addMediaLayer }, icon('image', 16), 'Imagen o video')
    ),
    P.overlays.length ? list : '',
  ];
  if (sel) {
    const upd = (patch, reload = false) => {
      Object.assign(sel, patch);
      if (reload) E.player.loadOverlays().then(() => E.player.draw());
      E.changed();
    };
    nodes.push(h('h3', null, 'Capa seleccionada'));
    if (sel.kind === 'shape') {
      nodes.push(
        select({ label: 'Forma', value: sel.shape, options: Object.entries(SHAPES), onChange: (v) => upd({ shape: v }) }),
        colorPick({ label: 'Color', value: sel.color || '#FFD166', onChange: (v) => upd({ color: v }) }),
        toggle({ label: 'Relleno', checked: sel.fill !== false, onChange: (v) => upd({ fill: v }) }),
        slider({ label: 'Ancho', value: sel.w ?? 0.4, min: 0.03, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ w: v }) }),
        slider({ label: 'Alto', value: sel.h ?? 0.12, min: 0.01, max: 0.8, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ h: v }) }),
        slider({ label: 'Grosor de línea', value: sel.line ?? 0.8, min: 0.2, max: 3, step: 0.1, onInput: (v) => upd({ line: v }) })
      );
    }
    if (sel.kind === 'text') {
      nodes.push(
        textInput({ label: 'Texto', value: sel.text, multiline: true, rows: 2, onInput: (v) => upd({ text: v }) }),
        select({ label: 'Fuente', value: sel.font || 'impact', options: Object.entries(FONTS).map(([k, f]) => [k, f.label]), onChange: (v) => upd({ font: v }) }),
        toggle({ label: 'MAYÚSCULAS', checked: !!sel.upper, onChange: (v) => upd({ upper: v }) }),
        toggle({ label: 'Caja de fondo', checked: !!sel.box, onChange: (v) => upd({ box: v }) }),
        h('div', { class: 'two' },
          colorPick({ label: 'Texto', value: sel.color, onChange: (v) => upd({ color: v }) }),
          colorPick({ label: 'Caja', value: sel.boxColor || '#000000', onChange: (v) => upd({ boxColor: v }) })
        )
      );
    }
    if (sel.kind === 'sticker') {
      nodes.push(h('div', { class: 'sticker-grid' }, STICKERS.map((s) => h('button', { class: `sticker${sel.emoji === s ? ' active' : ''}`, onclick: () => { upd({ emoji: s }); E.renderPanel(); } }, s))));
    }
    if (sel.kind === 'broll') {
      nodes.push(
        segmented({ label: 'Forma', value: sel.layout, options: [['full', 'Pantalla completa'], ['pip', 'Recuadro'], ['free', 'Libre (sin marco)']], onChange: (v) => { upd({ layout: v, y: v === 'pip' ? 0.3 : v === 'free' ? 0.25 : sel.y, w: v === 'free' ? sel.w || 0.35 : sel.w }); E.renderPanel(); } }),
        ...(IS_MOBILE ? [] : [select({ label: 'Modo de fusión', value: sel.blend || 'source-over', options: [['source-over', 'Normal'], ['screen', 'Pantalla (luces)'], ['overlay', 'Superponer'], ['multiply', 'Multiplicar (oscurece)'], ['soft-light', 'Luz suave'], ['lighten', 'Aclarar'], ['color-dodge', 'Sobreexponer color']], onChange: (v) => upd({ blend: v === 'source-over' ? undefined : v }) })]),
        h('button', { class: 'btn btn-sm', onclick: async () => { const m = await pickMedia(null, 'Cambiar archivo'); if (m) { upd({ mediaId: m.id, mediaKind: m.kind, name: m.name }, true); E.renderPanel(); } } }, 'Cambiar archivo')
      );
    }
    if (sel.kind !== 'broll' || sel.layout === 'pip' || sel.layout === 'free') {
      nodes.push(
        slider({ label: 'Posición horizontal', value: sel.x, min: 0.05, max: 0.95, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ x: v }) }),
        slider({ label: 'Posición vertical', value: sel.y, min: 0.05, max: 0.95, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ y: v }) })
      );
      if (sel.kind === 'broll') nodes.push(slider({ label: 'Tamaño', value: sel.w || 0.45, min: 0.08, max: 0.95, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ w: v }) }));
      else if (sel.kind !== 'shape') nodes.push(slider({ label: 'Tamaño', value: sel.size, min: 3, max: 30, step: 0.5, onInput: (v) => upd({ size: v }) }));
    }
    nodes.push(
      select({ label: 'Animación', value: sel.anim, options: [['none', 'Ninguna'], ['fade', 'Fundido'], ['pop', 'Pop'], ['slide', 'Deslizar'], ...(IS_MOBILE ? [] : [['type', 'Máquina de escribir'], ['bounce', 'Rebote'], ['blur', 'Desenfoque'], ['zoomout', 'Zoom de impacto'], ['draw', 'Trazo (formas)']])], onChange: (v) => upd({ anim: v }) }),
      ...(IS_MOBILE ? [] : [
        slider({ label: 'Giro', value: sel.rot || 0, min: -45, max: 45, step: 1, format: (v) => `${v}°`, onInput: (v) => upd({ rot: v }) }),
        slider({ label: 'Opacidad', value: sel.opacity ?? 1, min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ opacity: v }) }),
      ]),
      slider({ label: 'Aparece en', value: sel.start, min: 0, max: Math.max(0.1, total - 0.2), step: 0.1, format: (v) => fmtTime(v, true), onInput: (v) => upd({ start: v, end: Math.max(v + 0.3, sel.end) }) }),
      slider({ label: 'Duración', value: sel.end - sel.start, min: 0.3, max: Math.max(0.5, Math.min(60, total)), step: 0.1, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => upd({ end: Math.min(total, sel.start + v) }) }),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
        h('button', { class: 'btn btn-sm', onclick: () => { const d = sel.end - sel.start; upd({ start: E.player.t, end: Math.min(total, E.player.t + d) }); E.renderPanel(); } }, 'Mover al cursor'),
        // Orden de capas (como «Traer al frente / Enviar atrás» de un editor pro): las de más abajo en la lista se dibujan encima.
        h('button', { class: 'btn btn-sm', title: 'Dibujar encima de las demás capas', onclick: () => { const L = E.project.overlays; L.splice(L.indexOf(sel), 1); L.push(sel); E.changed({ panelRefresh: true }); } }, 'Al frente'),
        h('button', { class: 'btn btn-sm', title: 'Dibujar debajo de las demás capas', onclick: () => { const L = E.project.overlays; L.splice(L.indexOf(sel), 1); L.unshift(sel); E.changed({ panelRefresh: true }); } }, 'Atrás'),
        h('button', { class: 'btn btn-sm', onclick: () => { const c = { ...structuredClone(sel), id: uid('o_') }; const d = c.end - c.start; c.start = Math.min(total - 0.3, sel.end); c.end = Math.min(total, c.start + d); E.project.overlays.push(c); E.changed({ panelRefresh: true }); toast('Capa duplicada a continuación.', 'ok'); } }, 'Duplicar')
      )
    );
  }
  return nodes;
}

// ---------- Música ----------

export async function makeMusic(style, seconds, variant = 0) {
  const { generateMusic, MUSIC_STYLES, toWav } = await import('../core/music-gen.js');
  const buf = await generateMusic(style, { seconds: Math.max(30, seconds), variant });
  normalizeLoudness([...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c)), buf.sampleRate, -18, -1.5);
  const name = `${MUSIC_STYLES[style].label} ${variant % 100}`;
  return addMedia({ blob: toWav(buf), name, kind: 'audio', duration: buf.duration, extra: { library: true, generated: true } });
}

export function musicLibrary(E) {
  const box = h('div', { class: 'music-lib' });
  import('../core/music-gen.js').then(({ MUSIC_STYLES }) => {
    box.replaceChildren(
      h('p', { class: 'hint' }, 'Música original creada en tu dispositivo: sin derechos de autor, no te bloquean en redes.'),
      h('div', { class: 'music-grid' },
        Object.entries(MUSIC_STYLES).map(([k, s]) =>
          h('button', {
            class: 'music-card',
            onclick: async () => {
              const done = loading(`Componiendo «${s.label}»…`);
              try {
                const rec = await makeMusic(k, buildSegments(E.project).total + 3, Math.floor(Math.random() * 1000));
                Object.assign(E.project.audio, { musicId: rec.id, musicName: rec.name, musicVol: E.project.audio.musicVol || 0.18 });
                E.changed({ music: true, panelRefresh: true });
                toast(`Música «${rec.name}» agregada`, 'ok');
              } catch (e) {
                toast(`No se pudo generar: ${e.message}`, 'error');
              } finally {
                done();
              }
            },
          }, h('b', null, s.label), h('small', null, s.desc))
        )
      )
    );
  });
  return box;
}

