// Control profesional de la cámara y del micrófono de estudio.
// - lockCamera: deja que la cámara se estabilice y fija enfoque, exposición y balance de blancos,
//   para que no «respire» ni cambie de color mientras hablas (lo que más delata una webcam).
//   Cada ajuste se verifica: si cambia la imagen más de lo esperado, se vuelve a automático.
// - monoMic: interfaces como la Behringer UM2 entregan 2 canales aunque el micrófono entre por uno;
//   esto detecta el canal con señal y lo entrega centrado en ambos oídos.

function meanRGB(video) {
  const c = meanRGB.c || (meanRGB.c = document.createElement('canvas'));
  c.width = 48;
  c.height = 27;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, 0, 0, 48, 27);
  const d = x.getImageData(0, 0, 48, 27).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  return [r / n, g / n, b / n];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const drift = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]) / Math.max(20, v)));
const chroma = (c) => {
  const t = c[0] + c[1] + c[2] || 1;
  return c.map((v) => v / t);
};
const chromaDrift = (a, b) => Math.max(...chroma(a).map((v, i) => Math.abs(v - chroma(b)[i])));
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Fija enfoque, exposición y balance de blancos. Devuelve { locked: {...}, unlock() }.
 * `video` es el <video> que muestra la cámara (para verificar que la imagen no cambia).
 */
export async function lockCamera(track, video, { sharpness = 0.35 } = {}) {
  const caps = track.getCapabilities?.() || {};
  const result = { locked: { focus: false, exposure: false, whiteBalance: false }, sharpnessSet: false };
  if (!track.applyConstraints || !caps) return { ...result, unlock: async () => {} };
  const restore = {};
  const tryLock = async (name, constraint, undo) => {
    const before = meanRGB(video);
    try {
      await track.applyConstraints({ advanced: [constraint] });
    } catch {
      return false;
    }
    await wait(450);
    if (drift(before, meanRGB(video)) > 0.08) {
      // La cámara no mantuvo la imagen: vuelve a automático.
      try {
        await track.applyConstraints({ advanced: [undo] });
      } catch {
        /* sin cambios */
      }
      return false;
    }
    restore[name] = undo;
    return true;
  };

  await wait(1800); // el automático de la cámara se estabiliza
  const s = track.getSettings();
  if (caps.focusMode?.includes('manual') && s.focusDistance != null) {
    result.locked.focus = await tryLock('focus', { focusMode: 'manual', focusDistance: s.focusDistance }, { focusMode: 'continuous' });
  }
  const apply = async (c) => {
    try {
      await track.applyConstraints({ advanced: [c] });
      return true;
    } catch {
      return false;
    }
  };
  // Balance de blancos: la cámara informa un valor que no siempre es el real. Se prueban temperaturas
  // y se elige la que deja los colores igual que el automático (así se fija sin cambiar la imagen).
  if (caps.whiteBalanceMode?.includes('manual') && caps.colorTemperature) {
    const { min, max } = caps.colorTemperature;
    const ref = meanRGB(video);
    let best = null;
    const probe = async (t) => {
      if (!(await apply({ whiteBalanceMode: 'manual', colorTemperature: t }))) return;
      await wait(260);
      const d = chromaDrift(ref, meanRGB(video));
      if (!best || d < best.d) best = { t, d };
    };
    for (let t = min; t <= max; t += 400) await probe(t);
    if (best) for (const off of [-200, -100, 100, 200]) await probe(Math.min(max, Math.max(min, best.t + off)));
    if (best && best.d < 0.02) {
      await apply({ whiteBalanceMode: 'manual', colorTemperature: best.t });
      restore.wb = { whiteBalanceMode: 'continuous' };
      result.locked.whiteBalance = true;
    } else {
      await apply({ whiteBalanceMode: 'continuous' });
    }
  }
  // La exposición se deja siempre en automático: la cámara la gobierna mejor y fijarla puede bajar los fps.
  // Menos realce de fábrica: el realce excesivo de las webcams deja halos y aspecto digital.
  if (caps.sharpness && typeof caps.sharpness.max === 'number') {
    const v = Math.round(caps.sharpness.min + (caps.sharpness.max - caps.sharpness.min) * sharpness);
    try {
      await track.applyConstraints({ advanced: [{ sharpness: v }] });
      result.sharpnessSet = true;
    } catch {
      /* sin control de nitidez */
    }
  }
  result.unlock = async () => {
    for (const c of Object.values(restore)) {
      try {
        await track.applyConstraints({ advanced: [c] });
      } catch {
        /* ya no está conectada */
      }
    }
  };
  return result;
}

/** Devuelve la cámara a enfoque, exposición y blancos automáticos (Windows recuerda los ajustes manuales). */
export async function resetAuto(track) {
  try {
    await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }, { focusMode: 'continuous' }, { whiteBalanceMode: 'continuous' }] });
  } catch {
    /* la cámara no admite ese control */
  }
}

export function lockSummary(r) {
  const parts = [];
  if (r.locked.focus) parts.push('enfoque');
  if (r.locked.exposure) parts.push('exposición');
  if (r.locked.whiteBalance) parts.push('balance de blancos');
  return parts.length ? `Cámara estable: ${parts.join(', ')} ${parts.length > 1 ? 'fijados' : 'fijado'}` : 'La cámara no permite fijar ajustes: queda en automático';
}

/**
 * Convierte un micrófono de 2 canales (uno vacío) en voz centrada. Devuelve { stream, stop }:
 * `stream` tiene el video original y el audio corregido, listo para grabar.
 */
export function monoMic(stream) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const at = stream.getAudioTracks()[0];
  if (!AC || !at || (at.getSettings().channelCount || 1) < 2) return { stream, stop() {} };
  const ctx = new AC({ sampleRate: 48000 });
  const src = ctx.createMediaStreamSource(new MediaStream([at]));
  const split = ctx.createChannelSplitter(2);
  const gL = ctx.createGain();
  const gR = ctx.createGain();
  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  const dest = ctx.createMediaStreamDestination();
  const aL = ctx.createAnalyser();
  const aR = ctx.createAnalyser();
  aL.fftSize = aR.fftSize = 1024;
  src.connect(split);
  split.connect(gL, 0);
  split.connect(gR, 1);
  split.connect(aL, 0);
  split.connect(aR, 1);
  gL.connect(mono);
  gR.connect(mono);
  mono.connect(dest);
  gL.gain.value = gR.gain.value = 0.5;
  const bl = new Float32Array(1024);
  const br = new Float32Array(1024);
  const rms = (an, buf) => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  };
  let eL = 1e-5;
  let eR = 1e-5;
  const timer = setInterval(() => {
    // Promedio con memoria: decide con la voz, no con el ruido de fondo.
    eL = eL * 0.9 + rms(aL, bl) * 0.1;
    eR = eR * 0.9 + rms(aR, br) * 0.1;
    const hi = Math.max(eL, eR);
    if (hi < 0.004) return; // silencio: no cambiar
    const ratio = eL / eR;
    const now = ctx.currentTime;
    const [a, b] = ratio > 6 ? [1, 0] : ratio < 1 / 6 ? [0, 1] : [0.5, 0.5];
    gL.gain.setTargetAtTime(a, now, 0.05);
    gR.gain.setTargetAtTime(b, now, 0.05);
  }, 100);
  const out = new MediaStream([...stream.getVideoTracks(), dest.stream.getAudioTracks()[0]]);
  return {
    stream: out,
    stop() {
      clearInterval(timer);
      ctx.close().catch(() => {});
    },
  };
}
