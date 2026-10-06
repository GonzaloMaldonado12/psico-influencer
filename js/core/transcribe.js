// Transcripción con IA (Whisper) ejecutada en el propio dispositivo mediante un Web Worker.
// La primera vez descarga el modelo (queda en caché); el audio nunca sale del dispositivo.
import { db } from '../lib/db.js';
import { audioMono16k } from './media.js';

const LANGS = { es: 'spanish', en: 'english', pt: 'portuguese', fr: 'french', it: 'italian', de: 'german', ca: 'catalan' };

export const MODELS = {
  rapido: { id: 'onnx-community/whisper-tiny_timestamped', label: 'Rápido' },
  preciso: { id: 'onnx-community/whisper-base_timestamped', label: 'Preciso' },
};

const isMobile = () =>
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function defaultModel() {
  return isMobile() ? MODELS.rapido.id : MODELS.preciso.id;
}

export function transcriptionSupport() {
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    return { ok: false, reason: 'Este navegador no admite la transcripción con IA.' };
  }
  return { ok: true };
}

/** Vocabulario que ayuda al transcriptor con nombres propios y términos clínicos (editable en Ajustes). */
export const DEFAULT_VOCAB = 'Psicólogo, psicóloga, neuroafirmativo, neurodivergente, TEA, TDAH, FONASA, Isapre, Tomé, Ánima Mente, terapia online, link en mi perfil.';

/** Transcriptor de alta calidad del programa de PC (whisper.cpp con GPU), si está instalado. */
async function desktopWhisper() {
  const w = typeof window !== 'undefined' && window.psicoDesktop?.whisper;
  if (!w) return null;
  try {
    const st = await w.status();
    return st?.ok ? { w, st } : null;
  } catch {
    return null;
  }
}

export async function transcribeProject(project, opts = {}) {
  const pc = await desktopWhisper();
  if (pc) {
    try {
      return await transcribeDesktop(project, pc, opts);
    } catch (e) {
      if (opts.isCancelled?.()) return null;
      console.warn('Transcriptor de PC falló; uso el del navegador', e);
      opts.onProgress?.(0, 'El transcriptor de alta calidad falló; uso el estándar…');
    }
  }
  return transcribeBrowser(project, opts);
}

async function transcribeDesktop(project, { w }, { lang = 'es-ES', onProgress = () => {}, isCancelled = () => false } = {}) {
  const ai = await db.getKV('ai', {});
  const quality = ai.whisperQuality || 'maximo';
  const prompt = [ai.vocab || DEFAULT_VOCAB, String(project.script?.text || project.scriptText || '').slice(0, 300)].filter(Boolean).join(' ');
  const words = [];
  const n = project.clips.length;
  let ci = 0;
  const off = w.onProgress((p) => onProgress((ci + 0.1 + 0.9 * p) / n, `Transcribiendo con Whisper large-v3 (GPU)… ${Math.round(p * 100)} %`));
  const stop = setInterval(() => { if (isCancelled()) w.cancel(); }, 300);
  try {
    for (; ci < n; ci++) {
      if (isCancelled()) return null;
      const rec = await db.get('media', project.clips[ci].mediaId);
      onProgress(ci / n, `Preparando el audio de la toma ${ci + 1}…`);
      const audio = await audioMono16k(rec.blob);
      const r = await w.transcribe(audio, { lang: String(lang).slice(0, 2), quality, prompt });
      if (isCancelled()) return null;
      const dur = project.clips[ci].duration || rec.duration || Infinity;
      for (const x of r.words) {
        const t0 = Math.min(Math.max(0, x.t0), dur);
        const t1 = Math.min(Math.max(x.t1, t0 + 0.05), t0 + 1.6, dur);
        words.push({ clip: ci, text: x.text, t0, t1: Math.max(t1, t0 + 0.05) });
      }
    }
    return words;
  } finally {
    off();
    clearInterval(stop);
  }
}

async function transcribeBrowser(project, { lang = 'es-ES', model = defaultModel(), onProgress = () => {}, isCancelled = () => false } = {}) {
  const worker = new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
  const language = LANGS[String(lang).slice(0, 2)] || 'spanish';
  const words = [];
  try {
    const n = project.clips.length;
    for (let ci = 0; ci < n; ci++) {
      if (isCancelled()) return null;
      const rec = await db.get('media', project.clips[ci].mediaId);
      onProgress(ci / n, `Preparando el audio de la toma ${ci + 1}…`);
      const audio = await audioMono16k(rec.blob);
      const chunks = await runJob(worker, { audio, language, model }, (p, text) => onProgress((ci + p) / n, text), isCancelled);
      if (chunks === null) return null;
      const dur = project.clips[ci].duration || rec.duration || Infinity;
      for (const c of chunks) {
        const text = String(c.text || '').trim();
        if (!text) continue;
        const [a, b] = c.timestamp || [0, null];
        const t0 = Math.min(Number.isFinite(a) ? a : 0, dur);
        // Whisper a veces alarga la última palabra hasta el final del bloque: se limita.
        const t1 = Math.min(Number.isFinite(b) && b > t0 ? b : t0 + 0.3, t0 + 1.2, dur);
        words.push({ clip: ci, text, t0, t1: Math.max(t1, t0 + 0.05) });
      }
    }
    return words;
  } finally {
    worker.terminate();
  }
}

function runJob(worker, data, onProgress, isCancelled) {
  return new Promise((resolve, reject) => {
    const files = new Map();
    let fake = 0.3;
    let recognizing = false;
    const timer = setInterval(() => {
      if (isCancelled()) {
        clearInterval(timer);
        resolve(null);
        return;
      }
      if (recognizing) {
        fake += (0.95 - fake) * 0.03;
        onProgress(fake, 'Reconociendo tu voz…');
      }
    }, 400);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') {
        files.set(m.file, [m.loaded || 0, m.total || 0]);
        let l = 0;
        let t = 0;
        for (const [x, y] of files.values()) {
          l += x;
          t += y;
        }
        onProgress(t ? (l / t) * 0.3 : 0, `Descargando el modelo de IA… ${(l / 1048576).toFixed(0)} de ${(t / 1048576).toFixed(0)} MB`);
      } else if (m.type === 'status') {
        recognizing = m.stage === 'recognizing';
        onProgress(m.p ?? 0, m.text);
      } else if (m.type === 'result') {
        clearInterval(timer);
        resolve(m.chunks);
      } else if (m.type === 'error') {
        clearInterval(timer);
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      clearInterval(timer);
      reject(new Error(e.message || 'No se pudo iniciar la IA (¿sin conexión la primera vez?).'));
    };
    worker.postMessage({ type: 'run', ...data }, [data.audio.buffer]);
  });
}
