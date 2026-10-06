// Herramientas para videos de música (estilo Paul Davids, Rick Beato, Jon Dretto, Matteo Mancuso):
// tempo y pulsos para cortar al ritmo, sincronización de una segunda cámara (manos/diapasón) por el
// audio y capítulos para YouTube. Lógica pura: se prueba en Node.
import { fmtTime } from '../lib/util.js';

/** Fuerza de ataque (novedad espectral simple) desde la envolvente RMS. */
export function onsetStrength(env) {
  const out = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) {
    const a = Math.log10(env[i - 1] + 1e-4);
    const b = Math.log10(env[i] + 1e-4);
    out[i] = Math.max(0, b - a);
  }
  return out;
}

/**
 * Tempo (BPM) y pulsos a partir de la envolvente (hop en segundos). Busca entre 60 y 180 BPM por
 * autocorrelación de los ataques y alinea la rejilla con la fase de mayor energía.
 * Devuelve { bpm, beats: [s], confidence 0-1 }.
 */
export function detectBeats(env, hop = 0.02, { min = 60, max = 180 } = {}) {
  const on = onsetStrength(env);
  const n = on.length;
  if (n < 4 / hop) return { bpm: 0, beats: [], confidence: 0 };
  // Ataques suavizados (±2 cuadros): un período que no cae justo en un cuadro sigue correlacionando.
  const K = [1, 2, 3, 2, 1];
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let k = -2; k <= 2; k++) sm[i] += (on[i + k] || 0) * K[k + 2];
  const mean = sm.reduce((s, v) => s + v, 0) / n;
  const x = Array.from(sm, (v) => v - mean);
  const lagMin = Math.round(60 / max / hop);
  const lagMax = Math.round(60 / min / hop);
  let best = 0;
  let bestLag = 0;
  let total = 0;
  const scores = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    s /= n - lag; // normalizado: los retardos largos no ganan solo por tener menos términos
    scores.push(s);
    total += Math.max(0, s);
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (!bestLag || best <= 0) return { bpm: 0, beats: [], confidence: 0 };
  // Error de octava (mitad o doble del tempo): entre candidatos casi igual de fuertes, el más cercano a 115 BPM.
  const sc = (lag) => scores[lag - lagMin] ?? -Infinity;
  const cands = [bestLag, Math.round(bestLag / 2), bestLag * 2].filter((l) => l >= lagMin && l <= lagMax && sc(l) >= 0.7 * best);
  bestLag = cands.sort((p, q) => Math.abs(60 / (p * hop) - 115) - Math.abs(60 / (q * hop) - 115))[0];
  best = sc(bestLag);
  // Interpolación parabólica para un BPM más fino.
  const k = bestLag - lagMin;
  const [y0, y1, y2] = [scores[k - 1] ?? best, best, scores[k + 1] ?? best];
  const d = y0 - 2 * y1 + y2 ? (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2) : 0;
  const period = (bestLag + Math.max(-0.5, Math.min(0.5, d))) * hop;
  let phase = 0;
  let phaseBest = -1;
  const steps = Math.max(1, Math.round(period / hop));
  for (let p = 0; p < steps; p++) {
    let s = 0;
    for (let t = p * hop; t < n * hop; t += period) s += on[Math.round(t / hop)] || 0;
    if (s > phaseBest) {
      phaseBest = s;
      phase = p * hop;
    }
  }
  const beats = [];
  for (let t = phase; t < n * hop; t += period) beats.push(+t.toFixed(3));
  return { bpm: Math.round((60 / period) * 10) / 10, beats, confidence: Math.min(1, best / (total / scores.length + 1e-9) / 6) };
}

/**
 * Desfase (s) entre dos grabaciones del mismo momento (cámara principal y cámara de manos) por
 * correlación de sus envolventes de audio: offset > 0 → la segunda empezó a grabar antes.
 * Devuelve { offset, score }.
 */
export function syncOffset(envA, envB, hop = 0.02, maxShift = 30) {
  const norm = (e) => {
    const on = onsetStrength(e);
    const m = on.reduce((s, v) => s + v, 0) / (on.length || 1);
    return Array.from(on, (v) => v - m);
  };
  const a = norm(envA);
  const b = norm(envB);
  const maxL = Math.round(maxShift / hop);
  let best = -Infinity;
  let bestL = 0;
  for (let L = -maxL; L <= maxL; L++) {
    let s = 0;
    let c = 0;
    for (let i = Math.max(0, -L); i < a.length && i + L < b.length; i++) {
      s += a[i] * b[i + L];
      c++;
    }
    if (c > 50 && s / c > best) {
      best = s / c;
      bestL = L;
    }
  }
  return { offset: +(bestL * hop).toFixed(3), score: best };
}

/** Capítulos para la descripción de YouTube (el primero debe empezar en 0:00). */
export function chaptersText(markers) {
  const list = [...markers].filter((m) => m.label).sort((a, b) => a.t - b.t);
  if (!list.length) return '';
  if (list[0].t > 0.5) list.unshift({ t: 0, label: 'Intro' });
  return list.map((m) => `${fmtTime(m.t)} ${m.label}`).join('\n');
}

/** Carteles típicos de videos de música. */
export const MUSIC_CARDS = {
  acorde: { label: 'Acorde', example: 'Am7(9)', size: 11, y: 0.2 },
  escala: { label: 'Escala / modo', example: 'La dórico', size: 7, y: 0.18 },
  tempo: { label: 'Tempo', example: '♩ = 92', size: 6, y: 0.12 },
  tono: { label: 'Tonalidad', example: 'Tono: Mi menor', size: 6, y: 0.12 },
  equipo: { label: 'Equipo', example: 'Strato 1962 · Klon · Fender Deluxe', size: 5, y: 0.86 },
  tecnica: { label: 'Técnica', example: 'Hybrid picking', size: 7, y: 0.2 },
  capitulo: { label: 'Capítulo', example: 'Por qué esta canción es genial', size: 6.5, y: 0.5 },
};
