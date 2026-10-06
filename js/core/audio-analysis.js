// Análisis de audio puro: envolvente RMS, detección de voz y silencios.

export function computeEnvelope(channels, sampleRate, hop = 0.02) {
  const hopN = Math.max(1, Math.round(sampleRate * hop));
  const len = channels[0]?.length || 0;
  const frames = Math.ceil(len / hopN);
  const env = new Float32Array(frames);
  const nch = channels.length;
  for (let f = 0; f < frames; f++) {
    const start = f * hopN;
    const end = Math.min(len, start + hopN);
    let sum = 0;
    for (let c = 0; c < nch; c++) {
      const ch = channels[c];
      for (let i = start; i < end; i++) sum += ch[i] * ch[i];
    }
    env[f] = Math.sqrt(sum / Math.max(1, (end - start) * nch));
  }
  return env;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** Regiones con voz a partir de la envolvente (umbral adaptativo en dB). */
export function detectSpeech(env, hop = 0.02, opts = {}) {
  const { minSpeech = 0.12, mergeGap = 0.25, pad = 0.06, sensitivity = 0.32 } = opts;
  const total = env.length * hop;
  if (!env.length) return [];
  const db = Array.from(env, (v) => 20 * Math.log10(v + 1e-7));
  const sorted = [...db].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const peak = percentile(sorted, 0.95);
  if (peak - floor < 6) return peak > -45 ? [{ start: 0, end: total }] : [];
  const thr = floor + (peak - floor) * sensitivity;
  const raw = [];
  let start = -1;
  for (let i = 0; i < db.length; i++) {
    const on = db[i] > thr;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      raw.push({ start: start * hop, end: i * hop });
      start = -1;
    }
  }
  if (start >= 0) raw.push({ start: start * hop, end: total });
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < mergeGap) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged
    .filter((r) => r.end - r.start >= minSpeech)
    .map((r) => ({ start: Math.max(0, r.start - pad), end: Math.min(total, r.end + pad) }));
}

export function findSilences(regions, duration, minLen = 0.7) {
  const out = [];
  let prev = 0;
  for (const r of regions) {
    if (r.start - prev >= minLen) out.push({ start: prev, end: r.start });
    prev = Math.max(prev, r.end);
  }
  if (duration - prev >= minLen) out.push({ start: prev, end: duration });
  return out;
}

/** Cortes para eliminar silencios dejando `keep` segundos de respiración junto a la voz. */
export function silenceCuts(silences, duration, keep = 0.15) {
  return silences
    .map((s) => ({
      start: s.start <= 0.001 ? 0 : s.start + keep,
      end: s.end >= duration - 0.001 ? duration : s.end - keep,
    }))
    .filter((c) => c.end - c.start > 0.05);
}

export function isSpeechAt(regions, t) {
  if (!regions) return true;
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions[mid];
    if (t < r.start) hi = mid - 1;
    else if (t > r.end) lo = mid + 1;
    else return true;
  }
  return false;
}

export function speechSeconds(regions) {
  return (regions || []).reduce((a, r) => a + (r.end - r.start), 0);
}
