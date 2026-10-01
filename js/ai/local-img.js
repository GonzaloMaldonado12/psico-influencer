// Motor de imágenes LOCAL (gratis, sin internet): se conecta a ComfyUI en este PC a través del programa de escritorio.
// Solo funciona en el programa de PC (o en el modo Wi-Fi del PC), porque necesita su servidor interno.
const API = '/api/comfy';

/** ¿Hay un ComfyUI abierto en este PC? Devuelve { ok, checkpoints } */
export async function probeLocal() {
  try {
    const r = await fetch(`${API}/object_info/CheckpointLoaderSimple`, { signal: AbortSignal.timeout?.(2500) });
    if (!r.ok) return { ok: false, checkpoints: [] };
    const j = await r.json();
    const list = j?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
    return { ok: true, checkpoints: list };
  } catch {
    return { ok: false, checkpoints: [] };
  }
}

/**
 * Programa de PC: si ComfyUI está cerrado, lo abre en segundo plano y espera a que cargue
 * (la primera vez tarda ~30–90 s). En el navegador solo comprueba que esté abierto.
 */
export async function ensureEngine(onStatus) {
  let p = await probeLocal();
  if (p.ok) return p;
  const comfy = typeof window !== 'undefined' ? window.psicoDesktop?.comfy : null;
  if (!comfy) throw new Error('No encuentro el motor local. Abre ComfyUI en este PC (http://127.0.0.1:8188) y vuelve a intentar.');
  onStatus?.('Encendiendo el motor de imágenes (ComfyUI)… la primera vez tarda hasta 1 minuto.');
  const r = await comfy.start();
  if (!r?.ok) throw new Error(r?.error || 'No se pudo encender ComfyUI.');
  p = await probeLocal();
  if (!p.ok) throw new Error('ComfyUI no respondió a tiempo. Ábrelo con run_nvidia_gpu.bat y vuelve a intentar.');
  return p;
}

const isXL = (n) => /xl|flux|juggernaut|pony|illustrious|realvis/i.test(n);
const isFast = (n) => /turbo|lightning|schnell|lcm|hyper/i.test(n);

function sizeFor(aspect, ck) {
  const xl = isXL(ck);
  const t = {
    '9:16': xl ? [704, 1280] : [512, 896],
    '1:1': xl ? [1024, 1024] : [640, 640],
    '16:9': xl ? [1280, 704] : [896, 512],
    '4:5': xl ? [896, 1120] : [512, 640],
  };
  return t[aspect] || t['9:16'];
}

// SDXL entiende inglés: el negativo y los términos de calidad van en inglés.
const NEGATIVE = 'text, letters, watermark, logo, signature, deformed, blurry, lowres, low quality, jpeg artifacts, extra fingers, extra hands, asymmetric eyes, cartoon, oversaturated';

/**
 * Convierte una descripción (en español) en un prompt profesional en inglés para SDXL usando Claude
 * (Haiku, ~300 tokens). Sin Claude o sin internet devuelve la descripción tal cual.
 */
export async function enhancePrompt(text, aspect = '9:16') {
  if (!text?.trim() || typeof window === 'undefined' || !window.psicoDesktop?.claude) return text;
  try {
    const { askClaude } = await import('./claude.js');
    const r = await askClaude({
      task: 'short',
      system: 'Escribes prompts para Stable Diffusion XL. Devuelve un prompt en inglés de 40 a 70 palabras: sujeto, entorno, luz, lente/estilo fotográfico y composición. Sin texto ni letras en la imagen, sin marcas ni personas famosas. Si es fondo o portada, deja espacio limpio para el título.',
      prompt: `Formato ${aspect}. Descripción: ${text}`,
      schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'], additionalProperties: false },
    });
    return r.data?.prompt?.trim() || text;
  } catch {
    return text;
  }
}

function workflow(prompt, aspect, ck) {
  const [w, h] = sizeFor(aspect, ck);
  const fast = isFast(ck);
  return {
    3: { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 2 ** 31), steps: fast ? 6 : 28, cfg: fast ? 1.5 : 6.5, sampler_name: fast ? 'euler' : 'dpmpp_2m', scheduler: fast ? 'simple' : 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ck } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: `${prompt}, photorealistic, high quality, natural light, sharp focus, detailed`, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE, clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'psico', images: ['8', 0] } },
  };
}

/** Crea una imagen en este PC. onProgress(fracción 0–1, texto) usa el tiempo medio de generaciones anteriores. */
export async function generateLocal(prompt, { aspect = '9:16', checkpoint, expectedMs = 30000, onProgress, signal } = {}) {
  const p = await ensureEngine((t) => onProgress?.(0.02, t));
  const ck = checkpoint && p.checkpoints.includes(checkpoint) ? checkpoint : p.checkpoints[0];
  if (!ck) throw new Error('ComfyUI está abierto pero no tiene ningún modelo (checkpoint). Copia uno a ComfyUI/models/checkpoints.');
  const t0 = performance.now();
  const r = await fetch(`${API}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow(prompt, aspect, ck) }),
    signal,
  });
  if (!r.ok) throw new Error(`ComfyUI rechazó el trabajo (${r.status}). Revisa su ventana de comandos.`);
  const { prompt_id: id } = await r.json();
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelado');
    await new Promise((res) => setTimeout(res, 700));
    const el = performance.now() - t0;
    onProgress?.(Math.min(0.95, el / Math.max(expectedMs, 3000)), `Generando en tu PC… ${(el / 1000).toFixed(0)} s`);
    if (el > 10 * 60 * 1000) throw new Error('El motor local tardó demasiado.');
    const h = await fetch(`${API}/history/${id}`);
    if (!h.ok) continue;
    const j = await h.json();
    const out = j[id]?.outputs?.['9']?.images?.[0];
    if (j[id]?.status?.status_str === 'error') throw new Error('ComfyUI falló al generar (revisa que el modelo sea compatible).');
    if (!out) continue;
    const v = await fetch(`${API}/view?filename=${encodeURIComponent(out.filename)}&subfolder=${encodeURIComponent(out.subfolder || '')}&type=${encodeURIComponent(out.type || 'output')}`);
    if (!v.ok) throw new Error('No pude leer la imagen generada.');
    return { blob: await v.blob(), model: ck, ms: performance.now() - t0 };
  }
}
