// Worker de transcripción: Transformers.js + Whisper con marcas de tiempo por palabra.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

let lib = null;
const pipes = new Map();

const progress_callback = (p) => {
  if (p.status === 'progress') postMessage({ type: 'download', file: p.file, loaded: p.loaded, total: p.total });
};

const MOBILE = /iPhone|iPad|iPod|Android/i.test(self.navigator?.userAgent || '');

async function hasWebGPU() {
  if (MOBILE) return false; // evita descargar dos variantes del modelo
  try {
    return !!(self.navigator?.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function getPipe(model, forceWasm = false) {
  lib ||= await import(LIB);
  lib.env.useBrowserCache = true;
  lib.env.allowLocalModels = false;
  const key = `${model}|${forceWasm ? 'wasm' : 'auto'}`;
  if (pipes.has(key)) return pipes.get(key);
  let pipe = null;
  if (!forceWasm && (await hasWebGPU())) {
    try {
      pipe = await lib.pipeline('automatic-speech-recognition', model, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
      pipe.__device = 'webgpu';
    } catch (e) {
      console.warn('WebGPU no disponible para Whisper, se usa WASM', e);
      pipe = null;
    }
  }
  if (!pipe) {
    pipe = await lib.pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback });
    pipe.__device = 'wasm';
  }
  pipes.set(key, pipe);
  return pipe;
}

const OPTS = (language) => ({ language, task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });

self.onmessage = async (e) => {
  const { audio, language, model } = e.data;
  try {
    postMessage({ type: 'status', stage: 'loading', text: 'Cargando el modelo de IA…', p: 0.02 });
    let pipe = await getPipe(model);
    postMessage({ type: 'status', stage: 'recognizing', text: 'Reconociendo tu voz…', p: 0.3 });
    let out;
    try {
      out = await pipe(audio, OPTS(language));
    } catch (err) {
      if (pipe.__device !== 'webgpu') throw err;
      console.warn('Fallo con WebGPU, reintentando con WASM', err);
      pipe = await getPipe(model, true);
      out = await pipe(audio, OPTS(language));
    }
    const chunks = (out?.chunks || []).map((c) => ({ text: c.text, timestamp: c.timestamp }));
    postMessage({ type: 'result', chunks });
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
