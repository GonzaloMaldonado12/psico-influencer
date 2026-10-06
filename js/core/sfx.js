// Efectos de sonido sutiles generados por código (sin archivos con derechos): transición, pop y campanita.
// Se usan con moderación: un «whoosh» suave en los cortes con zoom, como en los videos cortos actuales.

import { MORE_KINDS, renderMore } from './sfx-more.js';

function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

export const SFX_KINDS = {
  whoosh: { label: 'Transición (whoosh)', dur: 0.42, cat: 'Transición' },
  pop: { label: 'Pop', dur: 0.14, cat: 'Interfaz' },
  ding: { label: 'Campanita', dur: 0.9, cat: 'Acentos' },
  ...MORE_KINDS,
};


/** Sonidos reales (CC0, Kenney) de vendor/sfx. Se decodifican antes de usarlos (ver loadSfx). */
export const SAMPLE_KINDS = {
  'abrir': { label: 'Abrir', cat: 'Interfaz', file: 'abrir.wav', dur: 0.8, real: true },
  'atras': { label: 'Atrás', cat: 'Interfaz', file: 'atras.wav', dur: 0.8, real: true },
  'bajada': { label: 'Caída grave', cat: 'Transición', file: 'bajada.ogg', dur: 0.8, real: true },
  'bong': { label: 'Bong', cat: 'Interfaz', file: 'bong.wav', dur: 0.8, real: true },
  'boom-grave': { label: 'Explosión grave', cat: 'Impacto', file: 'boom-grave.ogg', dur: 0.8, real: true },
  'campana': { label: 'Campana grave', cat: 'Impacto', file: 'campana.ogg', dur: 0.8, real: true },
  'campo-fuerza': { label: 'Campo de fuerza', cat: 'Digital', file: 'campo-fuerza.ogg', dur: 0.8, real: true },
  'cerrar': { label: 'Cerrar', cat: 'Interfaz', file: 'cerrar.wav', dur: 0.8, real: true },
  'clic': { label: 'Clic real', cat: 'Interfaz', file: 'clic.wav', dur: 0.8, real: true },
  'confirmar': { label: 'Confirmar', cat: 'Interfaz', file: 'confirmar.wav', dur: 0.8, real: true },
  'cristal': { label: 'Cristal', cat: 'Impacto', file: 'cristal.ogg', dur: 0.8, real: true },
  'error-ui': { label: 'Error de interfaz', cat: 'Interfaz', file: 'error-ui.wav', dur: 0.8, real: true },
  'explosion': { label: 'Explosión', cat: 'Impacto', file: 'explosion.ogg', dur: 0.8, real: true },
  'fase-baja': { label: 'Fase baja', cat: 'Transición', file: 'fase-baja.ogg', dur: 0.8, real: true },
  'fase-sube': { label: 'Fase sube', cat: 'Transición', file: 'fase-sube.ogg', dur: 0.8, real: true },
  'glitch-a': { label: 'Glitch real A', cat: 'Digital', file: 'glitch-a.wav', dur: 0.8, real: true },
  'glitch-b': { label: 'Glitch real B', cat: 'Digital', file: 'glitch-b.wav', dur: 0.8, real: true },
  'golpe-suave': { label: 'Golpe suave', cat: 'Impacto', file: 'golpe-suave.ogg', dur: 0.8, real: true },
  'gota': { label: 'Gota', cat: 'Interfaz', file: 'gota.wav', dur: 0.8, real: true },
  'interruptor': { label: 'Interruptor', cat: 'Interfaz', file: 'interruptor.wav', dur: 0.8, real: true },
  'laser': { label: 'Láser retro', cat: 'Digital', file: 'laser.ogg', dur: 0.8, real: true },
  'madera': { label: 'Madera', cat: 'Impacto', file: 'madera.ogg', dur: 0.8, real: true },
  'maximizar': { label: 'Maximizar', cat: 'Interfaz', file: 'maximizar.wav', dur: 0.8, real: true },
  'metal-pesado': { label: 'Metal pesado', cat: 'Impacto', file: 'metal-pesado.ogg', dur: 0.8, real: true },
  'minimizar': { label: 'Minimizar', cat: 'Interfaz', file: 'minimizar.wav', dur: 0.8, real: true },
  'pluck': { label: 'Pluck', cat: 'Interfaz', file: 'pluck.wav', dur: 0.8, real: true },
  'power-up': { label: 'Power-up', cat: 'Digital', file: 'power-up.ogg', dur: 0.8, real: true },
  'power-up2': { label: 'Power-up 2', cat: 'Digital', file: 'power-up2.ogg', dur: 0.8, real: true },
  'pregunta': { label: 'Pregunta', cat: 'Interfaz', file: 'pregunta.wav', dur: 0.8, real: true },
  'punch-fuerte': { label: 'Puñetazo fuerte', cat: 'Impacto', file: 'punch-fuerte.ogg', dur: 0.8, real: true },
  'punch-medio': { label: 'Puñetazo', cat: 'Impacto', file: 'punch-medio.ogg', dur: 0.8, real: true },
  'salto-fase': { label: 'Salto de fase', cat: 'Digital', file: 'salto-fase.ogg', dur: 0.8, real: true },
  'scratch': { label: 'Scratch', cat: 'Interfaz', file: 'scratch.wav', dur: 0.8, real: true },
  'scroll': { label: 'Scroll', cat: 'Interfaz', file: 'scroll.wav', dur: 0.8, real: true },
  'seleccion': { label: 'Selección', cat: 'Interfaz', file: 'seleccion.wav', dur: 0.8, real: true },
  'subida': { label: 'Subida aguda', cat: 'Transición', file: 'subida.ogg', dur: 0.8, real: true },
  'switch': { label: 'Switch', cat: 'Interfaz', file: 'switch.wav', dur: 0.8, real: true },
  'tic': { label: 'Tic real', cat: 'Interfaz', file: 'tic.wav', dur: 0.8, real: true },
  'tres-tonos': { label: 'Tres tonos', cat: 'Acentos', file: 'tres-tonos.ogg', dur: 0.8, real: true },
  'zap-doble': { label: 'Zap doble', cat: 'Digital', file: 'zap-doble.ogg', dur: 0.8, real: true },
};

// Banco «moderno» (vendor/sfx/moderno, generado con scripts/make-sfx.mjs): los sonidos recomendados.
const M = (id, label, cat, dur) => [id, { label, cat, file: `moderno/${id}.wav`, dur, real: true, modern: true }];
export const MODERN_KINDS = Object.fromEntries([
  M('whoosh-aire', 'Whoosh de aire', 'Transición', 0.5),
  M('whoosh-rapido', 'Whoosh rápido', 'Transición', 0.25),
  M('swipe-suave', 'Deslizar suave', 'Transición', 0.2),
  M('riser-tension', 'Subida de tensión', 'Transición', 2),
  M('bajada-grave', 'Bajada grave', 'Transición', 1),
  M('impacto-cine', 'Impacto de cine', 'Impacto', 2),
  M('boom-meme', 'Boom (meme)', 'Impacto', 1.2),
  M('golpe-seco', 'Golpe seco', 'Impacto', 0.28),
  M('bass-drop', 'Bass drop', 'Impacto', 1.8),
  M('pop-burbuja', 'Pop burbuja', 'Interfaz', 0.17),
  M('click-suave', 'Clic suave', 'Interfaz', 0.05),
  M('teclas', 'Teclado', 'Interfaz', 0.78),
  M('notificacion', 'Notificación', 'Acentos', 0.85),
  M('ding-cristal', 'Ding de cristal', 'Acentos', 1.3),
  M('moneda-brillo', 'Moneda', 'Acentos', 0.57),
  M('exito-ascendente', 'Logro', 'Acentos', 1),
  M('error-suave', 'Error suave', 'Acentos', 0.38),
  M('brillos', 'Destellos', 'Acentos', 1.4),
  M('obturador', 'Obturador de cámara', 'Acentos', 0.19),
  M('glitch-corte', 'Glitch', 'Digital', 0.37),
  M('latido', 'Latido', 'Ambiente', 0.54),
]);
Object.assign(SAMPLE_KINDS, MODERN_KINDS);
// Los sonidos sintetizados antiguos suenan artificiales: siguen funcionando en proyectos viejos, pero ya no se ofrecen.
for (const [k, d] of Object.entries(SFX_KINDS)) if (!d.real) d.legacy = true;
Object.assign(SFX_KINDS, SAMPLE_KINDS);
/** Sonidos que se ofrecen en el programa y a Claude (modernos primero, luego los reales de Kenney). */
export const goodKinds = () => Object.keys(SFX_KINDS).filter((k) => !SFX_KINDS[k].legacy);

/** Devuelve un Float32Array mono normalizado a pico ≈ 0,8. */
export function renderSfx(kind, sr = 48000) {
  const dur = SFX_KINDS[kind]?.dur || 0.3;
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  const r = rng(7 + kind.length);
  if (kind === 'whoosh') {
    // Ruido filtrado cuyo tono sube y baja, con ataque suave.
    let lp = 0;
    let bp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const f = 0.02 + 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.15)); // frecuencia normalizada
      const x = r() * 2;
      lp += f * (x - lp);
      bp += f * (lp - bp);
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, t)), 1.6);
      out[i] = (lp - bp) * 6 * env;
    }
  } else if (kind === 'pop') {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 180 + 520 * Math.exp(-t * 55);
      out[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 38);
    }
  } else if (kind === 'ding') {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const v = Math.sin(2 * Math.PI * 1318.5 * t) + 0.45 * Math.sin(2 * Math.PI * 2637 * t) + 0.2 * Math.sin(2 * Math.PI * 3951 * t);
      out[i] = v * Math.exp(-t * 6.5) * Math.min(1, t * 400);
    }
  } else renderMore(kind, out, n, sr, r);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = 0.8 / peak;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

// Los nombres antiguos (sintetizados) se reproducen con su equivalente moderno, también en proyectos ya hechos.
const MODERNIZE = {
  whoosh: 'whoosh-aire', swoosh: 'whoosh-rapido', swipe: 'swipe-suave', riser: 'riser-tension', downer: 'bajada-grave',
  impact: 'impacto-cine', boom: 'boom-meme', hit: 'golpe-seco', glitch: 'glitch-corte', zap: 'glitch-corte', pop: 'pop-burbuja',
  click: 'click-suave', tick: 'click-suave', beep: 'click-suave', notif: 'notificacion', chime: 'ding-cristal', ding: 'ding-cristal',
  success: 'exito-ascendente', error: 'error-suave', coin: 'moneda-brillo', sparkle: 'brillos', camera: 'obturador',
  typing: 'teclas', heartbeat: 'latido', pulse: 'latido',
};
export const canonKind = (k) => MODERNIZE[k] || k;

const cache = new Map();
/** Sonidos de la carpeta «Material» del PC: kind = 'mat:<ruta relativa>'. */
export const isMaterialKind = (k) => typeof k === 'string' && k.startsWith('mat:');
export const materialUrl = (ruta) => `/material/f/${String(ruta).split('/').map(encodeURIComponent).join('/')}`;
export const sfxLabel = (k) => SFX_KINDS[canonKind(k)]?.label || (isMaterialKind(k) ? k.slice(4).split('/').pop().replace(/\.\w+$/, '').replace(/_\d+$/, '').replace(/_/g, ' ') : k);

/** Normaliza el pico a −1 dBFS (los sonidos de distintas fuentes quedan parejos sin tocar los archivos). */
function peakNormalize(buf) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0.001 && Math.abs(peak - 0.89) > 0.02) {
    const g = 0.89 / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
  }
  return buf;
}

/** Decodifica los sonidos reales que usa la lista (hay que esperar esto antes de reproducir o exportar). */
export async function loadSfx(ctx, list) {
  const kinds = new Set((list || []).map((e) => canonKind(e.kind)).filter((k) => SAMPLE_KINDS[k] || isMaterialKind(k)));
  await Promise.all([...kinds].map(async (k) => {
    const key = `${k}|${ctx.sampleRate}`;
    if (cache.get(ctx)?.[key]) return;
    try {
      const r = await fetch(isMaterialKind(k) ? materialUrl(k.slice(4)) : new URL(`../../vendor/sfx/${SAMPLE_KINDS[k].file}`, import.meta.url));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let buf = await ctx.decodeAudioData(await r.arrayBuffer());
      if (isMaterialKind(k)) buf = peakNormalize(buf);
      if (!cache.has(ctx)) cache.set(ctx, {});
      cache.get(ctx)[key] = buf;
      if (SAMPLE_KINDS[k]) SAMPLE_KINDS[k].dur = buf.duration;
    } catch (e) {
      console.warn('sfx', k, e);
    }
  }));
}

/** AudioBuffer cacheado por contexto y tipo (los sonidos reales deben haberse cargado con loadSfx). */
export function sfxBuffer(ctx, kind) {
  kind = canonKind(kind);
  if (SAMPLE_KINDS[kind] || isMaterialKind(kind)) return cache.get(ctx)?.[`${kind}|${ctx.sampleRate}`] || null;
  const key = `${kind}|${ctx.sampleRate}`;
  let b = cache.get(ctx) ?.[key];
  if (!b) {
    const data = renderSfx(kind, ctx.sampleRate);
    b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.copyToChannel(data, 0);
    if (!cache.has(ctx)) cache.set(ctx, {});
    cache.get(ctx)[key] = b;
  }
  return b;
}

/**
 * Coloca «whooshes» en los cortes con zoom (segmentos impares), separados al menos `gap` segundos y
 * con un máximo, para no sobrecargar. `tl` es la salida de buildSegments.
 */
export function autoSfx(tl, { gap = 4.5, max = 6, vol = 0.5 } = {}) {
  return []; // desactivado a pedido del usuario: los «whooshes» automáticos sonaban mal
  // eslint-disable-next-line no-unreachable
  const list = [];
  let last = -99;
  for (const seg of tl.segs) {
    if (seg.type !== 'video' || seg.vi % 2 !== 1) continue;
    const t = Math.max(0, seg.tlStart - 0.1);
    if (t - last < gap) continue;
    list.push({ t: +t.toFixed(2), kind: 'whoosh', vol });
    last = t;
    if (list.length >= max) break;
  }
  return list;
}
