// Banco de transiciones, efectos y formas para el editor (solo PC). Todo se dibuja con canvas 2D, sin archivos.
// Transiciones: se aplican al inicio del segmento que entra (p va de 0 a 1 durante `dur`).
// Efectos: rangos de la línea de tiempo con intensidad; afectan a la capa de video (no a textos ni subtítulos).
import { IS_MOBILE } from '../lib/util.js';
import { GL_NAMES, GL_RECOMMENDED, glLabel } from './gl-transitions.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (x) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------- lienzos auxiliares ----------
const pool = [];
function scratch(i, w, h) {
  let c = pool[i];
  if (!c) c = pool[i] = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.filter = 'none';
  x.clearRect(0, 0, w, h);
  return [c, x];
}
function grab(ctx, box, i = 0) {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const [c, x] = scratch(i, w, h);
  x.drawImage(ctx.canvas, Math.round(box.x), Math.round(box.y), w, h, 0, 0, w, h);
  return [c, x, w, h];
}

// ---------- TRANSICIONES ----------
// fn(p, e, box) → { zoom, dx, dy, rot, blur, filter, overlay, post(ctx, box) }   (e = 1 - p)
const black = (a) => `rgba(0,0,0,${clamp(a, 0, 1)})`;
const white = (a) => `rgba(255,255,255,${clamp(a, 0, 1)})`;

function sliceGlitch(ctx, box, amt, seed) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const y = box.y + hash(seed + i * 3.1) * box.h;
    const h = (0.02 + hash(seed + i * 7.7) * 0.08) * box.h;
    const off = (hash(seed + i * 5.3) - 0.5) * box.w * 0.25 * amt;
    ctx.drawImage(ctx.canvas, box.x, y, box.w, h, box.x + off, y, box.w, h);
  }
}

function chromatic(ctx, box, px) {
  if (px < 0.5) return;
  const [src, , w, h] = grab(ctx, box, 0);
  const chan = (i, color) => {
    const [c, x] = scratch(i, w, h);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    return c;
  };
  const r = chan(1, '#ff0000');
  const g = chan(2, '#00ff00');
  const b = chan(3, '#0000ff');
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(r, box.x - px, box.y);
  ctx.drawImage(g, box.x, box.y);
  ctx.drawImage(b, box.x + px, box.y);
  ctx.restore();
}

function pixelate(ctx, box, size) {
  if (size < 2) return;
  const [src, , w, h] = grab(ctx, box, 0);
  const sw = Math.max(2, Math.round(w / size));
  const sh = Math.max(2, Math.round(h / size));
  const [sm, sx] = scratch(1, sw, sh);
  sx.drawImage(src, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sm, 0, 0, sw, sh, box.x, box.y, box.w, box.h);
  ctx.restore();
}

function lightLeak(ctx, box, a, seed = 0) {
  const cx = box.x + box.w * (0.2 + 0.6 * hash(seed));
  const g = ctx.createRadialGradient(cx, box.y + box.h * 0.2, 0, cx, box.y + box.h * 0.2, box.h * 0.75);
  g.addColorStop(0, `rgba(255,170,70,${0.85 * a})`);
  g.addColorStop(0.5, `rgba(255,80,110,${0.4 * a})`);
  g.addColorStop(1, 'rgba(255,80,110,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

export const TRANSITIONS = {
  none: { label: 'Corte seco', cat: 'Básicas', dur: 0, fn: () => ({}) },
  fade: { label: 'Fundido a negro', cat: 'Básicas', dur: 0.32, fn: (p, e) => ({ overlay: black(e * 0.95) }) },
  fadew: { label: 'Fundido a blanco', cat: 'Básicas', dur: 0.32, fn: (p, e) => ({ overlay: white(e * 0.95) }) },
  flash: { label: 'Destello', cat: 'Básicas', dur: 0.16, fn: (p, e) => ({ overlay: white(e * 0.85) }) },
  dip: { label: 'Parpadeo', cat: 'Básicas', dur: 0.24, fn: (p, e) => ({ overlay: black(Math.floor(p * 6) % 2 ? 0 : 0.9 * e) }) },

  zoom: { label: 'Zoom suave', cat: 'Zoom', dur: 0.35, fn: (p) => ({ zoom: 1 + 0.14 * (1 - easeOut(p)) }) },
  punch: { label: 'Zoom golpe', cat: 'Zoom', dur: 0.26, fn: (p) => ({ zoom: 1 + 0.45 * (1 - easeOut(p)) ** 2, blur: 10 * (1 - p) }) },
  zoomblur: { label: 'Zoom con desenfoque', cat: 'Zoom', dur: 0.4, fn: (p) => ({ zoom: 1 + 0.7 * (1 - easeOut(p)) ** 2, blur: 22 * (1 - easeOut(p)) }) },
  bounce: { label: 'Rebote', cat: 'Zoom', dur: 0.45, fn: (p) => ({ zoom: 1 + 0.16 * Math.sin(p * Math.PI * 2.5) * (1 - p) }) },

  slidel: { label: 'Empuje ←', cat: 'Movimiento', dur: 0.3, fn: (p) => ({ dx: 1 - easeInOut(p) }) },
  slider: { label: 'Empuje →', cat: 'Movimiento', dur: 0.3, fn: (p) => ({ dx: -(1 - easeInOut(p)) }) },
  slideu: { label: 'Empuje ↑', cat: 'Movimiento', dur: 0.3, fn: (p) => ({ dy: 1 - easeInOut(p) }) },
  slided: { label: 'Empuje ↓', cat: 'Movimiento', dur: 0.3, fn: (p) => ({ dy: -(1 - easeInOut(p)) }) },
  whip: { label: 'Barrido rápido', cat: 'Movimiento', dur: 0.28, fn: (p) => ({ dx: 0.45 * (1 - easeOut(p)) ** 2, blur: 26 * (1 - easeOut(p)) }) },
  spin: { label: 'Giro', cat: 'Movimiento', dur: 0.42, fn: (p) => ({ rot: 0.9 * (1 - easeOut(p)), zoom: 1 + 0.5 * (1 - easeOut(p)), blur: 8 * (1 - p) }) },
  shake: { label: 'Sacudida', cat: 'Movimiento', dur: 0.36, fn: (p, e) => ({ dx: (hash(Math.floor(p * 40)) - 0.5) * 0.08 * e, dy: (hash(Math.floor(p * 40) + 9) - 0.5) * 0.06 * e, zoom: 1 + 0.06 * e }) },
  tilt: { label: 'Inclinación', cat: 'Movimiento', dur: 0.34, fn: (p) => ({ rot: -0.12 * (1 - easeOut(p)), zoom: 1 + 0.12 * (1 - easeOut(p)) }) },

  blur: { label: 'Desenfoque', cat: 'Efecto', dur: 0.4, fn: (p) => ({ blur: 26 * (1 - easeOut(p)) }) },
  glitch: {
    label: 'Glitch',
    cat: 'Efecto',
    dur: 0.36,
    fn: (p, e) => ({
      post: (ctx, box) => {
        const seed = Math.floor(p * 14) * 13.7;
        sliceGlitch(ctx, box, e + 0.25, seed);
        chromatic(ctx, box, box.w * 0.012 * e * (hash(seed) + 0.5));
      },
    }),
  },
  rgb: { label: 'Aberración RGB', cat: 'Efecto', dur: 0.34, fn: (p, e) => ({ zoom: 1 + 0.05 * e, post: (ctx, box) => chromatic(ctx, box, box.w * 0.02 * e * e) }) },
  pixel: { label: 'Pixelado', cat: 'Efecto', dur: 0.34, fn: (p, e) => ({ post: (ctx, box) => pixelate(ctx, box, 4 + 60 * e * e) }) },
  vhs: {
    label: 'Cinta VHS',
    cat: 'Efecto',
    dur: 0.42,
    fn: (p, e) => ({
      dx: (hash(Math.floor(p * 30)) - 0.5) * 0.04 * e,
      post: (ctx, box) => {
        sliceGlitch(ctx, box, e * 0.6, Math.floor(p * 20) * 5.1);
        chromatic(ctx, box, box.w * 0.008 * e);
        ctx.fillStyle = `rgba(0,0,0,${0.22 * e})`;
        for (let y = box.y; y < box.y + box.h; y += 4) ctx.fillRect(box.x, y, box.w, 1.5);
      },
    }),
  },
  leak: { label: 'Fuga de luz', cat: 'Efecto', dur: 0.55, fn: (p, e) => ({ post: (ctx, box) => lightLeak(ctx, box, Math.sin(Math.PI * clamp(p * 1.2, 0, 1)), 3) }) },
  strobe: { label: 'Estroboscopio', cat: 'Efecto', dur: 0.3, fn: (p) => ({ overlay: white(Math.floor(p * 8) % 2 ? 0 : 0.8 * (1 - p)) }) },

  wipel: { label: 'Cortina ←', cat: 'Forma', dur: 0.36, fn: (p, e, b) => ({ post: (ctx, box) => { ctx.fillStyle = '#000'; ctx.fillRect(box.x + box.w * easeInOut(p), box.y, box.w * (1 - easeInOut(p)), box.h); } }) },
  wiper: { label: 'Cortina →', cat: 'Forma', dur: 0.36, fn: (p) => ({ post: (ctx, box) => { ctx.fillStyle = '#000'; ctx.fillRect(box.x, box.y, box.w * (1 - easeInOut(p)), box.h); } }) },
  wipeu: { label: 'Cortina ↑', cat: 'Forma', dur: 0.36, fn: (p) => ({ post: (ctx, box) => { ctx.fillStyle = '#000'; ctx.fillRect(box.x, box.y + box.h * easeInOut(p), box.w, box.h * (1 - easeInOut(p))); } }) },
  iris: {
    label: 'Iris (círculo)',
    cat: 'Forma',
    dur: 0.45,
    fn: (p) => ({
      post: (ctx, box) => {
        const R = Math.hypot(box.w, box.h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.w, box.h);
        ctx.arc(box.x + box.w / 2, box.y + box.h / 2, R * easeInOut(p), 0, Math.PI * 2, true);
        ctx.clip('evenodd');
        ctx.fillStyle = '#000';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      },
    }),
  },
  blinds: {
    label: 'Persianas',
    cat: 'Forma',
    dur: 0.42,
    fn: (p) => ({
      post: (ctx, box) => {
        const n = 8;
        const bh = box.h / n;
        ctx.fillStyle = '#000';
        for (let i = 0; i < n; i++) ctx.fillRect(box.x, box.y + i * bh + bh * easeInOut(p), box.w, bh * (1 - easeInOut(p)));
      },
    }),
  },
  split: {
    label: 'Apertura central',
    cat: 'Forma',
    dur: 0.4,
    fn: (p) => ({
      post: (ctx, box) => {
        const w = (box.w / 2) * (1 - easeInOut(p));
        ctx.fillStyle = '#000';
        ctx.fillRect(box.x + box.w / 2 - w, box.y, w * 2, box.h);
      },
    }),
  },
};

// Transiciones GLSL profesionales (gl-transitions, MIT): mezclan el último fotograma del tramo anterior con el nuevo.
for (const name of GL_NAMES) {
  TRANSITIONS[`gl:${name}`] = { label: glLabel(name), cat: GL_RECOMMENDED.includes(name) ? 'Pro' : 'Pro (más)', dur: 0.6, gl: name, fn: (p) => ({ gl: name, glp: p }) };
}

export const TRANSITION_CATS = ['Básicas', 'Pro', 'Zoom', 'Movimiento', 'Efecto', 'Forma', 'Pro (más)'];

/** Especificación de la transición `kind` a los `local` segundos del inicio del segmento (o null si ya terminó). */
export function transitionSpec(kind, local, dur) {
  const def = TRANSITIONS[kind];
  if (!def || kind === 'none') return null;
  const d = dur || def.dur;
  if (!(local < d)) return null;
  const p = clamp(local / d, 0, 1);
  return def.fn(p, 1 - p);
}

// ---------- EFECTOS (rangos de la línea de tiempo) ----------
// pre(st) → { zoom, dx, dy, rot, blur, filter }      post(ctx, box, st)
// st = { p: 0..1 dentro del rango, t, k: intensidad 0..1, f: suavizado de entrada/salida 0..1 }
export const EFFECTS = {
  // --- Color / look ---
  bw: { label: 'Blanco y negro', cat: 'Look', pre: (s) => ({ filter: `grayscale(${s.k * s.f})` }) },
  sepia: { label: 'Sepia', cat: 'Look', pre: (s) => ({ filter: `sepia(${0.9 * s.k * s.f})` }) },
  vivid: { label: 'Vívido', cat: 'Look', pre: (s) => ({ filter: `saturate(${1 + 0.7 * s.k * s.f}) contrast(${1 + 0.12 * s.k * s.f})` }) },
  cine: { label: 'Cine', cat: 'Look', pre: (s) => ({ filter: `contrast(${1 + 0.18 * s.k * s.f}) saturate(${1 - 0.18 * s.k * s.f}) sepia(${0.14 * s.k * s.f})` }) },
  cold: { label: 'Frío', cat: 'Look', pre: (s) => ({ filter: `hue-rotate(${-14 * s.k * s.f}deg) saturate(${1 - 0.1 * s.k * s.f}) brightness(${1 + 0.02 * s.k})` }) },
  warm: { label: 'Cálido', cat: 'Look', pre: (s) => ({ filter: `sepia(${0.35 * s.k * s.f}) saturate(${1 + 0.2 * s.k * s.f})` }) },
  neon: { label: 'Neón', cat: 'Look', pre: (s) => ({ filter: `hue-rotate(${40 * s.k * s.f}deg) saturate(${1 + 1.3 * s.k * s.f}) contrast(${1 + 0.2 * s.k * s.f})` }) },
  invert: { label: 'Negativo', cat: 'Look', pre: (s) => ({ filter: `invert(${s.k * s.f})` }) },
  dream: { label: 'Ensueño', cat: 'Look', pre: (s) => ({ filter: `blur(${2.5 * s.k * s.f}px) brightness(${1 + 0.12 * s.k * s.f}) saturate(${1 + 0.2 * s.k * s.f})` }) },
  flicker: { label: 'Parpadeo de luz', cat: 'Look', pre: (s) => ({ filter: `brightness(${1 - 0.3 * s.k * hash(Math.floor(s.t * 24))})` }) },
  vignette: {
    label: 'Viñeta',
    cat: 'Look',
    post: (ctx, box, s) => {
      const g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, box.h * 0.25, box.x + box.w / 2, box.y + box.h / 2, box.h * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.75 * s.k * s.f})`);
      ctx.fillStyle = g;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    },
  },
  letterbox: {
    label: 'Barras de cine',
    cat: 'Look',
    post: (ctx, box, s) => {
      const bh = box.h * 0.11 * s.k * easeOut(s.f);
      ctx.fillStyle = '#000';
      ctx.fillRect(box.x, box.y, box.w, bh);
      ctx.fillRect(box.x, box.y + box.h - bh, box.w, bh);
    },
  },
  glow: {
    label: 'Resplandor',
    cat: 'Look',
    post: (ctx, box, s) => {
      const [c, x, w, h] = grab(ctx, box, 0);
      const [b, bx] = scratch(1, Math.round(w / 4), Math.round(h / 4));
      bx.filter = 'blur(6px) brightness(1.25)';
      bx.drawImage(c, 0, 0, b.width, b.height);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.65 * s.k * s.f;
      ctx.drawImage(b, box.x, box.y, box.w, box.h);
      ctx.restore();
    },
  },
  // --- Movimiento ---
  shake: { label: 'Temblor', cat: 'Movimiento', pre: (s) => ({ dx: (hash(Math.floor(s.t * 30)) - 0.5) * 0.05 * s.k * s.f, dy: (hash(Math.floor(s.t * 30) + 5) - 0.5) * 0.04 * s.k * s.f, zoom: 1 + 0.05 * s.k * s.f }) },
  punch: { label: 'Golpe de zoom', cat: 'Movimiento', pre: (s) => ({ zoom: 1 + 0.25 * s.k * (1 - easeOut(Math.min(1, s.p * 3))) }) },
  pulse: { label: 'Latido de zoom', cat: 'Movimiento', pre: (s) => ({ zoom: 1 + 0.06 * s.k * s.f * (0.5 + 0.5 * Math.sin(s.t * Math.PI * 4)) }) },
  slowzoom: { label: 'Zoom lento', cat: 'Movimiento', pre: (s) => ({ zoom: 1 + 0.2 * s.k * easeInOut(s.p) }) },
  sway: { label: 'Balanceo', cat: 'Movimiento', pre: (s) => ({ rot: 0.04 * s.k * s.f * Math.sin(s.t * 3), zoom: 1 + 0.06 * s.k * s.f }) },
  blurpulse: { label: 'Pulso de desenfoque', cat: 'Movimiento', pre: (s) => ({ blur: 14 * s.k * Math.sin(Math.PI * s.p) }) },
  // --- Digital ---
  glitch: {
    label: 'Glitch',
    cat: 'Digital',
    post: (ctx, box, s) => {
      const seed = Math.floor(s.t * 12) * 9.3;
      if (hash(seed) > 0.35 + 0.4 * s.k) return;
      sliceGlitch(ctx, box, s.k, seed);
      chromatic(ctx, box, box.w * 0.012 * s.k);
    },
  },
  rgb: { label: 'Aberración RGB', cat: 'Digital', post: (ctx, box, s) => chromatic(ctx, box, box.w * 0.014 * s.k * s.f) },
  pixel: { label: 'Pixelado', cat: 'Digital', post: (ctx, box, s) => pixelate(ctx, box, 4 + 34 * s.k * s.f) },
  vhs: {
    label: 'Cinta VHS',
    cat: 'Digital',
    pre: (s) => ({ dx: (hash(Math.floor(s.t * 15)) - 0.5) * 0.008 * s.k, filter: `saturate(1.25) contrast(1.05)` }),
    post: (ctx, box, s) => {
      chromatic(ctx, box, box.w * 0.006 * s.k);
      if (hash(Math.floor(s.t * 8)) > 0.6) sliceGlitch(ctx, box, s.k * 0.3, Math.floor(s.t * 8));
      ctx.fillStyle = `rgba(0,0,0,${0.2 * s.k})`;
      for (let y = box.y; y < box.y + box.h; y += 4) ctx.fillRect(box.x, y, box.w, 1.5);
    },
  },
  scan: {
    label: 'Líneas de pantalla',
    cat: 'Digital',
    post: (ctx, box, s) => {
      ctx.fillStyle = `rgba(0,0,0,${0.3 * s.k * s.f})`;
      for (let y = box.y; y < box.y + box.h; y += 3) ctx.fillRect(box.x, y, box.w, 1);
    },
  },
  mirror: {
    label: 'Espejo',
    cat: 'Digital',
    post: (ctx, box) => {
      const hw = box.w / 2;
      ctx.save();
      ctx.translate(box.x + box.w, box.y);
      ctx.scale(-1, 1);
      ctx.drawImage(ctx.canvas, box.x, box.y, hw, box.h, 0, 0, hw, box.h);
      ctx.restore();
    },
  },
  // --- Luz ---
  flash: { label: 'Destello', cat: 'Luz', post: (ctx, box, s) => { ctx.fillStyle = white(0.9 * s.k * (1 - easeOut(Math.min(1, s.p * 4)))); ctx.fillRect(box.x, box.y, box.w, box.h); } },
  strobe: { label: 'Estroboscopio', cat: 'Luz', post: (ctx, box, s) => { if (Math.floor(s.t * 10) % 2) { ctx.fillStyle = white(0.75 * s.k); ctx.fillRect(box.x, box.y, box.w, box.h); } } },
  leak: { label: 'Fuga de luz', cat: 'Luz', post: (ctx, box, s) => lightLeak(ctx, box, s.k * Math.sin(Math.PI * s.p), Math.floor(s.t / 2)) },
  grain: {
    label: 'Grano de película',
    cat: 'Luz',
    post: (ctx, box, s) => {
      const [c, x] = scratch(4, 160, 160);
      const d = x.createImageData(160, 160);
      const seed = Math.floor(s.t * 24);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.floor(hash(seed * 1000 + i) * 255);
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.28 * s.k * s.f;
      const pat = ctx.createPattern(c, 'repeat');
      ctx.fillStyle = pat;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    },
  },
  // --- Capas animadas ---
  confetti: {
    label: 'Confeti',
    cat: 'Capas',
    post: (ctx, box, s) => {
      const cols = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ffffff'];
      const n = Math.round(60 * (0.4 + s.k));
      for (let i = 0; i < n; i++) {
        const x0 = hash(i * 1.7);
        const fall = ((s.t * (0.25 + hash(i * 3.3) * 0.35) + hash(i * 9.1)) % 1.2) - 0.1;
        const x = box.x + box.w * (x0 + 0.05 * Math.sin(s.t * 3 + i));
        const y = box.y + box.h * fall;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(s.t * (2 + hash(i) * 4) + i);
        ctx.fillStyle = cols[i % cols.length];
        const z = box.w * 0.014;
        ctx.globalAlpha = s.f;
        ctx.fillRect(-z, -z / 2, z * 2, z);
        ctx.restore();
      }
    },
  },
  snow: {
    label: 'Nieve',
    cat: 'Capas',
    post: (ctx, box, s) => {
      const n = Math.round(80 * (0.4 + s.k));
      ctx.fillStyle = '#fff';
      for (let i = 0; i < n; i++) {
        const fall = (s.t * (0.08 + hash(i * 2.1) * 0.12) + hash(i * 5.7)) % 1;
        const x = box.x + box.w * ((hash(i * 1.3) + 0.03 * Math.sin(s.t * 1.5 + i)) % 1);
        ctx.globalAlpha = (0.5 + 0.5 * hash(i)) * s.f;
        ctx.beginPath();
        ctx.arc(x, box.y + box.h * fall, box.w * (0.002 + 0.004 * hash(i * 8.8)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  sparkles: {
    label: 'Destellos',
    cat: 'Capas',
    post: (ctx, box, s) => {
      const n = Math.round(26 * (0.4 + s.k));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const life = (s.t * 0.9 + hash(i * 4.1)) % 1;
        const a = Math.sin(Math.PI * life) * s.f;
        const x = box.x + box.w * hash(i * 2.9 + Math.floor(s.t * 0.9 + hash(i * 4.1)) * 0.7);
        const y = box.y + box.h * hash(i * 6.2 + Math.floor(s.t * 0.9 + hash(i * 4.1)) * 1.3);
        const r = box.w * 0.02 * (0.5 + hash(i));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.quadraticCurveTo(x, y, x, y + r);
        ctx.quadraticCurveTo(x, y, x - r, y);
        ctx.quadraticCurveTo(x, y, x, y - r);
        ctx.fill();
      }
      ctx.restore();
    },
  },
  bokeh: {
    label: 'Luces bokeh',
    cat: 'Capas',
    post: (ctx, box, s) => {
      const n = 14;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < n; i++) {
        const x = box.x + box.w * ((hash(i * 1.9) + 0.02 * Math.sin(s.t * 0.7 + i)) % 1);
        const y = box.y + box.h * ((hash(i * 3.7) - s.t * 0.02 * (1 + hash(i)) + 1) % 1);
        const r = box.w * (0.03 + 0.05 * hash(i * 5.1));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const hue = 25 + hash(i * 7.7) * 40;
        g.addColorStop(0, `hsla(${hue},100%,70%,${0.35 * s.k * s.f})`);
        g.addColorStop(1, `hsla(${hue},100%,70%,0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
    },
  },
};

export const EFFECT_CATS = ['Look', 'Movimiento', 'Digital', 'Luz', 'Capas'];

/** Efectos activos en el instante t de la línea de tiempo, con su estado. Solo PC. */
export function activeEffects(project, t) {
  if (IS_MOBILE || !project.effects?.length) return [];
  const out = [];
  for (const fx of project.effects) {
    if (!(t >= fx.start && t < fx.end)) continue;
    const def = EFFECTS[fx.kind];
    if (!def) continue;
    const dur = Math.max(0.05, fx.end - fx.start);
    const edge = Math.min(0.2, dur / 3);
    const f = clamp(Math.min((t - fx.start) / edge, (fx.end - t) / edge), 0, 1);
    out.push({ def, st: { p: (t - fx.start) / dur, t, k: clamp(fx.amount ?? 0.7, 0, 1), f } });
  }
  return out;
}

/** Combina las partes «pre» (transformación/filtro) de transiciones y efectos en una sola especificación. */
export function mergeSpecs(list) {
  const r = { zoom: 1, dx: 0, dy: 0, rot: 0, blur: 0, filter: '', overlays: [], posts: [] };
  for (const s of list) {
    if (!s) continue;
    if (s.zoom) r.zoom *= s.zoom;
    if (s.dx) r.dx += s.dx;
    if (s.dy) r.dy += s.dy;
    if (s.rot) r.rot += s.rot;
    if (s.blur) r.blur += s.blur;
    if (s.filter) r.filter += `${r.filter ? ' ' : ''}${s.filter}`;
    if (s.overlay) r.overlays.push(s.overlay);
    if (s.post) r.posts.push(s.post);
  }
  return r;
}

// ---------- FORMAS (capas) ----------
export const SHAPES = {
  rect: 'Rectángulo',
  round: 'Rectángulo redondeado',
  circle: 'Círculo',
  ring: 'Aro',
  underline: 'Subrayado',
  highlight: 'Marcador (resaltado)',
  arrow: 'Flecha',
  frame: 'Marco de atención',
  burst: 'Explosión',
};

/** Dibuja una forma centrada en (0,0) con tamaño (w,h) en píxeles. */
export function drawShape(ctx, kind, w, h, o) {
  const { color = '#ffd166', fill = true, line = 6, reveal = 1 } = o;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const x0 = -w / 2;
  const y0 = -h / 2;
  if (reveal < 1) {
    ctx.beginPath();
    ctx.rect(x0 - line, y0 - line, (w + line * 2) * reveal, h + line * 2);
    ctx.clip();
  }
  switch (kind) {
    case 'round':
      ctx.beginPath();
      ctx.roundRect(x0, y0, w, h, Math.min(w, h) * 0.22);
      fill ? ctx.fill() : ctx.stroke();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      fill ? ctx.fill() : ctx.stroke();
      break;
    case 'ring':
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'underline':
      ctx.lineWidth = Math.max(line, h * 0.35);
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.quadraticCurveTo(0, h * 0.25, -x0, -h * 0.05);
      ctx.stroke();
      break;
    case 'highlight':
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(x0, y0, w, h);
      break;
    case 'arrow': {
      const hd = Math.min(h, w * 0.4);
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(w / 2 - hd * 0.6, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2 - hd, -hd / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - hd, hd / 2);
      ctx.stroke();
      break;
    }
    case 'frame': {
      const c = Math.min(w, h) * 0.22;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo((sx * w) / 2, (sy * h) / 2 - sy * c);
        ctx.lineTo((sx * w) / 2, (sy * h) / 2);
        ctx.lineTo((sx * w) / 2 - sx * c, (sy * h) / 2);
      }
      ctx.stroke();
      break;
    }
    case 'burst': {
      const n = 14;
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const r = i % 2 ? 0.72 : 1;
        ctx.lineTo(Math.cos(a) * (w / 2) * r, Math.sin(a) * (h / 2) * r);
      }
      ctx.closePath();
      fill ? ctx.fill() : ctx.stroke();
      break;
    }
    default:
      fill ? ctx.fillRect(x0, y0, w, h) : ctx.strokeRect(x0, y0, w, h);
  }
}
