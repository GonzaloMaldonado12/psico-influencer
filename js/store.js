// Modelo de datos, valores por defecto y acceso a medios.
import { db } from './lib/db.js';
import { uid, deepMerge, even } from './lib/util.js';
import { presetStyle } from './core/captions.js';
import { DEFAULT_FX } from './core/effects.js';

export const ASPECTS = {
  '9:16': { label: 'Vertical 9:16', hint: 'Reels, TikTok, Shorts', size: [1080, 1920] },
  '1:1': { label: 'Cuadrado 1:1', hint: 'Feed de Instagram, Facebook', size: [1080, 1080] },
  '4:5': { label: 'Retrato 4:5', hint: 'Feed de Instagram', size: [1080, 1350] },
  '16:9': { label: 'Horizontal 16:9', hint: 'YouTube, LinkedIn, web', size: [1920, 1080] },
};

export function exportSize(aspect, quality = '1080') {
  const [w, h] = (ASPECTS[aspect] || ASPECTS['9:16']).size;
  const f = quality === '720' ? 2 / 3 : 1;
  return [even(w * f), even(h * f)];
}

export function previewSize(aspect) {
  const [w, h] = (ASPECTS[aspect] || ASPECTS['9:16']).size;
  const f = 960 / Math.max(w, h);
  return [even(w * f), even(h * f)];
}

export const DEFAULT_SETTINGS = {
  lang: 'es-CL',
  wpm: 140,
  exportQuality: '1080',
  recordQuality: '1080', // 1080p: más fluido y liviano; 4K queda como opción en Grabar > Ajustes
  camLock: true,
  spkId: null, // salida de audio elegida
  recordFps: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 30 : 60, // 60 fps en PC: movimiento más fluido
  camId: null,
  micId: null,
  studioAudio: false, // micrófono de estudio: sin procesado del navegador
  prompter: {
    fontSize: 30,
    heightPct: 42,
    opacity: 0.55,
    mirror: false,
    voiceFollow: false,
    countdown: 3,
    lineY: 0.3,
    margin: 6,
  },
};

export function defaultBrand() {
  return {
    name: '',
    role: '',
    handle: '',
    logoMediaId: null,
    primary: '#6C4DFF',
    secondary: '#00D2D3',
    textColor: '#FFFFFF',
    bg: '#101018',
    captionPreset: 'karaoke',
    introText: '',
    outroText: '¡Sígueme para más!',
    useLowerThird: true,
    useLogo: true,
    useOutro: false,
    useProgress: false,
  };
}

function projectDefaults() {
  return {
    id: '',
    title: 'Nuevo video',
    createdAt: 0,
    updatedAt: 0,
    scriptId: null,
    scriptText: '',
    clips: [],
    speed: 1,
    layout: {
      aspect: '9:16',
      mode: 'full', // full | titled | blur | frame
      zoom: 1, // plano cerrado por defecto: sin bordes difuminados (el plano medio se elige a mano)
      offsetX: 0,
      offsetY: 0,
      mirror: false,
      bg: '#101018',
      dynamicZoom: false,
      transition: 'none', // none | zoom | fade | flash
    },
    fx: structuredClone(DEFAULT_FX),
    overlays: [],
    audioClips: [], // audios importados puestos en la línea de tiempo [{id, mediaId, name, start, end, in, vol, fadeIn, fadeOut}]
    effects: [], // efectos por rango [{id, kind, start, end, amount}] (solo PC)
    markers: [], // marcadores [{id, t}]
    transitions: {}, // transición por corte { 'clip@src0': {kind, dur} }
    headline: {
      text: '',
      overlay: 'none', // none | always | start
      font: 'impact',
      sizePct: 7.5,
      color: '#FFFFFF',
      boxColor: '#000000',
      boxOpacity: 0.55,
      upper: true,
    },
    captions: {
      enabled: true,
      words: [],
      source: null,
      pending: null, // 'script' | 'hints' → se generan al abrir el editor
      style: presetStyle('karaoke'),
    },
    audio: {
      voiceVol: 1,
      enhance: true,
      musicId: null,
      musicName: '',
      musicVol: 0.22,
      duck: true,
      musicOffset: 0,
      fade: true,
      sfx: [], // efectos de sonido [{t, kind, vol}] en segundos de la línea de tiempo
      sfxOn: true,
    },
    color: { preset: 'none', brightness: 1, contrast: 1, saturation: 1, temp: 0, tint: 0, vignette: 0, denoise: 0.45, sharpen: 0.4, grain: 0.3 },
    brand: {
      logo: true,
      logoPos: 'tr',
      logoSize: 0.16,
      logoOpacity: 0.92,
      handle: false,
      lowerThird: { enabled: false, name: '', role: '', start: 0.6, dur: 4, pos: 'bottom' },
      progress: { enabled: false, pos: 'bottom' },
    },
    intro: { enabled: false, duration: 2, text: '' },
    outro: { enabled: false, duration: 2.5, text: '¡Sígueme para más!' },
    cover: { time: 0, text: '' },
    thumb: null,
    exports: [],
  };
}

export function migrateProject(p) {
  return deepMerge(projectDefaults(), p);
}

export function newProject({ title, clips = [], scriptId = null, aspect, brand } = {}) {
  const p = projectDefaults();
  p.id = uid('p_');
  p.createdAt = p.updatedAt = Date.now();
  p.title = title || `Video ${new Date().toLocaleDateString('es')}`;
  p.scriptId = scriptId;
  p.clips = clips.map(clipFrom);
  if (aspect) p.layout.aspect = aspect;
  if (brand) applyBrandDefaults(p, brand);
  return p;
}

export function clipFrom(m) {
  return { mediaId: m.id, duration: m.duration, width: m.width || 0, height: m.height || 0, in: 0, out: m.duration, cuts: [], name: m.name || '' };
}

export function applyBrandDefaults(p, brand) {
  p.layout.bg = brand.bg || p.layout.bg;
  p.captions.style = presetStyle(brand.captionPreset || 'karaoke');
  p.brand.logo = !!brand.useLogo;
  p.brand.handle = !!brand.handle;
  p.brand.lowerThird.enabled = !!(brand.useLowerThird && brand.name);
  p.brand.progress.enabled = !!brand.useProgress;
  p.outro.enabled = !!brand.useOutro;
  p.outro.text = brand.outroText || p.outro.text;
  p.intro.text = brand.introText || '';
  if (brand.stdBg) Object.assign(p.fx.bg, brand.stdBg); // mi fondo estándar
}

export async function saveProject(p) {
  p.updatedAt = Date.now();
  return db.put('projects', p);
}

export async function getSettings() {
  const s = await db.getKV('settings', {});
  return deepMerge(DEFAULT_SETTINGS, s);
}

export async function saveSettings(s) {
  return db.setKV('settings', s);
}

export async function getBrand() {
  return deepMerge(defaultBrand(), await db.getKV('brand', {}));
}

export async function saveBrand(b) {
  return db.setKV('brand', b);
}

// ---------- Medios ----------

const urlCache = new Map();

export async function addMedia({ blob, name = '', kind = 'video', duration = 0, width = 0, height = 0, extra = {} }) {
  const rec = { id: uid('m_'), blob, type: blob.type, size: blob.size, name, kind, duration, width, height, createdAt: Date.now(), ...extra };
  await db.put('media', rec);
  return rec;
}

export async function mediaUrl(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await db.get('media', id);
  if (!rec?.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

export async function deleteMedia(id) {
  if (!id) return;
  const url = urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(id);
  await db.del('media', id);
}

export async function updateMedia(id, patch) {
  const rec = await db.get('media', id);
  if (!rec) return null;
  Object.assign(rec, patch);
  await db.put('media', rec);
  return rec;
}

function projectMediaIds(p) {
  return [...p.clips.map((c) => c.mediaId), p.audio?.musicId, ...(p.exports || []).map((e) => e.mediaId)].filter(Boolean);
}

/** Borra un proyecto y los medios que ningún otro proyecto usa. */
export async function deleteProject(p) {
  const all = await db.all('projects');
  const used = new Set();
  for (const other of all) if (other.id !== p.id) projectMediaIds(other).forEach((id) => used.add(id));
  const brand = await getBrand();
  if (brand.logoMediaId) used.add(brand.logoMediaId);
  for (const id of projectMediaIds(p)) if (!used.has(id)) await deleteMedia(id);
  await db.del('projects', p.id);
}

export async function duplicateProject(p) {
  const copy = structuredClone(p);
  copy.id = uid('p_');
  copy.title = `${p.title} (copia)`;
  copy.createdAt = copy.updatedAt = Date.now();
  copy.exports = [];
  await db.put('projects', copy);
  return copy;
}
