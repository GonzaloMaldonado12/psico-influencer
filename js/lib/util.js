// Utilidades puras (sin DOM al importar): se usan en el navegador y en las pruebas de Node.

export const uid = (prefix = '') =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round3 = (v) => Math.round(v * 1000) / 1000;

export function fmtTime(s, tenths = false) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  if (tenths) {
    const total = Math.round(s * 10);
    const m = Math.floor(total / 600);
    const rest = (total - m * 600) / 10;
    return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
  }
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  return `${m}:${String(total - m * 60).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(ts) {
  try {
    const d = new Date(ts);
    if (!ts || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export function debounce(fn, ms) {
  let timer = null;
  let lastArgs = [];
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, ms);
  };
  d.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn(...lastArgs);
    }
  };
  d.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return d;
}

/** Minúsculas, sin tildes ni signos: sirve para comparar palabras dichas con el guion. */
export function normalizeWord(w) {
  return String(w ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function splitWords(text) {
  return String(text ?? '').split(/\s+/).filter(Boolean);
}

/** Estimación de sílabas (grupos vocálicos). Tokens sin letras (emojis, signos) valen 0. */
export function countSyllables(word) {
  const w = normalizeWord(word);
  if (!w) return 0;
  if (/^\d+$/.test(w)) return Math.max(1, Math.min(6, w.length));
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function even(n) {
  const r = Math.round(n);
  return r % 2 ? r - 1 : r;
}

export function deepMerge(defaults, obj) {
  if (Array.isArray(defaults)) return Array.isArray(obj) ? obj : structuredClone(defaults);
  if (defaults && typeof defaults === 'object') {
    const src = obj && typeof obj === 'object' ? obj : {};
    const out = { ...src };
    for (const k of Object.keys(defaults)) {
      out[k] = k in src ? deepMerge(defaults[k], src[k]) : structuredClone(defaults[k]);
    }
    return out;
  }
  return obj === undefined ? defaults : obj;
}

export function sanitizeFilename(name) {
  return (
    String(name || 'video')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'video'
  );
}

/** iPhone/iPad/Android: modo ligero (sin fondo virtual ni IA de rostro, para cuidar la batería). */
export const IS_IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const IS_MOBILE = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
/** Celular o tablet: la app es un estudio de grabación (la edición completa vive en el programa de PC). */
export const MOBILE_APP = IS_MOBILE && !(typeof window !== 'undefined' && window.psicoDesktop);
export const APP_VERSION = '2.5.0';
