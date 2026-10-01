// Worker de IA de texto local (Transformers.js + Qwen3), con WebGPU si está disponible.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

let lib = null;
let gen = null;
let genKey = '';
let stopFlag = false;

const MOBILE = /iPhone|iPad|iPod|Android/i.test(self.navigator?.userAgent || '');

async function hasWebGPU() {
  if (MOBILE) return false; // en el móvil solo WASM: probar WebGPU y caer a WASM descargaba el modelo dos veces
  try {
    return !!(self.navigator?.gpu && (await self.navigator.gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(model) {
  lib ||= await import(LIB);
  lib.env.useBrowserCache = true; // el modelo se guarda y se descarga una sola vez
  lib.env.allowLocalModels = false;
  const gpu = await hasWebGPU();
  const progress_callback = (p) => {
    if (p.status === 'progress') postMessage({ type: 'download', file: p.file, loaded: p.loaded, total: p.total });
  };
  try {
    const g = await lib.pipeline('text-generation', model, { device: gpu ? 'webgpu' : 'wasm', dtype: gpu ? 'q4f16' : 'q4', progress_callback });
    g.__device = gpu ? 'webgpu' : 'wasm';
    return g;
  } catch (e) {
    if (!gpu) throw e;
    const g = await lib.pipeline('text-generation', model, { device: 'wasm', dtype: 'q4', progress_callback });
    g.__device = 'wasm';
    return g;
  }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'stop') {
    stopFlag = true;
    return;
  }
  if (m.type !== 'generate') return;
  const { id, model, messages, maxTokens = 600, temperature = 0.7 } = m;
  stopFlag = false;
  try {
    if (genKey !== model) {
      postMessage({ type: 'status', id, text: 'Cargando el modelo de IA…' });
      gen = await load(model);
      genKey = model;
    }
    postMessage({ type: 'status', id, text: `Escribiendo (${gen.__device === 'webgpu' ? 'GPU' : 'CPU'})…` });
    let acc = '';
    const streamer = new lib.TextStreamer(gen.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => {
        acc += text;
        postMessage({ type: 'token', id, text });
      },
    });
    const stopping = lib.StoppingCriteriaList ? new lib.StoppingCriteriaList() : null;
    if (stopping && lib.StoppingCriteria) {
      class UserStop extends lib.StoppingCriteria {
        _call(ids) {
          return new Array(ids.length).fill(stopFlag);
        }
      }
      stopping.push(new UserStop());
    }
    const out = await gen(messages, {
      max_new_tokens: maxTokens,
      do_sample: temperature > 0,
      temperature: Math.max(0.01, temperature),
      top_p: 0.9,
      repetition_penalty: 1.08,
      streamer,
      ...(stopping ? { stopping_criteria: stopping } : {}),
    });
    const last = out?.[0]?.generated_text;
    const text = Array.isArray(last) ? last.at(-1)?.content ?? acc : String(last ?? acc);
    postMessage({ type: 'done', id, text });
  } catch (err) {
    postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
