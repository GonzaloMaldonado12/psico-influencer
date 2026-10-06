// Sonoridad (ITU-R BS.1770 / EBU R128 simplificado), normalización y cambio de velocidad
// sin alterar el tono (WSOLA). Todo puro: se prueba en Node.

/** Filtro biquad directo (forma I) sobre un Float32Array. */
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Coeficientes K-weighting para cualquier frecuencia de muestreo (BS.1770-4). */
function kWeight(ch, sr) {
  // Etapa 1: realce de agudos (shelf)
  let f0 = 1681.974450955533;
  let G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(ch, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Etapa 2: paso alto (RLB)
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

/** Sonoridad integrada en LUFS (con puertas absoluta -70 y relativa -10). */
export function integratedLoudness(channels, sr) {
  const block = Math.round(sr * 0.4);
  const hop = Math.round(sr * 0.1);
  const len = channels[0]?.length || 0;
  // Sumas acumuladas de energía por canal: cada bloque cuesta O(1).
  const prefixes = channels.map((c) => {
    const w = kWeight(c, sr);
    const p = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });
  const powers = [];
  for (let s = 0; s + block <= len; s += hop) {
    let sum = 0;
    for (const p of prefixes) sum += (p[s + block] - p[s]) / block;
    powers.push(sum);
  }
  if (!powers.length) return -Infinity;
  const lufs = (p) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(mean(gated.length ? gated : abs));
}

export function samplePeak(channels) {
  let m = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  return m;
}

/**
 * Normaliza a `target` LUFS (redes: -14) con limitador suave para no pasar `ceilingDb`.
 * Modifica los canales y devuelve { before, gainDb }.
 */
export function normalizeLoudness(channels, sr, target = -14, ceilingDb = -1) {
  const before = integratedLoudness(channels, sr);
  if (!Number.isFinite(before)) return { before, gainDb: 0 };
  const gainDb = Math.max(-20, Math.min(20, target - before));
  const g = 10 ** (gainDb / 20);
  const ceil = 10 ** (ceilingDb / 20);
  const knee = ceil * 0.8;
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) {
      let v = c[i] * g;
      const a = Math.abs(v);
      if (a > knee) {
        // Compresión suave por encima de la rodilla: nunca pasa del techo.
        const over = (a - knee) / (ceil - knee);
        v = Math.sign(v) * (knee + (ceil - knee) * Math.tanh(over));
      }
      c[i] = v;
    }
  }
  return { before, gainDb };
}

/**
 * Cambia la duración por `rate` (1.25 = 25 % más rápido) conservando el tono (WSOLA).
 * Entrada y salida mono Float32Array.
 */
export function timeStretch(input, sr, rate) {
  if (!(rate > 0) || Math.abs(rate - 1) < 1e-3) return input.slice();
  const win = Math.round(sr * 0.03);
  const hopOut = Math.round(win / 2);
  const hopIn = hopOut * rate;
  const tol = Math.round(sr * 0.008);
  const outLen = Math.ceil(input.length / rate);
  const out = new Float32Array(outLen + win);
  const norm = new Float32Array(outLen + win);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  let prevEnd = 0;
  for (let k = 0, outPos = 0; outPos < outLen; k++, outPos += hopOut) {
    const nominal = Math.round(k * hopIn);
    let best = nominal;
    if (k > 0) {
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const cand = nominal + d;
        if (cand < 0 || cand + hopOut >= input.length) continue;
        let score = 0;
        for (let i = 0; i < hopOut; i += 4) score += input[cand + i] * input[prevEnd + i];
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    if (best >= input.length) break;
    for (let i = 0; i < win && best + i < input.length; i++) {
      out[outPos + i] += input[best + i] * hann[i];
      norm[outPos + i] += hann[i];
    }
    prevEnd = Math.min(input.length - hopOut - 1, best + hopOut);
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  return out.subarray(0, outLen);
}
