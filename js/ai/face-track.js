// Recorre una toma y mide la posición de la cara (para el encuadre automático) y la
// iluminación (para la corrección automática). Todo en el dispositivo.
import { ensure, detectFace } from './vision.js';
import { analyzeLighting } from '../core/lighting.js';

function once(el, ev, ms = 8000) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    el.addEventListener(ev, () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

/** Suaviza la trayectoria y rellena los instantes sin cara. */
export function smoothTrack(points, win = 5) {
  const valid = points.filter((p) => p.found);
  if (!valid.length) return [];
  const filled = points.map((p, i) => {
    if (p.found) return p;
    let a = null;
    let b = null;
    for (let k = i - 1; k >= 0; k--) if (points[k].found) { a = points[k]; break; }
    for (let k = i + 1; k < points.length; k++) if (points[k].found) { b = points[k]; break; }
    const src = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b;
    return { t: p.t, x: src.x, y: src.y, found: false };
  });
  return filled.map((p, i) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(filled.length - 1, i + win); k++) {
      sx += filled[k].x;
      sy += filled[k].y;
      n++;
    }
    return { t: Math.round(p.t * 100) / 100, x: Math.round((sx / n) * 1000) / 1000, y: Math.round((sy / n) * 1000) / 1000 };
  });
}

/**
 * url: video de la toma. Devuelve { track: [{t,x,y}], light: {score, tips, metrics} | null }.
 */
export async function analyzeClip(url, duration, { step = 0.5, onProgress, isCancelled = () => false } = {}) {
  await ensure('face');
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await once(v, 'loadeddata');
  const W = 480;
  const H = Math.max(2, Math.round((W * (v.videoHeight || 270)) / (v.videoWidth || 480)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const pts = [];
  const lights = [];
  const n = Math.max(1, Math.floor(duration / step));
  const lightEvery = Math.max(1, Math.floor(n / 6));
  try {
    for (let i = 0; i <= n; i++) {
      if (isCancelled()) return null;
      const t = Math.min(duration - 0.05, i * step);
      v.currentTime = Math.max(0, t);
      await once(v, 'seeked', 5000);
      ctx.drawImage(v, 0, 0, W, H);
      const f = detectFace(c);
      pts.push(f?.found ? { t, x: f.center.x, y: f.center.y, found: true } : { t, x: 0.5, y: 0.45, found: false });
      if (i % lightEvery === 0) {
        const img = ctx.getImageData(0, 0, W, H);
        lights.push(analyzeLighting(img.data, W, H, f?.found ? f.box : null));
      }
      onProgress?.(i / n);
    }
  } finally {
    v.removeAttribute('src');
    v.load();
  }
  const track = smoothTrack(pts);
  let light = null;
  if (lights.length) {
    const avg = (k) => {
      const vals = lights.map((l) => l.metrics[k]).filter((x) => typeof x === 'number');
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const metrics = { face: lights.some((l) => l.metrics.face), faceLuma: avg('faceLuma'), bgLuma: avg('bgLuma'), clipped: avg('clipped'), crushed: avg('crushed'), warmth: avg('warmth'), tintG: avg('tintG'), sideDiff: avg('sideDiff') };
    const worst = lights.reduce((a, b) => (a.score <= b.score ? a : b));
    light = { score: Math.round(lights.reduce((s, l) => s + l.score, 0) / lights.length), tips: worst.tips, metrics };
  }
  return { track, light, faceRatio: pts.filter((p) => p.found).length / pts.length };
}
