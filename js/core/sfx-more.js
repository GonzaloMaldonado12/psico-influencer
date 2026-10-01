// Banco ampliado de efectos de sonido, todos sintetizados por código (sin archivos ni derechos).
const TAU = Math.PI * 2;
const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-t * d);

export const MORE_KINDS = {
  swoosh: { label: 'Barrido rápido', dur: 0.28, cat: 'Transición' },
  riser: { label: 'Subida de tensión', dur: 1.4, cat: 'Transición' },
  downer: { label: 'Bajada', dur: 0.8, cat: 'Transición' },
  impact: { label: 'Impacto grave', dur: 0.9, cat: 'Impacto' },
  boom: { label: 'Boom cinematográfico', dur: 1.3, cat: 'Impacto' },
  hit: { label: 'Golpe seco', dur: 0.25, cat: 'Impacto' },
  glitch: { label: 'Glitch digital', dur: 0.4, cat: 'Digital' },
  zap: { label: 'Descarga', dur: 0.3, cat: 'Digital' },
  beep: { label: 'Bip', dur: 0.18, cat: 'Digital' },
  typing: { label: 'Teclas', dur: 0.9, cat: 'Digital' },
  click: { label: 'Clic', dur: 0.06, cat: 'Interfaz' },
  tick: { label: 'Tic', dur: 0.05, cat: 'Interfaz' },
  swipe: { label: 'Deslizar', dur: 0.22, cat: 'Interfaz' },
  notif: { label: 'Notificación', dur: 0.5, cat: 'Interfaz' },
  chime: { label: 'Destello brillante', dur: 1.1, cat: 'Acentos' },
  success: { label: 'Logro', dur: 0.7, cat: 'Acentos' },
  error: { label: 'Error', dur: 0.4, cat: 'Acentos' },
  coin: { label: 'Moneda', dur: 0.45, cat: 'Acentos' },
  sparkle: { label: 'Destellos', dur: 0.9, cat: 'Acentos' },
  camera: { label: 'Obturador', dur: 0.25, cat: 'Acentos' },
  heartbeat: { label: 'Latido', dur: 1.0, cat: 'Ambiente' },
  pulse: { label: 'Pulso suave', dur: 1.2, cat: 'Ambiente' },
  applause: { label: 'Aplausos', dur: 1.6, cat: 'Ambiente' },
};

function tone(out, n, sr, t0, f, dur, d = 8, g = 1, harm = [1]) {
  const s0 = Math.floor(t0 * sr);
  for (let i = 0; i < Math.min(n - s0, dur * sr); i++) {
    const t = i / sr;
    let v = 0;
    harm.forEach((h, k) => (v += Math.sin(TAU * f * (k + 1) * t) * h));
    out[s0 + i] += v * env(t, 0.004, d) * g;
  }
}

function noiseBurst(out, n, sr, r, t0, dur, d = 30, g = 1, fc = 1) {
  const s0 = Math.floor(t0 * sr);
  let lp = 0;
  for (let i = 0; i < Math.min(n - s0, dur * sr); i++) {
    lp += fc * (r() * 2 - lp);
    out[s0 + i] += lp * Math.exp(-(i / sr) * d) * g;
  }
}

/** Rellena `out` con el sonido `kind`. r() = ruido en [-0,5, 0,5). */
export function renderMore(kind, out, n, sr, r) {
  const T = (i) => i / sr;
  switch (kind) {
    case 'swoosh': {
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (0.05 + 0.5 * t) * (r() * 2 - lp);
        out[i] = lp * Math.sin(Math.PI * t) ** 1.2;
      }
      break;
    }
    case 'riser': {
      let ph = 0;
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        ph += (TAU * (120 + 1400 * t * t)) / sr;
        lp += (0.03 + 0.4 * t) * (r() * 2 - lp);
        out[i] = (Math.sin(ph) * 0.35 + lp * 1.4) * t ** 1.6 * (i > n - 0.02 * sr ? (n - i) / (0.02 * sr) : 1);
      }
      break;
    }
    case 'downer': {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        ph += (TAU * (900 * (1 - t) ** 2 + 60)) / sr;
        out[i] = Math.sin(ph) * (1 - t) ** 1.5 * Math.min(1, i / 200);
      }
      break;
    }
    case 'impact':
    case 'boom': {
      const d = kind === 'boom' ? 3 : 5.5;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = T(i);
        ph += (TAU * (38 + 90 * Math.exp(-t * 14))) / sr;
        out[i] = Math.sin(ph) * Math.exp(-t * d) * Math.min(1, t * 900);
      }
      noiseBurst(out, n, sr, r, 0, 0.25, 18, 0.9, 0.25);
      if (kind === 'boom') noiseBurst(out, n, sr, r, 0.02, 1.1, 3.5, 0.35, 0.05);
      break;
    }
    case 'hit':
      noiseBurst(out, n, sr, r, 0, 0.2, 40, 1, 0.35);
      tone(out, n, sr, 0, 110, 0.2, 30, 0.9);
      break;
    case 'glitch': {
      let hold = 8;
      let v = 0;
      const blk = Math.floor(sr * 0.012);
      for (let i = 0; i < n; i++) {
        if (i % blk === 0) hold = Math.floor((r() + 0.5) * 6 + 6);
        if (i % hold === 0) v = r() > 0 ? 1 : -1;
        const t = i / n;
        out[i] = v * 0.5 * (Math.floor(t * 14) % 3 === 2 ? 0 : 1) * (1 - t);
      }
      break;
    }
    case 'zap': {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = T(i);
        ph += (TAU * (2400 * Math.exp(-t * 16) + 160)) / sr;
        out[i] = Math.sign(Math.sin(ph)) * 0.5 * Math.exp(-t * 11);
      }
      break;
    }
    case 'beep':
      tone(out, n, sr, 0, 1046.5, 0.16, 7, 1);
      break;
    case 'typing':
      for (let k = 0; k < 11; k++) {
        const t0 = k * 0.075 + (r() + 0.5) * 0.02;
        noiseBurst(out, n, sr, r, t0, 0.03, 120, 0.9, 0.5 + (r() + 0.5) * 0.4);
        tone(out, n, sr, t0, 1800 + (r() + 0.5) * 500, 0.02, 160, 0.3);
      }
      break;
    case 'click':
      noiseBurst(out, n, sr, r, 0, 0.02, 220, 1, 0.8);
      tone(out, n, sr, 0, 2200, 0.03, 140, 0.5);
      break;
    case 'tick':
      tone(out, n, sr, 0, 3100, 0.03, 160, 1);
      break;
    case 'swipe': {
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (0.1 + 0.35 * t) * (r() * 2 - lp);
        out[i] = lp * Math.sin(Math.PI * t) * 0.9;
      }
      break;
    }
    case 'notif':
      tone(out, n, sr, 0, 880, 0.3, 9, 0.7, [1, 0.3]);
      tone(out, n, sr, 0.14, 1318.5, 0.36, 8, 0.8, [1, 0.3]);
      break;
    case 'chime':
      [1568, 2093, 2637, 3136].forEach((f, k) => tone(out, n, sr, k * 0.07, f, 1, 4.5, 0.6, [1, 0.25]));
      break;
    case 'success':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(out, n, sr, k * 0.085, f, 0.4, 6, 0.6, [1, 0.3]));
      break;
    case 'error':
      tone(out, n, sr, 0, 196, 0.18, 9, 0.8, [1, 0.5, 0.3]);
      tone(out, n, sr, 0.16, 146.8, 0.24, 8, 0.8, [1, 0.5, 0.3]);
      break;
    case 'coin':
      tone(out, n, sr, 0, 987.8, 0.08, 14, 0.8, [1, 0.3]);
      tone(out, n, sr, 0.07, 1318.5, 0.4, 7, 0.8, [1, 0.3]);
      break;
    case 'sparkle':
      for (let k = 0; k < 9; k++) tone(out, n, sr, k * 0.075 + (r() + 0.5) * 0.03, 2400 + (r() + 0.5) * 2600, 0.25, 14, 0.5);
      break;
    case 'camera':
      noiseBurst(out, n, sr, r, 0, 0.04, 90, 1, 0.7);
      noiseBurst(out, n, sr, r, 0.09, 0.05, 80, 0.8, 0.5);
      break;
    case 'heartbeat':
      [0, 0.22, 0.75, 0.97].forEach((t0, k) => tone(out, n, sr, t0, k % 2 ? 52 : 62, 0.2, 18, k % 2 ? 0.7 : 1));
      break;
    case 'pulse':
      for (let i = 0; i < n; i++) {
        const t = T(i);
        out[i] = Math.sin(TAU * 90 * t) * (0.5 + 0.5 * Math.sin(TAU * 2.5 * t)) * Math.sin((Math.PI * i) / n);
      }
      break;
    case 'applause':
      for (let k = 0; k < 120; k++) noiseBurst(out, n, sr, r, (r() + 0.5) * 1.3 + 0.05, 0.03, 120, 0.25 + (r() + 0.5) * 0.3, 0.3 + (r() + 0.5) * 0.5);
      for (let i = 0; i < n; i++) out[i] *= Math.min(1, i / (0.1 * sr)) * Math.min(1, (n - i) / (0.4 * sr));
      break;
    default:
  }
}
