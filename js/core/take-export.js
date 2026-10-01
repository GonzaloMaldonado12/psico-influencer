// Prepara una toma para guardarla en el celular: MP4 (H.264 + AAC), voz mejorada y a -14 LUFS
// (volumen estándar de redes) y, si lo eliges, la mirada corregida hacia la cámara con IA.
// Sin subtítulos, música ni marca: la edición completa se hace en el programa de PC.
import { newProject, addMedia, defaultBrand } from '../store.js';
import { proExport, proExportSupport } from './pro-export.js';
import { even } from '../lib/util.js';

/** Proyecto mínimo de una sola toma, a pantalla completa y sin capas. */
export function takeProject(media, { gaze = true, strength = 0.75 } = {}) {
  const portrait = (media.height || 0) >= (media.width || 0);
  const p = newProject({ title: media.name || 'Toma', clips: [media], aspect: portrait ? '9:16' : '16:9' });
  Object.assign(p.layout, { zoom: 1, mode: 'full', dynamicZoom: false, transition: 'none', offsetX: 0, offsetY: 0 });
  p.captions.enabled = false;
  Object.assign(p.brand, { logo: false, handle: false });
  p.brand.lowerThird.enabled = false;
  p.brand.progress.enabled = false;
  p.intro.enabled = false;
  p.outro.enabled = false;
  Object.assign(p.audio, { enhance: true, musicId: null, sfx: [], sfxOn: false });
  p.color = { preset: 'none', brightness: 1, contrast: 1, saturation: 1, temp: 0, tint: 0, vignette: 0, denoise: 0, sharpen: 0, grain: 0 };
  p.fx.bg.mode = 'none';
  p.fx.gaze = { enabled: !!gaze, strength };
  p.fx.reframe = { enabled: false };
  p.fx.light = { auto: false, exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, faceBoost: 0, vignette: 0 };
  return p;
}

/** Tamaño de salida: el de la toma (máximo 1080p), siempre par. */
export function takeSpec(media) {
  const w0 = media.width || 1080;
  const h0 = media.height || 1920;
  const f = Math.min(1, 1920 / Math.max(w0, h0), 1080 / Math.min(w0, h0));
  const portrait = h0 >= w0;
  const fps = (media.fps || 30) >= 50 ? 60 : 30;
  return { aspect: portrait ? '9:16' : '16:9', w: even(w0 * f), h: even(h0 * f), fps, vbr: fps > 30 ? 16e6 : 12e6, abr: 192000 };
}

export async function canProcessTakes() {
  return (await proExportSupport()).ok;
}

/** Procesa la toma y la guarda como un video nuevo (el original no se toca). */
export async function processTake(media, { gaze = true, strength = 0.75, onProgress, isCancelled } = {}) {
  const support = await proExportSupport();
  if (!support.ok) throw new Error(support.reason);
  const project = takeProject(media, { gaze, strength });
  const spec = takeSpec(media);
  project.layout.aspect = spec.aspect;
  const res = await proExport({ project, brand: defaultBrand(), spec, normalize: true, onProgress, isCancelled });
  if (!res) return null;
  return addMedia({
    blob: res.blob,
    name: `${media.name || 'Toma'}${gaze ? ' · mirada' : ''}`,
    kind: 'export',
    duration: media.duration,
    width: res.width,
    height: res.height,
    extra: { fromTake: media.id, gaze: !!gaze, thumb: media.thumb || null, scriptTitle: media.scriptTitle || '' },
  });
}
