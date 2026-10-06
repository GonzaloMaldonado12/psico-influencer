// Ajustes de exportación por plataforma (resolución, bitrate, límites y zonas seguras).
// Bitrates pensados para que la plataforma recomprima lo menos posible sin pasarse de peso.
import { even } from '../lib/util.js';

/**
 * safe: márgenes (fracción del alto/ancho) que la interfaz de la app tapa.
 * maxSec / maxMB: límites de la plataforma (0 = sin límite práctico).
 */
export const PLATFORMS = {
  'ig-reels': {
    label: 'Instagram Reels', group: 'Meta', aspect: '9:16', w: 1080, h: 1920, fps: 30,
    vbr: 9_000_000, abr: 192_000, maxSec: 180, maxMB: 1000,
    safe: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.16 },
    captionLimit: 2200, tags: ['#reels', '#reelsinstagram'],
  },
  'ig-feed': {
    label: 'Instagram Feed (4:5)', group: 'Meta', aspect: '4:5', w: 1080, h: 1350, fps: 30,
    vbr: 8_000_000, abr: 192_000, maxSec: 3600, maxMB: 1000,
    safe: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    captionLimit: 2200, tags: [],
  },
  'ig-stories': {
    label: 'Instagram / Facebook Stories', group: 'Meta', aspect: '9:16', w: 1080, h: 1920, fps: 30,
    vbr: 8_000_000, abr: 160_000, maxSec: 60, maxMB: 250,
    safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 },
    captionLimit: 0, tags: [],
  },
  'fb-reels': {
    label: 'Facebook Reels', group: 'Meta', aspect: '9:16', w: 1080, h: 1920, fps: 30,
    vbr: 9_000_000, abr: 192_000, maxSec: 90, maxMB: 1000,
    safe: { top: 0.14, bottom: 0.35, left: 0.06, right: 0.16 },
    captionLimit: 5000, tags: ['#reels'],
  },
  'fb-feed': {
    label: 'Facebook Feed (1:1)', group: 'Meta', aspect: '1:1', w: 1080, h: 1080, fps: 30,
    vbr: 8_000_000, abr: 192_000, maxSec: 14400, maxMB: 4000,
    safe: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    captionLimit: 5000, tags: [],
  },
  tiktok: {
    label: 'TikTok', group: 'TikTok', aspect: '9:16', w: 1080, h: 1920, fps: 30,
    vbr: 8_000_000, abr: 192_000, maxSec: 600, maxMB: 1000,
    safe: { top: 0.12, bottom: 0.3, left: 0.06, right: 0.18 },
    captionLimit: 4000, tags: ['#parati', '#fyp'],
  },
  'yt-shorts': {
    label: 'YouTube Shorts', group: 'Google', aspect: '9:16', w: 1080, h: 1920, fps: 30,
    vbr: 10_000_000, abr: 192_000, maxSec: 180, maxMB: 0,
    safe: { top: 0.12, bottom: 0.3, left: 0.06, right: 0.16 },
    captionLimit: 5000, tags: ['#shorts'],
  },
  'yt-1080': {
    label: 'YouTube 1080p', group: 'Google', aspect: '16:9', w: 1920, h: 1080, fps: 30,
    vbr: 12_000_000, abr: 256_000, maxSec: 0, maxMB: 0,
    safe: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 },
    captionLimit: 5000, tags: [],
  },
  'yt-4k': {
    label: 'YouTube 4K', group: 'Google', aspect: '16:9', w: 3840, h: 2160, fps: 30,
    vbr: 40_000_000, abr: 256_000, maxSec: 0, maxMB: 0,
    safe: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 },
    captionLimit: 5000, tags: [], heavy: true,
  },
  'google-ads': {
    label: 'Google / YouTube Ads', group: 'Google', aspect: '16:9', w: 1920, h: 1080, fps: 30,
    vbr: 10_000_000, abr: 192_000, maxSec: 180, maxMB: 1024,
    safe: { top: 0.05, bottom: 0.15, left: 0.05, right: 0.05 },
    captionLimit: 0, tags: [],
  },
  linkedin: {
    label: 'LinkedIn', group: 'Otras', aspect: '1:1', w: 1080, h: 1080, fps: 30,
    vbr: 8_000_000, abr: 192_000, maxSec: 600, maxMB: 5000,
    safe: { top: 0.05, bottom: 0.08, left: 0.05, right: 0.05 },
    captionLimit: 3000, tags: [],
  },
  x: {
    label: 'X (Twitter)', group: 'Otras', aspect: '16:9', w: 1920, h: 1080, fps: 30,
    vbr: 8_000_000, abr: 160_000, maxSec: 140, maxMB: 512,
    safe: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 },
    captionLimit: 280, tags: [],
  },
  pinterest: {
    label: 'Pinterest', group: 'Otras', aspect: '9:16', w: 1080, h: 1920, fps: 30,
    vbr: 8_000_000, abr: 160_000, maxSec: 300, maxMB: 2000,
    safe: { top: 0.1, bottom: 0.2, left: 0.06, right: 0.06 },
    captionLimit: 500, tags: [],
  },
  whatsapp: {
    label: 'Estado de WhatsApp', group: 'Otras', aspect: '9:16', w: 720, h: 1280, fps: 30,
    vbr: 2_400_000, abr: 128_000, maxSec: 60, maxMB: 16,
    safe: { top: 0.1, bottom: 0.15, left: 0.05, right: 0.05 },
    captionLimit: 700, tags: [],
  },
};

export const PLATFORM_GROUPS = ['Meta', 'TikTok', 'Google', 'Otras'];

/** Tamaño estimado del archivo en MB. */
export function estimateMB(p, seconds) {
  return ((p.vbr + p.abr) * seconds) / 8 / 1_000_000 * 1.03;
}

/**
 * Ajusta bitrate (y si hace falta resolución) para respetar el peso máximo de la plataforma.
 * Devuelve { w, h, vbr, abr, warnings[] }.
 */
export function fitToPlatform(p, seconds) {
  const warnings = [];
  let { w, h, vbr } = p;
  const abr = p.abr;
  if (p.maxSec && seconds > p.maxSec) warnings.push(`Dura ${Math.round(seconds)} s y ${p.label} admite hasta ${p.maxSec} s.`);
  if (p.maxMB && seconds > 0) {
    const budget = (p.maxMB * 0.95 * 8_000_000) / seconds - abr;
    if (budget < vbr) {
      vbr = Math.max(600_000, Math.floor(budget));
      if (vbr < 2_000_000 && w * h > 1280 * 720) {
        const f = 720 / Math.min(w, h);
        w = even(w * f);
        h = even(h * f);
        warnings.push('Se bajó a 720p para no pasar el peso máximo.');
      }
    }
  }
  return { w, h, vbr, abr, warnings };
}

/** Zonas seguras en píxeles para un lienzo W×H. */
export function safeRect(p, W, H) {
  const s = p.safe;
  return { x: W * s.left, y: H * s.top, w: W * (1 - s.left - s.right), h: H * (1 - s.top - s.bottom) };
}

export function platformsForAspect(aspect) {
  return Object.entries(PLATFORMS).filter(([, p]) => p.aspect === aspect).map(([k]) => k);
}
