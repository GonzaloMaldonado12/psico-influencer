// Visión por computador en el dispositivo (MediaPipe): segmentación de persona y rostro.
// Los modelos y el motor WASM están en /vendor, así que funciona sin conexión.
const VENDOR = new URL('../../vendor/', import.meta.url).href;

let libP = null;
let filesetP = null;
const tasks = {};
let clock = 0;

function lib() {
  libP ||= import(`${VENDOR}mediapipe/vision_bundle.mjs`);
  return libP;
}

async function fileset() {
  if (!filesetP) {
    const m = await lib();
    filesetP = m.FilesetResolver.forVisionTasks(`${VENDOR}mediapipe/wasm`);
  }
  return filesetP;
}

function create(kind, factory) {
  if (!tasks[kind]) {
    tasks[kind] = (async () => {
      const m = await lib();
      const fs = await fileset();
      let lastErr;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          const t = await factory(m, fs, delegate);
          t.__delegate = delegate;
          return t;
        } catch (e) {
          lastErr = e;
          console.warn(`MediaPipe ${kind} con ${delegate} falló`, e);
        }
      }
      throw lastErr;
    })().catch((e) => {
      delete tasks[kind];
      throw e;
    });
  }
  return tasks[kind];
}

/** Marca de tiempo creciente (MediaPipe exige que nunca retroceda). */
export function nextTs() {
  clock = Math.max(clock + 1, Math.floor(performance.now()));
  return clock;
}

/** hq = modelo multiclase (mejor pelo y bordes, más lento); si no, el rápido. */
export function getSegmenter(hq = false) {
  const model = hq ? 'selfie_multiclass_256x256.tflite' : 'selfie_segmenter.tflite';
  return create(`seg-${hq ? 'hq' : 'fast'}`, (m, fs, delegate) =>
    m.ImageSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${VENDOR}models/${model}`, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  );
}

export function getFaceLandmarker() {
  return create('face', (m, fs, delegate) =>
    m.FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: `${VENDOR}models/face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    })
  );
}

/** Carga un modelo ('seg-fast' | 'seg-hq' | 'face') y lo deja listo para uso síncrono. */
export async function ensure(kind) {
  const t = kind === 'face' ? await getFaceLandmarker() : await getSegmenter(kind === 'seg-hq');
  tasks[kind].__value = t;
  return t;
}

/** Tarea ya cargada o null (para usarla de forma síncrona en el render). */
export function readyTask(kind) {
  return tasks[kind]?.__value || null;
}

/**
 * Probabilidad de persona por píxel (Float32Array w×h) de forma síncrona.
 * Devuelve null si el modelo aún no está cargado.
 */
/**
 * Valor «rodeado»: 1 si hay persona a ambos lados (izquierda y derecha, o arriba y abajo) a menos de r
 * píxeles. Un micrófono frente al pecho está rodeado de ropa; el respaldo de una silla junto a la cabeza
 * o la cama junto al brazo no, porque la persona queda solo de un lado. Usa sumas acumuladas: O(n).
 */
function enclosed(src, w, h, r) {
  const out = new Float32Array(src.length);
  const row = new Int32Array((w + 1) * h);
  const col = new Int32Array(w * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) row[y * (w + 1) + x + 1] = row[y * (w + 1) + x] + (src[y * w + x] > 0.5 ? 1 : 0);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) col[(y + 1) * w + x] = col[y * w + x] + (src[y * w + x] > 0.5 ? 1 : 0);
  const rs = (y, x0, x1) => row[y * (w + 1) + Math.min(w, x1)] - row[y * (w + 1) + Math.max(0, x0)];
  const cs = (x, y0, y1) => col[Math.min(h, y1) * w + x] - col[Math.max(0, y0) * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hor = rs(y, x - r, x) > 0 && rs(y, x + 1, x + 1 + r) > 0;
      const ver = cs(x, y - r, y) > 0 && cs(x, y + 1, y + 1 + r) > 0;
      out[y * w + x] = hor || ver ? 1 : 0;
    }
  }
  return out;
}

export function personAlpha(source, hq, ts = nextTs()) {
  const seg = readyTask(hq ? 'seg-hq' : 'seg-fast');
  if (!seg) return null;
  const res = seg.segmentForVideo(source, ts);
  try {
    const masks = res.confidenceMasks || [];
    if (!masks.length) return null;
    const m0 = masks[0];
    const w = m0.width;
    const h = m0.height;
    const data = m0.getAsFloat32Array();
    const alpha = new Float32Array(w * h);
    if (masks.length > 1) {
      // Multiclase: 0 fondo, 1 pelo, 2 piel del cuerpo, 3 piel de la cara, 4 ropa, 5 otros.
      // «Otros» (micrófono, audífonos, respaldo de la silla) solo cuenta si está pegado a la persona:
      // así el micrófono frente al pecho se conserva y los muebles de atrás no se cuelan.
      const core = new Float32Array(alpha.length);
      for (let k = 1; k <= 4 && k < masks.length; k++) {
        const dk = masks[k].getAsFloat32Array();
        for (let i = 0; i < core.length; i++) core[i] += dk[i];
      }
      const near = enclosed(core, w, h, Math.max(3, Math.round(w * 0.05)));
      const other = masks.length > 5 ? masks[5].getAsFloat32Array() : null;
      for (let i = 0; i < alpha.length; i++) {
        const c = core[i] > 1 ? 1 : core[i];
        alpha[i] = other ? Math.min(1, c + other[i] * near[i]) : 1 - data[i];
      }
    } else {
      // Modelo rápido: una sola máscara con la confianza de la persona.
      alpha.set(data);
    }
    return { w, h, alpha };
  } finally {
    res.close?.();
    for (const m of res.confidenceMasks || []) m.close?.();
  }
}

// Índices de la malla facial de MediaPipe.
export const EYES = {
  right: { contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], corners: [33, 133], lids: [159, 145], iris: [468, 469, 470, 471, 472] },
  left: { contour: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], corners: [362, 263], lids: [386, 374], iris: [473, 474, 475, 476, 477] },
};
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

/** Rostro principal: landmarks normalizados + caja, centro y tamaño. Síncrono. */
export function detectFace(source, ts = nextTs()) {
  const fl = readyTask('face');
  if (!fl) return null;
  const res = fl.detectForVideo(source, ts);
  const lm = res.faceLandmarks?.[0];
  if (!lm) return { found: false };
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const i of FACE_OVAL) {
    const p = lm[i];
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return {
    found: true,
    landmarks: lm,
    box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    size: Math.max(x1 - x0, y1 - y0),
  };
}

/** Estado del motor para diagnóstico. */
export function visionStatus() {
  return Object.fromEntries(Object.entries(tasks).map(([k, p]) => [k, p.__value ? p.__value.__delegate : 'cargando']));
}
