// Utilidades de medios del navegador: formatos de grabación, metadatos, miniaturas y análisis de audio.
import { computeEnvelope, detectSpeech } from './audio-analysis.js';
import { db } from '../lib/db.js';

export const VIDEO_MIMES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMime(candidates = VIDEO_MIMES) {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignorar */
    }
  }
  return '';
}

export function extFor(mime) {
  return /webm/.test(mime || '') ? 'webm' : 'mp4';
}

function once(target, events, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const list = Array.isArray(events) ? events : [events];
    const done = (e) => {
      cleanup();
      resolve(e);
    };
    const fail = () => {
      cleanup();
      reject(new Error('No se pudo leer el archivo de video.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Tiempo de espera agotado leyendo el video.'));
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      list.forEach((ev) => target.removeEventListener(ev, done));
      target.removeEventListener('error', fail);
    };
    list.forEach((ev) => target.addEventListener(ev, done));
    target.addEventListener('error', fail);
  });
}

/** Duración y tamaño. Corrige los webm de MediaRecorder que no declaran duración. */
export async function probeVideo(url) {
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  await once(v, 'loadedmetadata');
  let duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    v.currentTime = 1e7;
    await once(v, ['durationchange', 'timeupdate', 'seeked'], 8000).catch(() => {});
    for (let i = 0; i < 20 && !(Number.isFinite(v.duration) && v.duration > 0); i++) await new Promise((r) => setTimeout(r, 50));
    duration = v.duration;
  }
  const res = { duration: Number.isFinite(duration) ? duration : 0, width: v.videoWidth, height: v.videoHeight };
  v.removeAttribute('src');
  v.load();
  return res;
}

export async function captureThumb(url, t = 0.6, maxW = 360) {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  try {
    await once(v, 'loadeddata');
    const target = Math.min(t, Number.isFinite(v.duration) ? v.duration / 2 : t);
    v.currentTime = target;
    await once(v, 'seeked', 6000);
    const scale = Math.min(1, maxW / (v.videoWidth || maxW));
    const c = document.createElement('canvas');
    c.width = Math.round((v.videoWidth || 320) * scale);
    c.height = Math.round((v.videoHeight || 180) * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

export function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function decodeAudio(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 44100);
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/** Envolvente y regiones de voz de un medio; se guarda en el registro para no recalcular. */
export async function analyzeMedia(mediaId, { force = false } = {}) {
  const rec = await db.get('media', mediaId);
  if (!rec) return null;
  if (rec.analysis && !force) return rec.analysis;
  let analysis;
  try {
    const audio = await decodeAudio(rec.blob);
    const channels = [];
    for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c));
    const hop = 0.02;
    const env = computeEnvelope(channels, audio.sampleRate, hop);
    const regions = detectSpeech(env, hop);
    const peak = env.reduce((m, v) => Math.max(m, v), 0) || 1;
    analysis = {
      hop,
      duration: audio.duration,
      env: Array.from(env, (v) => Math.round((v / peak) * 1000) / 1000),
      regions,
      ok: true,
    };
  } catch (err) {
    console.warn('Análisis de audio no disponible', err);
    analysis = { hop: 0.02, duration: rec.duration, env: [], regions: null, ok: false };
  }
  rec.analysis = analysis;
  if (analysis.ok && analysis.duration && (!rec.duration || !Number.isFinite(rec.duration))) rec.duration = analysis.duration;
  await db.put('media', rec);
  return analysis;
}

/** Audio mono a 16 kHz (para transcripción con IA). */
export async function audioMono16k(blob) {
  const audio = await decodeAudio(blob);
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.ceil(audio.duration * 16000);
  const off = new Ctx(1, len, 16000);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

export function hasCamera() {
  return !!navigator.mediaDevices?.getUserMedia;
}

export function hasScreenCapture() {
  return !!navigator.mediaDevices?.getDisplayMedia;
}

export function speechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
