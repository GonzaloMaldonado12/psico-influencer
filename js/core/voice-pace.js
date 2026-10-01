// Teleprompter que sigue tu voz SIN internet ni reconocimiento de voz: mide cuándo hablas
// (energía de la voz sobre el ruido de fondo) y a qué ritmo (núcleos silábicos por segundo),
// y lo convierte en un multiplicador de velocidad. Funciona igual en iPhone, Android y PC.
// Todo es lógica pura (se prueba en Node); el grabador le entrega el nivel en dB de cada cuadro.
import { clamp } from '../lib/util.js';

/** Nivel RMS en dB de un bloque de muestras (Float32Array). */
export function rmsDb(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return 20 * Math.log10(Math.sqrt(s / Math.max(1, buf.length)) + 1e-9);
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export class PaceTracker {
  constructor({ hangMs = 380, windowMs = 3000 } = {}) {
    this.hangMs = hangMs;
    this.windowMs = windowMs;
    this.reset();
  }

  reset() {
    this.floor = null; // ruido de fondo (dB)
    this.env = null; // envolvente suavizada (dB)
    this.lastVoice = -Infinity; // último instante con voz
    this.rising = false;
    this.localMin = Infinity;
    this.localMax = -Infinity;
    this.lastPeak = -Infinity;
    this.events = []; // [{t, dt, speaking, peak}] de los últimos `windowMs`
    this.rates = []; // ritmos medidos mientras hablas (para tu mediana personal)
    this.med = 0;
    this.factor = 1; // ritmo relativo suavizado (1 = tu ritmo habitual)
    this.speed = 0; // multiplicador de salida (0 = texto detenido)
    this.lastT = null;
    this.silentSince = null;
  }

  /**
   * level: nivel en dB (RMS de la banda de voz) del cuadro actual. now: tiempo en ms.
   * Devuelve { speaking, speed, factor, rate, silentMs }.
   */
  update(level, now) {
    const dt = this.lastT == null ? 16 : clamp(now - this.lastT, 1, 100);
    this.lastT = now;
    if (!Number.isFinite(level)) level = -100;

    // Ruido de fondo: baja rápido y sube muy lento, así la voz no lo «contamina».
    if (this.floor == null) this.floor = Math.min(level, -50);
    else if (level < this.floor) this.floor += (level - this.floor) * 0.25;
    else this.floor += (level - this.floor) * Math.min(1, dt / 8000);
    const thr = Math.max(this.floor + 10, -58);
    if (level > thr) this.lastVoice = now;
    const speaking = now - this.lastVoice < this.hangMs;
    if (speaking) this.silentSince = null;
    else this.silentSince ??= now;

    // Núcleos silábicos: picos de la envolvente con 3 dB de histéresis y al menos 90 ms entre sí.
    this.env = this.env == null ? level : this.env + (level - this.env) * Math.min(1, dt / 25);
    let peak = false;
    if (this.rising) {
      if (this.env > this.localMax) this.localMax = this.env;
      else if (this.localMax - this.env > 3) {
        if (this.localMax > thr && now - this.lastPeak > 90) {
          peak = true;
          this.lastPeak = now;
        }
        this.rising = false;
        this.localMin = this.env;
      }
    } else if (this.env < this.localMin) this.localMin = this.env;
    else if (this.env - this.localMin > 3) {
      this.rising = true;
      this.localMax = this.env;
    }

    this.events.push({ t: now, dt, speaking, peak });
    while (this.events.length && now - this.events[0].t > this.windowMs) this.events.shift();
    let talk = 0;
    let peaks = 0;
    for (const e of this.events) {
      if (e.speaking) talk += e.dt;
      if (e.peak) peaks++;
    }
    let rate = null;
    if (talk > 900) {
      rate = peaks / (talk / 1000);
      if (speaking) {
        this.rates.push(rate);
        if (this.rates.length > 900) this.rates.shift();
        if (this.rates.length % 30 === 0) this.med = median(this.rates);
      }
    }
    // Ritmo relativo a TU ritmo habitual: si hablas más rápido que tu media, el texto acelera.
    if (rate != null && this.rates.length >= 60 && this.med > 0.5) {
      const f = clamp(rate / this.med, 0.75, 1.35);
      this.factor += (f - this.factor) * Math.min(1, dt / 1500);
    }

    // Salida: arranca suave al hablar y frena rápido al callar.
    const target = speaking ? this.factor : 0;
    const k = target > this.speed ? dt / 350 : dt / 100;
    this.speed += (target - this.speed) * Math.min(1, k);
    if (this.speed < 0.02) this.speed = 0;
    return { speaking, speed: this.speed, factor: this.factor, rate, silentMs: this.silentSince == null ? 0 : now - this.silentSince };
  }
}
