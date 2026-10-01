// IA de texto local: guiones, ganchos, títulos, descripciones y hashtags en español de Chile.
// Proveedores: Ollama (si está instalado en el PC) o un modelo que corre en el navegador.
import { db } from '../lib/db.js';

export const LLM_MODELS = {
  rapido: { id: 'onnx-community/Qwen3-0.6B-ONNX', label: 'Básico · Qwen3 0,6B (~0,5 GB, para iPhone)', noThink: true },
  calidad: { id: 'onnx-community/gemma-3-1b-it-ONNX', label: 'Calidad · Gemma 3 1B (~0,7 GB, recomendado)' },
  maxima: { id: 'onnx-community/Qwen3-1.7B-ONNX', label: 'Máxima · Qwen3 1,7B (~1,4 GB, PC con 16 GB de RAM)', noThink: true },
};

const isMobile = () =>
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function getAISettings() {
  const s = {
    provider: 'auto', // auto (Claude → IA local) | claude | ollama | browser
    model: isMobile() ? 'rapido' : 'calidad', // el iPhone tiene poca memoria para el modelo grande
    ollamaModel: '',
    ...(await db.getKV('ai', {})),
  };
  if (isMobile()) s.model = 'rapido'; // el iPhone solo usa el modelo liviano
  return s;
}

export function saveAISettings(s) {
  return db.setKV('ai', s);
}

export const SYSTEM = [
  'Eres guionista experto en videos cortos para redes sociales (Reels, TikTok, Shorts, YouTube) y en divulgación de psicología y salud mental.',
  'Escribes en español de Chile: natural, cercano y claro, sin chilenismos exagerados ni groserías.',
  'Usas frases cortas, fáciles de leer en un teleprompter.',
  'No inventes cifras, estudios ni casos reales. Si un dato concreto es imprescindible, escribe una indicación breve entre corchetes, por ejemplo [tu experiencia]; úsalo lo menos posible.',
  'En salud mental usas lenguaje responsable: sin diagnosticar, sin prometer curas, y sugieres buscar ayuda profesional cuando corresponde.',
  'Respondes solo con el texto pedido, sin explicaciones ni comentarios adicionales.',
].join(' ');

// Modelos de Ollama preferidos para este tipo de trabajo (buen español, caben en 8 GB de VRAM).
export const OLLAMA_PREFERRED = ['qwen3:8b', 'gemma3:4b', 'qwen3:4b', 'llama3.1:8b', 'gemma3:12b', 'llama3.2:3b'];
export function pickOllamaModel(models, chosen) {
  if (chosen && models.includes(chosen)) return chosen;
  for (const p of OLLAMA_PREFERRED) {
    const m = models.find((x) => x === p || x.startsWith(p + '-') || x.split(':')[0] + ':' + x.split(':')[1] === p);
    if (m) return m;
  }
  return models[0];
}

/** ¿El modelo ya está guardado en este dispositivo? (se descarga solo la primera vez) */
export async function modelCached(modelId) {
  try {
    const keys = await (await caches.open('transformers-cache')).keys();
    return keys.some((r) => r.url.includes(modelId.split('/')[1] || modelId));
  } catch {
    return false;
  }
}

let ollamaCache = null;
/** Modelos de Ollama disponibles a través del servidor local (o [] si no hay). */
export async function ollamaModels(force = false) {
  if (ollamaCache && !force) return ollamaCache;
  try {
    const r = await fetch('/api/ollama/api/tags', { signal: AbortSignal.timeout?.(1500) });
    if (!r.ok) throw new Error();
    const j = await r.json();
    ollamaCache = (j.models || []).map((m) => m.name);
  } catch {
    ollamaCache = [];
  }
  return ollamaCache;
}

let worker = null;
let seq = 0;
function getWorker() {
  worker ||= new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

export function stopGeneration() {
  worker?.postMessage({ type: 'stop' });
  currentAbort?.abort();
}

let currentAbort = null;

function cleanOutput(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*<think>[\s\S]*$/g, '')
    .replace(/\s*\[corchetes?\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Genera texto. onToken(textoAcumulado) para mostrarlo en vivo.
 * Devuelve el texto final limpio.
 */
export async function generate({ prompt, system = SYSTEM, maxTokens = 700, temperature = 0.7, onToken, onStatus, onProgress, task } = {}) {
  const s = await getAISettings();
  // 1) Claude con tu plan (programa de PC). Sin internet o sin Claude → IA local, sin preguntar.
  if ((s.provider === 'auto' || s.provider === 'claude') && typeof window !== 'undefined' && window.psicoDesktop?.claude) {
    const { askClaude, claudeReason, MODEL_LABEL, tokensOf } = await import('./claude.js');
    try {
      onStatus?.('Escribiendo con Claude…');
      const r = await askClaude({ task: task || (maxTokens < 600 ? 'short' : 'write'), system, prompt });
      const text = cleanOutput(r.text);
      onToken?.(text);
      onStatus?.(`Escrito con Claude ${MODEL_LABEL[r.modelKey] || ''} · ${tokensOf(r).toLocaleString('es')} tokens de tu plan`);
      return text;
    } catch (e) {
      if (s.provider === 'claude') throw new Error(claudeReason(e));
      onStatus?.(`${claudeReason(e)} Uso la IA local…`);
      import('./ai-usage.js').then((u) => u.recordLocalText()).catch(() => {});
    }
  }
  const models = s.provider === 'browser' ? [] : await ollamaModels();
  const useOllama = (s.provider === 'ollama' || s.provider === 'auto') && models.length;
  if (s.provider === 'ollama' && !models.length) throw new Error('Ollama no responde. Ábrelo en el PC o elige «En el navegador» en Ajustes › IA.');
  if (useOllama) {
    const model = pickOllamaModel(models, s.ollamaModel);
    onStatus?.(`Escribiendo con Ollama (${model})…`);
    currentAbort = new AbortController();
    const r = await fetch('/api/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: /qwen3/i.test(model) ? `${prompt}

/no_think` : prompt }], options: { temperature, num_ctx: 4096 } }),
      signal: currentAbort.signal,
    });
    if (!r.ok || !r.body) throw new Error(`Ollama respondió ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let acc = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.message?.content) {
            acc += j.message.content;
            onToken?.(cleanOutput(acc));
          }
        } catch {
          /* línea incompleta */
        }
      }
    }
    return cleanOutput(acc);
  }
  // En el dispositivo. Qwen3 va sin «modo pensar» para responder directo.
  const info = LLM_MODELS[s.model] || LLM_MODELS.calidad;
  const model = info.id;
  const w = getWorker();
  const id = ++seq;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: info.noThink ? `${prompt}\n\n/no_think` : prompt },
  ];
  const cached = await modelCached(model);
  if (cached) onStatus?.('Cargando el modelo ya guardado en tu dispositivo…');
  return new Promise((resolve, reject) => {
    let acc = '';
    const files = new Map();
    const onMsg = (e) => {
      const m = e.data;
      if (m.id !== undefined && m.id !== id && m.type !== 'download') return;
      if (m.type === 'download') {
        files.set(m.file, [m.loaded || 0, m.total || 0]);
        let l = 0;
        let t = 0;
        for (const [a, b] of files.values()) {
          l += a;
          t += b;
        }
        onProgress?.(t ? l / t : 0, cached ? 'Cargando el modelo guardado…' : `Descargando el modelo de IA (solo la primera vez)… ${(l / 1048576).toFixed(0)} de ${(t / 1048576).toFixed(0)} MB`);
      } else if (m.type === 'status') onStatus?.(m.text);
      else if (m.type === 'token') {
        acc += m.text;
        onToken?.(cleanOutput(acc));
      } else if (m.type === 'done') {
        w.removeEventListener('message', onMsg);
        resolve(cleanOutput(m.text || acc));
      } else if (m.type === 'error') {
        w.removeEventListener('message', onMsg);
        reject(new Error(m.message));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'generate', id, model, messages, maxTokens, temperature });
  });
}

// ---------- Tareas ----------

const WPS = 2.4; // palabras por segundo al hablar

export function promptScript({ tema, audiencia, beneficio, formato, tono, duracion = 45, cta, psico = true }) {
  const words = Math.round(duracion * WPS);
  return [
    `Escribe un guion para un video de ${duracion} segundos (unas ${words} palabras) sobre: ${tema || 'un tema de salud mental'}.`,
    audiencia ? `Público: ${audiencia}.` : '',
    beneficio ? `Lo que la persona gana al verlo: ${beneficio}.` : '',
    formato ? `Formato: ${formato}.` : '',
    tono ? `Tono: ${tono}.` : '',
    'Estructura: una primera frase gancho de máximo 12 palabras que detenga el scroll; luego 3 a 5 ideas concretas; cierre breve.',
    cta ? `Termina con esta llamada a la acción: «${cta}».` : '',
    psico ? 'Si el tema es de salud mental, agrega al final una línea breve indicando que el contenido es informativo y no reemplaza la terapia.' : '',
    'Separa cada idea en un párrafo corto. No uses títulos, viñetas ni emojis.',
  ].filter(Boolean).join('\n');
}

export function promptHooks(tema, n = 10) {
  return [
    `Escribe ${n} ganchos distintos para la primera frase de un video corto sobre: ${tema}.`,
    'Cada gancho: máximo 12 palabras, claro, que despierte curiosidad y hable directo a quien mira (tú).',
    'Varía el estilo: una pregunta, un mito, un error común, una promesa concreta, una señal de alerta.',
    'Ejemplos del estilo buscado: «3 señales de que tu ansiedad no es solo estrés» / «El error que cometes cada noche antes de dormir».',
    'Escribe uno por línea, sin numerar, sin comillas y sin corchetes.',
  ].join('\n');
}

export function promptImprove(texto) {
  return `Mejora este guion para video: más claro, dinámico y fácil de leer en teleprompter. Mantén el sentido y la extensión aproximada, frases cortas, sin emojis:\n\n${texto}`;
}

export function promptPost({ texto, plataforma, tema }) {
  return [
    `Escribe el texto para publicar este video en ${plataforma}.`,
    tema ? `Tema: ${tema}.` : '',
    'Entrega exactamente:',
    'TÍTULO: (máximo 60 caracteres, atractivo)',
    'DESCRIPCIÓN: (2 a 4 frases, cercanas, con 2 o 3 emojis y una llamada a la acción)',
    'HASHTAGS: (10 hashtags relevantes en español, mezcla populares y de nicho, separados por espacio)',
    '',
    `Contenido del video:\n${String(texto).slice(0, 2500)}`,
  ].filter(Boolean).join('\n');
}

export function promptClips(texto) {
  return `Del siguiente texto de un video, elige hasta 4 fragmentos que funcionen solos como clips cortos para redes. Para cada uno escribe en una línea: la primera frase exacta del fragmento | un título corto. Sin numerar.\n\n${String(texto).slice(0, 4000)}`;
}
