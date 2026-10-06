// «Idioma» de edición que entienden Claude y la IA local: una lista corta de operaciones que la app
// aplica sobre el proyecto. Lo usan el asistente del editor y el servidor MCP (Claude Desktop/Code).
// Pensado para gastar pocos tokens: catálogo compacto, contexto resumido y tiempos en segundos.
import { buildSegments, tlToSrc, srcToTl, mergeCuts, cutSource } from '../core/timeline.js';
import { CAPTION_PRESETS, presetStyle, buildCaptionIndex, findFillers, pickKeywords, captionCues } from '../core/captions.js';
import { autoEmojis } from '../core/emoji.js';
import { TRANSITIONS, EFFECTS } from '../core/fx-lib.js';
import { GL_RECOMMENDED } from '../core/gl-transitions.js';
import { SFX_KINDS, autoSfx, MODERN_KINDS } from '../core/sfx.js';
import { MUSIC_STYLES } from '../core/music-gen.js';
import { LOOKS } from '../core/grade.js';
import { SCENES } from '../core/scenes.js';
import { BG_GRADIENTS } from '../core/effects.js';
import { findSilences, silenceCuts } from '../core/audio-analysis.js';
import { uid, clamp, fmtTime, normalizeWord, splitWords } from '../lib/util.js';

const STOP = new Set('para porque cuando donde tambien siempre nunca mucho mucha muchos muchas entonces ahora aqui algo alguien nada tiene tienen hacer puede pueden estar estoy estas esta este esto como pero sobre entre desde hasta todos todas cada otra otro'.split(' '));
const ASPECTS = ['9:16', '1:1', '4:5', '16:9'];
const POS_Y = { arriba: 0.2, centro: 0.5, abajo: 0.78 };
const MAT_CODE = /^[smvole]\d+$/i;

/** Operaciones disponibles: firma compacta (para el modelo) y si cambian la estructura del video. */
export const OPS = {
  quitar_silencios: { sig: '{min?:s}', structural: true },
  quitar_muletillas: { sig: '{}', structural: true },
  cortar: { sig: '{desde:s,hasta:s}', structural: true },
  subtitulos: { sig: '{activar?,estilo?,posicion?:arriba|centro|abajo,mayusculas?,palabras?:1-6}' },
  palabras_clave: { sig: '{activar?,palabras?:[..],color?:#hex}' },
  emojis: { sig: '{activar?}' },
  zoom_dinamico: { sig: '{activar?}' },
  transicion: { sig: '{tipo,donde?:todos|primero|<s>,duracion?:s}' },
  efecto: { sig: '{tipo,desde:s,hasta:s,intensidad?:0-1}' },
  musica: { sig: '{archivo?:m#,estilo?,volumen?:0-1,quitar?}' },
  sonidos_cortes: { sig: '{activar?}' },
  sonido: { sig: '{tipo(nombre o s#),en:s,volumen?:0-1}' },
  material: { sig: '{codigo:v#|o#|e#,desde:s,hasta:s,x?:0-1,y?:0-1}' },
  texto: { sig: '{texto,desde:s,hasta:s,posicion?:arriba|centro|abajo,caja?,color?:#hex,tamano?:4-16}' },
  emoji: { sig: '{emoji,desde:s,hasta:s}' },
  titular: { sig: '{texto,modo?:inicio|siempre|ninguno}' },
  nombre_en_pantalla: { sig: '{activar?,nombre?,rol?}' },
  color: { sig: '{look?,lut?:l#,intensidad?:0-1}' },
  luz: { sig: '{intensidad:0-1}' },
  fondo: { sig: '{modo:ninguno|desenfoque|escena|degradado,escena?,degradado?}' },
  mirada: { sig: '{activar?,intensidad?:0-1}' },
  formato: { sig: '{aspecto:9:16|1:1|4:5|16:9}' },
  encuadre: { sig: '{zoom:0.7-1.3}' },
  velocidad: { sig: '{factor:0.8-1.5}' },
  stock: { sig: '{buscar(inglés, 2-4 palabras),uso:broll|fondo,desde?:s,hasta?:s}' },
  imagen: { sig: '{prompt(inglés, detallado),uso:broll|fondo|biblioteca,desde?:s,hasta?:s}' },
  portada: { sig: '{tiempo?:s,texto?}' },
  intro: { sig: '{activar?,texto?}' },
  cierre: { sig: '{activar?,texto?}' },
  publicacion: { sig: '{titulo,descripcion,hashtags}' },
};

/** Catálogo compacto (~400 tokens) que se entrega al modelo una sola vez. */
export function opsCatalog() {
  return [
    'OPERACIONES (tiempos en segundos del video ACTUAL, como en la transcripción):',
    ...Object.entries(OPS).map(([k, v]) => `${k} ${v.sig}`),
    `estilos: ${Object.keys(CAPTION_PRESETS).join(' ')}`,
    `transiciones: ${Object.keys(TRANSITIONS).filter((k) => !k.startsWith('gl:')).join(' ')} · pro: ${GL_RECOMMENDED.map((n) => `gl:${n}`).join(' ')}`,
    `efectos: ${Object.keys(EFFECTS).join(' ')}`,
    `sonidos: ${Object.keys(MODERN_KINDS).join(' ')}`,
    `musica: ${Object.keys(MUSIC_STYLES).join(' ')}`,
    `looks: ${Object.keys(LOOKS).join(' ')}`,
    `escenas: ${Object.keys(SCENES).join(' ')} · degradados: ${Object.keys(BG_GRADIENTS).filter((k) => k !== 'marca').join(' ')}`,
  ].join('\n');
}

/** Esquema JSON de la respuesta del modelo (salida estructurada validada). */
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string', description: 'Qué harás y por qué, en 1-3 frases' },
    ops: {
      type: 'array',
      items: { type: 'object', properties: { op: { type: 'string', enum: Object.keys(OPS) } }, required: ['op'], additionalProperties: true },
    },
  },
  required: ['resumen', 'ops'],
  additionalProperties: false,
};

// ---------- Contexto compacto del proyecto ----------

export function projectSummary(P) {
  const tl = buildSegments(P);
  const cuts = P.clips.reduce((n, c) => n + (c.cuts?.length || 0), 0);
  const cap = P.captions;
  const ov = (P.overlays || []).reduce((m, o) => ((m[o.kind] = (m[o.kind] || 0) + 1), m), {});
  const ovTxt = Object.entries(ov).map(([k, n]) => `${n} ${k}`).join(', ') || '0';
  return [
    `Proyecto «${P.title}» · ${P.layout.aspect} · ${fmtTime(tl.total)} (${P.clips.length} toma${P.clips.length === 1 ? '' : 's'}, ${cuts} cortes) · velocidad ${P.speed || 1}× · audio: ${P.audioMode === 'music' ? 'instrumento' : 'voz'}`,
    `Subtítulos: ${cap.enabled && cap.words.length ? `sí (${cap.source || 'texto'}, estilo ${cap.style.preset}${cap.keywords ? ', palabras clave' : ''})` : 'no'} | Música: ${P.audio.musicId ? `${P.audio.musicName || 'sí'} ${Math.round(P.audio.musicVol * 100)}%` : 'no'} | Sonidos: ${P.audio.sfx?.length || 0} | Efectos: ${P.effects?.length || 0} | Capas: ${ovTxt}`,
    `Fondo: ${P.fx.bg.mode} · Mirada IA: ${P.fx.gaze?.enabled ? 'sí' : 'no'} · Luz auto: ${P.fx.light?.auto ? 'sí' : 'no'} · Look: ${P.color.preset} · Zoom dinámico: ${P.layout.dynamicZoom ? 'sí' : 'no'} · Titular: ${P.headline.text ? `«${P.headline.text}» (${P.headline.overlay})` : 'no'}`,
    P.scriptText?.trim() ? `Guion: ${splitWords(P.scriptText).length} palabras` : 'Guion: no',
  ].join('\n');
}

/** Transcripción por frases con tiempos [m:ss] del video actual (o el guion si no hay subtítulos). */
export function transcriptText(P, { from = 0, to = Infinity, maxWords = 1400 } = {}) {
  const tl = buildSegments(P);
  let cues = [];
  try {
    cues = captionCues(tl, buildCaptionIndex(P));
  } catch {
    cues = [];
  }
  if (!cues.length) {
    const s = (P.scriptText || '').trim();
    if (!s) return '(sin subtítulos ni guion: pide crear subtítulos con la operación subtitulos)';
    const words = splitWords(s);
    return `(guion sin tiempos; duración ${fmtTime(tl.total)})\n${words.slice(0, maxWords).join(' ')}${words.length > maxWords ? ' …' : ''}`;
  }
  const lines = [];
  let words = 0;
  let cur = null;
  for (const c of cues) {
    if (c.end < from || c.start > to) continue;
    // Une las frases cortas en líneas de ~12 palabras para ahorrar tokens.
    if (!cur) cur = { start: c.start, text: c.text };
    else cur.text += ` ${c.text}`;
    if (splitWords(cur.text).length >= 12 || /[.!?…]$/.test(c.text)) {
      lines.push(`[${fmtTime(cur.start)}] ${cur.text}`);
      words += splitWords(cur.text).length;
      cur = null;
      if (words >= maxWords) {
        lines.push('… (pide «transcripcion» con desde/hasta para ver el resto)');
        break;
      }
    }
  }
  if (cur && words < maxWords) lines.push(`[${fmtTime(cur.start)}] ${cur.text}`);
  return lines.join('\n');
}

// ---------- Validación ----------

const num = (v, d = null) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d = true) => (v === undefined || v === null ? d : v === true || v === 'true' || v === 1 || v === 'si' || v === 'sí');
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);

/** Normaliza y filtra operaciones; devuelve { ops, dropped }. */
export function validateOps(list, total = Infinity) {
  const ops = [];
  const dropped = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const o = { ...(raw?.args || {}), ...raw };
    delete o.args;
    const name = String(o.op || '').trim();
    const bad = (why) => dropped.push(`${name || '?'}: ${why}`);
    if (!OPS[name]) {
      bad('operación desconocida');
      continue;
    }
    const t = (k) => (o[k] === undefined ? undefined : clamp(num(o[k], 0), 0, Number.isFinite(total) ? total : 1e6));
    if ('desde' in o) o.desde = t('desde');
    if ('hasta' in o) o.hasta = t('hasta');
    if ('en' in o) o.en = t('en');
    if (['cortar', 'efecto', 'texto', 'emoji'].includes(name) && !(o.hasta > o.desde)) {
      bad('rango de tiempo inválido');
      continue;
    }
    if (name === 'transicion' && !TRANSITIONS[o.tipo]) {
      bad(`transición «${o.tipo}» no existe`);
      continue;
    }
    if (name === 'efecto' && !EFFECTS[o.tipo]) {
      bad(`efecto «${o.tipo}» no existe`);
      continue;
    }
    if (name === 'sonido' && ((!SFX_KINDS[o.tipo] && !MAT_CODE.test(o.tipo)) || o.en === undefined)) {
      bad(`sonido «${o.tipo}» no existe`);
      continue;
    }
    if (name === 'musica' && o.estilo && !MUSIC_STYLES[o.estilo]) o.estilo = 'calma';
    if (name === 'subtitulos' && o.estilo && !CAPTION_PRESETS[o.estilo]) delete o.estilo;
    if (name === 'color' && !LOOKS[o.look] && !MAT_CODE.test(o.lut)) {
      bad(`look «${o.look}» no existe`);
      continue;
    }
    if (name === 'material' && (!MAT_CODE.test(o.codigo) || !(o.hasta > o.desde))) {
      bad('falta el código del Material o el rango');
      continue;
    }
    if (name === 'formato' && !ASPECTS.includes(o.aspecto)) {
      bad('aspecto inválido');
      continue;
    }
    if (['texto', 'titular'].includes(name) && !String(o.texto || '').trim() && o.modo !== 'ninguno') {
      bad('falta el texto');
      continue;
    }
    if (name === 'stock' && !String(o.buscar || '').trim()) {
      bad('falta qué buscar');
      continue;
    }
    if (name === 'stock' && o.uso !== 'fondo' && !(o.hasta > o.desde)) {
      o.desde ??= 0;
      o.hasta = Math.min(Number.isFinite(total) ? total : o.desde + 3, o.desde + 3);
    }
    if (name === 'imagen' && !String(o.prompt || '').trim()) {
      bad('falta la descripción de la imagen');
      continue;
    }
    if (name === 'imagen' && o.uso === 'broll' && !(o.hasta > o.desde)) {
      o.desde ??= 0;
      o.hasta = Math.min(Number.isFinite(total) ? total : o.desde + 3, o.desde + 3);
    }
    o.op = name;
    ops.push(o);
  }
  return { ops, dropped };
}

/** Descripción en español para mostrar el plan antes de aplicarlo. */
export function describeOp(o) {
  const r = (a, b) => `${fmtTime(a)}–${fmtTime(b)}`;
  const label = (map, k) => map[k]?.label || k;
  switch (o.op) {
    case 'quitar_silencios': return 'Quitar los silencios largos';
    case 'quitar_muletillas': return 'Quitar muletillas (eh, este, o sea…)';
    case 'cortar': return `Cortar ${r(o.desde, o.hasta)}`;
    case 'subtitulos': return bool(o.activar) ? `Subtítulos${o.estilo ? ` estilo «${label(CAPTION_PRESETS, o.estilo)}»` : ''}${o.posicion ? `, ${o.posicion}` : ''}` : 'Ocultar subtítulos';
    case 'palabras_clave': return bool(o.activar) ? `Resaltar palabras clave${o.palabras?.length ? `: ${o.palabras.slice(0, 6).join(', ')}` : ''}` : 'Quitar palabras clave';
    case 'emojis': return bool(o.activar) ? 'Emojis automáticos en subtítulos' : 'Quitar emojis de subtítulos';
    case 'zoom_dinamico': return bool(o.activar) ? 'Zoom leve alternado en los cortes' : 'Sin zoom en los cortes';
    case 'transicion': return `Transición «${label(TRANSITIONS, o.tipo)}» ${o.donde === 'primero' ? 'en el primer corte' : Number.isFinite(Number(o.donde)) ? `en el corte de ${fmtTime(Number(o.donde))}` : 'en todos los cortes'}`;
    case 'efecto': return `Efecto «${label(EFFECTS, o.tipo)}» ${r(o.desde, o.hasta)}`;
    case 'musica': if (o.archivo) return `Música del Material (${o.archivo}) al ${Math.round(clamp(num(o.volumen, 0.3), 0, 1) * 100)}%, baja bajo la voz`;
      return o.quitar ? 'Quitar la música' : `Música «${label(MUSIC_STYLES, o.estilo || 'calma')}» al ${Math.round(clamp(num(o.volumen, 0.12), 0, 1) * 100)}%`;
    case 'sonidos_cortes': return bool(o.activar) ? 'Sonidos suaves en los cortes' : 'Quitar sonidos de los cortes';
    case 'sonido': return `Sonido «${MAT_CODE.test(o.tipo) ? `Material ${o.tipo}` : label(SFX_KINDS, o.tipo)}» en ${fmtTime(o.en)}`;
    case 'material': return `${/^o/i.test(o.codigo) ? 'Overlay de luz' : /^e/i.test(o.codigo) ? 'Sticker 3D' : 'Footage'} del Material (${o.codigo}) ${r(o.desde, o.hasta)}`;
    case 'texto': return `Texto «${String(o.texto).slice(0, 40)}» ${r(o.desde, o.hasta)}`;
    case 'emoji': return `Emoji ${o.emoji} ${r(o.desde, o.hasta)}`;
    case 'titular': return o.modo === 'ninguno' ? 'Quitar el titular' : `Titular «${String(o.texto).slice(0, 40)}»${o.modo === 'siempre' ? ' (siempre visible)' : ' (al inicio)'}`;
    case 'nombre_en_pantalla': return bool(o.activar) ? `Tu nombre en pantalla${o.nombre ? `: ${o.nombre}` : ''}` : 'Quitar tu nombre en pantalla';
    case 'color': return [o.look && LOOKS[o.look] ? `Look «${label(LOOKS, o.look)}»` : '', o.lut ? `LUT ${o.lut} al ${Math.round(clamp(num(o.intensidad, 0.8), 0, 1) * 100)}%` : ''].filter(Boolean).join(' + ');
    case 'luz': return `Mejorar la luz (${Math.round(clamp(num(o.intensidad, 0.5), 0, 1) * 100)}%)`;
    case 'fondo': return o.modo === 'ninguno' ? 'Fondo original' : `Fondo: ${o.modo}${o.escena ? ` «${label(SCENES, o.escena)}»` : ''}${o.degradado ? ` «${label(BG_GRADIENTS, o.degradado)}»` : ''}`;
    case 'mirada': return bool(o.activar) ? 'Corregir la mirada hacia la cámara (IA)' : 'Sin corrección de mirada';
    case 'formato': return `Formato ${o.aspecto}`;
    case 'encuadre': return `Encuadre ${Math.round(clamp(num(o.zoom, 1), 0.7, 1.3) * 100)}%`;
    case 'velocidad': return `Velocidad ${clamp(num(o.factor, 1), 0.8, 1.5)}×`;
    case 'stock': return `Imagen libre de internet (${o.uso || 'broll'}${o.uso !== 'fondo' ? ` ${r(o.desde, o.hasta)}` : ''}): «${String(o.buscar).slice(0, 50)}»`;
    case 'imagen': return `Crear imagen con IA local (${o.uso || 'biblioteca'}${o.uso === 'broll' ? ` ${r(o.desde, o.hasta)}` : ''}): «${String(o.prompt).slice(0, 60)}»`;
    case 'portada': return `Portada${o.tiempo !== undefined ? ` en ${fmtTime(num(o.tiempo, 0))}` : ''}${o.texto ? ` con «${o.texto}»` : ''}`;
    case 'intro': return bool(o.activar) ? `Intro${o.texto ? ` «${o.texto}»` : ''}` : 'Sin intro';
    case 'cierre': return bool(o.activar) ? `Cierre${o.texto ? ` «${o.texto}»` : ''}` : 'Sin cierre';
    case 'publicacion': return `Título, descripción y hashtags para publicar`;
    default: return o.op;
  }
}

// ---------- Aplicación ----------

const segKey = (seg) => `${seg.clip}@${seg.src0.toFixed(2)}`;

/** Lleva un instante del video original (tl0) al video ya cortado (tl1). */
export function remapTime(tl0, tl1, t) {
  const s = tlToSrc(tl0, t);
  if (!s) return clamp(t, 0, tl1.total);
  const t1 = srcToTl(tl1, s.clip, s.src);
  if (t1 != null) return t1;
  // El instante quedó dentro de un corte: se usa el siguiente tramo conservado de la misma toma.
  const next = tl1.segs.find((g) => g.type === 'video' && g.clip === s.clip && g.src0 >= s.src);
  if (next) return next.tlStart;
  const prev = [...tl1.segs].reverse().find((g) => g.type === 'video' && g.clip <= s.clip);
  return prev ? prev.tlStart + prev.dur : tl1.total;
}

/** Corta un rango del video original (tl0) convirtiéndolo en cortes por toma. */
function cutOriginal(P, tl0, t0, t1) {
  let n = 0;
  for (const seg of tl0.segs) {
    if (seg.type !== 'video') continue;
    const a = Math.max(t0, seg.tlStart);
    const b = Math.min(t1, seg.tlStart + seg.dur);
    if (b - a < 0.01) continue;
    cutSource(P, seg.clip, seg.src0 + (a - seg.tlStart) * tl0.speed, seg.src0 + (b - seg.tlStart) * tl0.speed);
    n++;
  }
  return n;
}

function markKeywords(P, on, words) {
  const want = new Set((words || []).map(normalizeWord).filter(Boolean));
  for (const [, e] of buildCaptionIndex(P)) {
    const kw = on ? (want.size ? new Set(e.words.map((w, i) => (want.has(normalizeWord(w.text)) ? i : -1)).filter((i) => i >= 0)) : pickKeywords(e.words, STOP)) : new Set();
    e.words.forEach((w, i) => {
      if (kw.has(i)) w.kw = true;
      else delete w.kw;
    });
  }
  P.captions.keywords = on;
}

function markEmojis(P, on) {
  for (const [, e] of buildCaptionIndex(P)) {
    const m = on ? autoEmojis(e.words, e.groups, 2) : new Map();
    e.words.forEach((w, i) => {
      if (m.has(i)) w.emoji = m.get(i);
      else delete w.emoji;
    });
  }
  P.captions.emojis = on;
}

/**
 * Aplica operaciones validadas. ctx: { project, brand?, analysis?, ensureAnalysis?, captionsFromText?,
 * captionsFromAI?, makeMusic?, generateImage?(prompt, aspect) → media, lightMetrics?() → metrics, autoGrade? }.
 * Primero lo que cambia la estructura (cortes) y después lo que se ubica en el tiempo, con los tiempos
 * re-mapeados al video ya cortado. Devuelve { done: [texto], failed: [texto], post }.
 */
export async function applyOps(ctx, ops, { onStep } = {}) {
  const P = ctx.project;
  const done = [];
  const failed = [];
  let post = null;
  const tl0 = buildSegments(P);
  const structural = ops.filter((o) => OPS[o.op]?.structural);
  const rest = ops.filter((o) => !OPS[o.op]?.structural);
  const step = async (o, fn) => {
    onStep?.(describeOp(o));
    try {
      const r = await fn();
      done.push(r || describeOp(o));
    } catch (e) {
      failed.push(`${describeOp(o)}: ${e.message}`);
    }
  };

  // 1) Estructura: silencios, muletillas y cortes (todos con tiempos del video original).
  for (const o of structural) {
    await step(o, async () => {
      if (o.op === 'cortar') {
        if (!cutOriginal(P, tl0, o.desde, o.hasta)) throw new Error('el rango no tiene video');
        return;
      }
      if (o.op === 'quitar_silencios') {
        await ctx.ensureAnalysis?.();
        let n = 0;
        let sec = 0;
        P.clips.forEach((c) => {
          const a = ctx.analysis?.[c.mediaId];
          if (!a?.regions) return;
          const cuts = silenceCuts(findSilences(a.regions, c.duration, clamp(num(o.min, 0.55), 0.3, 3)), c.duration, 0.12);
          n += cuts.length;
          sec += cuts.reduce((s, x) => s + (x.end - x.start), 0);
          c.cuts = mergeCuts([...(c.cuts || []), ...cuts]);
        });
        if (!n) return 'No había silencios largos';
        return `${n} silencios quitados (${sec.toFixed(1)} s)`;
      }
      if (o.op === 'quitar_muletillas') {
        if (P.captions.source !== 'ia') {
          if (!ctx.captionsFromAI) throw new Error('necesita la transcripción de tu voz');
          await ctx.captionsFromAI();
        }
        const drop = new Set();
        let n = 0;
        for (const [clip, e] of buildCaptionIndex(P)) {
          for (const f of findFillers(e.words)) {
            cutSource(P, clip, Math.max(0, e.words[f.from].t0 - 0.03), e.words[f.to].t1 + 0.03);
            e.words.slice(f.from, f.to + 1).forEach((w) => drop.add(w));
            n++;
          }
        }
        P.captions.words = P.captions.words.filter((w) => !drop.has(w));
        return n ? `${n} muletillas cortadas` : 'No encontré muletillas';
      }
      return null;
    });
  }
  const tl1 = buildSegments(P);
  const moved = structural.length && done.length;
  const at = (t) => (moved ? remapTime(tl0, tl1, t) : clamp(t, 0, tl1.total));
  if (moved) {
    // Capas, efectos y sonidos que ya existían se corren junto con el video.
    for (const key of ['overlays', 'effects', 'audioClips']) {
      for (const it of P[key] || []) {
        it.start = at(it.start);
        it.end = Math.max(it.start + 0.1, at(it.end));
      }
    }
    for (const s of P.audio.sfx || []) s.t = at(s.t);
    for (const m of P.markers || []) m.t = at(m.t);
  }

  // 2) Todo lo demás, con tiempos del video original llevados al video cortado.
  for (const o of rest) {
    await step(o, async () => {
      switch (o.op) {
        case 'subtitulos': {
          const on = bool(o.activar);
          if (on && !P.captions.words.length) {
            if ((P.scriptText || '').trim() && ctx.captionsFromText) await ctx.captionsFromText(P.scriptText, 'guion');
            else if (ctx.captionsFromAI) await ctx.captionsFromAI();
            else throw new Error('no hay guion ni transcripción');
          }
          if (o.estilo) P.captions.style = presetStyle(o.estilo, { kwColor: P.captions.style.kwColor });
          if (o.posicion && POS_Y[o.posicion]) P.captions.style.posY = POS_Y[o.posicion];
          if (o.mayusculas !== undefined) P.captions.style.upper = bool(o.mayusculas);
          if (num(o.palabras)) P.captions.style.maxWords = clamp(Math.round(num(o.palabras)), 1, 6);
          P.captions.enabled = on;
          return null;
        }
        case 'palabras_clave':
          if (!P.captions.words.length) throw new Error('primero crea los subtítulos');
          markKeywords(P, bool(o.activar), o.palabras);
          if (hex(o.color)) P.captions.style.kwColor = o.color;
          return null;
        case 'emojis':
          if (!P.captions.words.length) throw new Error('primero crea los subtítulos');
          markEmojis(P, bool(o.activar));
          return null;
        case 'zoom_dinamico':
          P.layout.dynamicZoom = bool(o.activar);
          if (P.layout.dynamicZoom) P.layout.transition = 'none';
          return null;
        case 'transicion': {
          P.transitions ||= {};
          const cutsList = tl1.segs.filter((s) => s.type === 'video' && s.vi > 0 && !s.cont);
          if (!cutsList.length) throw new Error('el video no tiene cortes');
          let targets = cutsList;
          if (o.donde === 'primero') targets = cutsList.slice(0, 1);
          else if (Number.isFinite(Number(o.donde))) {
            const t = at(Number(o.donde));
            targets = [cutsList.reduce((b, s) => (Math.abs(s.tlStart - t) < Math.abs(b.tlStart - t) ? s : b))];
          }
          const dur = clamp(num(o.duracion, TRANSITIONS[o.tipo].dur || 0.4), 0.1, 1.2);
          for (const s of targets) {
            if (o.tipo === 'none') delete P.transitions[segKey(s)];
            else P.transitions[segKey(s)] = { kind: o.tipo, dur };
          }
          return `${describeOp(o)} (${targets.length})`;
        }
        case 'efecto':
          (P.effects ||= []).push({ id: uid('f_'), kind: o.tipo, start: at(o.desde), end: Math.max(at(o.desde) + 0.2, at(o.hasta)), amount: clamp(num(o.intensidad, 0.7), 0.1, 1) });
          return null;
        case 'musica':
          if (o.quitar) {
            Object.assign(P.audio, { musicId: null, musicName: '' });
            return null;
          }
          if (o.archivo) {
            const it = await matItem(ctx, o.archivo, 'music');
            const media = await ctx.importMaterial(it);
            Object.assign(P.audio, { musicId: media.id, musicName: it.nombre, musicVol: clamp(num(o.volumen, 0.3), 0.02, 1), musicOffset: 0, duck: true, fade: true });
            return credit(P, it, `Música «${it.nombre}»`);
          }
          if (!ctx.makeMusic) throw new Error('no disponible aquí');
          {
            const rec = await ctx.makeMusic(o.estilo || 'calma', tl1.total + 3, Math.floor(Math.random() * 1000));
            Object.assign(P.audio, { musicId: rec.id, musicName: rec.name, musicVol: clamp(num(o.volumen, 0.12), 0.02, 1), duck: true, fade: true });
          }
          return null;
        case 'sonidos_cortes': {
          // Los sonidos que puso el usuario a mano se conservan; los automáticos se rehacen.
          const manual = (P.audio.sfx || []).filter((s) => !s.auto);
          const auto = bool(o.activar) ? autoSfx(tl1).map((s) => ({ ...s, auto: true })) : [];
          P.audio.sfx = [...manual, ...auto].sort((a, b) => a.t - b.t);
          P.audio.sfxOn = true;
          return bool(o.activar) ? `${auto.length} sonidos suaves en los cortes` : null;
        }
        case 'sonido': {
          const kind = MAT_CODE.test(o.tipo) ? `mat:${(await matItem(ctx, o.tipo, 'sfx')).ruta}` : o.tipo;
          (P.audio.sfx ||= []).push({ t: +at(o.en).toFixed(2), kind, vol: clamp(num(o.volumen, 0.6), 0.05, 1) });
          P.audio.sfxOn = true;
          return null;
        }
        case 'material': {
          const it = await matItem(ctx, o.codigo, ['footage', 'overlays', 'graficos']);
          const media = await ctx.importMaterial(it);
          const s = at(o.desde);
          if (it.categoria === 'graficos') {
            (P.overlays ||= []).push({
              id: uid('o_'), kind: 'broll', mediaId: media.id, mediaKind: 'image', layout: 'free', anim: 'pop', name: it.nombre,
              start: s, end: Math.max(s + 0.6, at(o.hasta)), x: clamp(num(o.x, 0.78), 0.1, 0.9), y: clamp(num(o.y, 0.22), 0.1, 0.9), w: 0.28,
            });
            return credit(P, it, `Sticker «${it.nombre}»`);
          }
          const isOver = it.categoria === 'overlays';
          (P.overlays ||= []).push({
            id: uid('o_'), kind: 'broll', mediaId: media.id, mediaKind: 'video', layout: 'full', anim: 'fade', name: it.nombre,
            start: s, end: Math.max(s + 0.6, at(o.hasta)), x: 0.5, y: 0.3, ...(isOver ? { blend: it.mezcla || 'screen', opacity: it.mezcla === 'overlay' ? 0.6 : 0.85 } : {}),
          });
          return credit(P, it, `${isOver ? 'Overlay' : 'Footage'} «${it.nombre}»`);
        }
        case 'texto': {
          const s = at(o.desde);
          (P.overlays ||= []).push({
            id: uid('o_'), kind: 'text', text: String(o.texto).slice(0, 120), start: s, end: Math.max(s + 0.4, at(o.hasta)),
            x: 0.5, y: POS_Y[o.posicion] ?? 0.3, size: clamp(num(o.tamano, 7), 4, 16), color: hex(o.color) || '#FFFFFF',
            box: o.caja !== false, boxColor: ctx.brand?.primary || '#000000', boxOpacity: 0.85, font: 'impact', upper: true, anim: 'pop',
          });
          return null;
        }
        case 'emoji': {
          const s = at(o.desde);
          (P.overlays ||= []).push({ id: uid('o_'), kind: 'sticker', emoji: String(o.emoji).slice(0, 8), size: 16, x: 0.78, y: 0.2, start: s, end: Math.max(s + 0.4, at(o.hasta)), anim: 'pop' });
          return null;
        }
        case 'titular':
          if (o.modo === 'ninguno') P.headline.overlay = 'none';
          else Object.assign(P.headline, { text: String(o.texto).slice(0, 90), overlay: o.modo === 'siempre' ? 'always' : 'start' });
          return null;
        case 'nombre_en_pantalla': {
          const lt = P.brand.lowerThird;
          lt.enabled = bool(o.activar);
          if (o.nombre) lt.name = String(o.nombre).slice(0, 40);
          if (o.rol) lt.role = String(o.rol).slice(0, 60);
          if (lt.enabled && !lt.name && !ctx.brand?.name) throw new Error('falta tu nombre (Mi marca)');
          return null;
        }
        case 'color':
          if (o.look && LOOKS[o.look]) P.color.preset = o.look;
          if (o.lut) {
            const it = await matItem(ctx, o.lut, 'luts');
            Object.assign(P.color, { lut: it.ruta, lutName: it.nombre, lutAmt: clamp(num(o.intensidad, 0.8), 0, 1) });
          }
          return null;
        case 'luz': {
          if (!ctx.lightMetrics || !ctx.autoGrade) throw new Error('no disponible aquí');
          const m = await ctx.lightMetrics();
          if (!m) throw new Error('no pude medir la luz');
          const g = ctx.autoGrade(m);
          const k = clamp(num(o.intensidad, 0.5), 0, 1);
          Object.assign(P.fx.light, {
            auto: true, exposure: +(g.exposure * k).toFixed(2), contrast: +(1 + (g.contrast - 1) * k).toFixed(3), saturation: +(1 + (g.saturation - 1) * k).toFixed(3),
            temp: +(g.temp * k).toFixed(2), tint: +(g.tint * k).toFixed(2), faceBoost: +(g.faceBoost * k).toFixed(2), vignette: 0,
          });
          return null;
        }
        case 'fondo': {
          const bg = P.fx.bg;
          if (o.modo === 'ninguno') bg.mode = 'none';
          else if (o.modo === 'desenfoque') bg.mode = 'blur';
          else if (o.modo === 'escena') Object.assign(bg, { mode: 'scene', scene: SCENES[o.escena] ? o.escena : 'calido' });
          else if (o.modo === 'degradado') Object.assign(bg, { mode: 'gradient', gradient: BG_GRADIENTS[o.degradado] ? o.degradado : 'calma' });
          else throw new Error('modo de fondo inválido');
          return null;
        }
        case 'mirada':
          P.fx.gaze.enabled = bool(o.activar);
          if (num(o.intensidad) != null) P.fx.gaze.strength = clamp(num(o.intensidad), 0.2, 1);
          return null;
        case 'formato':
          P.layout.aspect = o.aspecto;
          return null;
        case 'encuadre':
          P.layout.zoom = clamp(num(o.zoom, 1), 0.7, 1.3);
          return null;
        case 'velocidad':
          P.speed = clamp(num(o.factor, 1), 0.8, 1.5);
          return null;
        case 'stock': {
          if (!ctx.stockImage) throw new Error('las imágenes de internet solo están en el PC');
          const media = await ctx.stockImage(String(o.buscar));
          if (o.uso === 'fondo') Object.assign(P.fx.bg, { mode: 'image', imageId: media.id });
          else {
            const s = at(o.desde ?? 0);
            (P.overlays ||= []).push({ id: uid('o_'), kind: 'broll', mediaId: media.id, mediaKind: 'image', layout: 'full', anim: 'fade', name: media.name, start: s, end: Math.max(s + 1, at(o.hasta ?? (o.desde ?? 0) + 3)), x: 0.5, y: 0.3 });
          }
          return `Imagen libre agregada: ${media.name}${media.credit ? ` (${media.credit})` : ''}`;
        }
        case 'imagen': {
          if (!ctx.generateImage) throw new Error('el motor de imágenes solo está en el PC');
          const uso = o.uso || 'biblioteca';
          const aspect = uso === 'fondo' || uso === 'broll' ? P.layout.aspect : '9:16';
          const media = await ctx.generateImage(String(o.prompt), aspect);
          if (uso === 'fondo') Object.assign(P.fx.bg, { mode: 'image', imageId: media.id });
          else if (uso === 'broll') {
            const s = at(o.desde ?? 0);
            (P.overlays ||= []).push({ id: uid('o_'), kind: 'broll', mediaId: media.id, mediaKind: 'image', layout: 'full', anim: 'fade', name: media.name, start: s, end: Math.max(s + 1, at(o.hasta ?? (o.desde ?? 0) + 3)), x: 0.5, y: 0.3 });
          }
          return `Imagen creada (${uso})`;
        }
        case 'portada':
          if (o.tiempo !== undefined) P.cover.time = at(num(o.tiempo, 0));
          if (o.texto !== undefined) P.cover.text = String(o.texto).slice(0, 80);
          return null;
        case 'intro':
        case 'cierre': {
          const key = o.op === 'intro' ? 'intro' : 'outro';
          P[key].enabled = bool(o.activar);
          if (o.texto) P[key].text = String(o.texto).slice(0, 80);
          return null;
        }
        case 'publicacion':
          post = { titulo: String(o.titulo || ''), descripcion: String(o.descripcion || ''), hashtags: Array.isArray(o.hashtags) ? o.hashtags.join(' ') : String(o.hashtags || '') };
          P.post = post;
          return null;
        default:
          throw new Error('operación no implementada');
      }
    });
  }
  return { done, failed, post };
}

/** Busca un ítem del Material por código y valida su categoría. */
async function matItem(ctx, code, cats) {
  const items = (await ctx.material?.()) || [];
  const it = items.find((x) => x.code === String(code).toLowerCase());
  if (!it) throw new Error(`el código «${code}» no está en el Material de este PC`);
  if (![].concat(cats).includes(it.categoria)) throw new Error(`«${code}» no es del tipo correcto`);
  if (!ctx.importMaterial) throw new Error('el Material solo está en el programa de PC');
  return it;
}

/** Guarda el crédito obligatorio (CC-BY) para la descripción del video. */
function credit(P, it, msg) {
  if (!it.atribucion) return msg;
  P.credits ||= [];
  if (!P.credits.includes(it.atribucion)) P.credits.push(it.atribucion);
  return `${msg} · crédito obligatorio guardado para la descripción`;
}

/** Instrucciones fijas del asistente (cortas para aprovechar la caché y gastar pocos tokens). */
export const EDITOR_SYSTEM = [
  'Eres el editor de video de Psico Influencer: conviertes el pedido en un plan de operaciones que la app ejecuta.',
  'Videos para redes (Reels, TikTok, Shorts, YouTube) de divulgación en salud mental y de música, en español de Chile.',
  'Si el audio es «instrumento» (video de música): nada de música de fondo ni sonidos sobre la interpretación; carteles de acordes/escalas/técnica con caja, breves y fuera de las manos.',
  'Para fotos reales usa «stock» (imágenes libres de internet, búsqueda corta en inglés); «imagen» crea ilustraciones con IA local (lenta). No pidas logos, marcas, personas famosas ni clips de juegos.',
  'Reglas: usa solo las operaciones y recursos del catálogo; tiempos en segundos del video actual (los de la transcripción);',
  'propón lo justo y de buen gusto (sonidos y efectos con moderación: whoosh-aire en cambios de escena, impacto-cine/boom-meme/golpe-seco en remates, pop-burbuja o click-suave en textos, ding-cristal/notificacion/moneda-brillo en acentos; volumen 0.3-0.6; no tapes la cara con textos); no inventes datos.',
  'Si te piden algo imposible, explícalo en «resumen» y usa ops vacías. Responde solo con el JSON pedido.',
].join(' ');

/** Mensaje de usuario compacto para pedir un plan. */
export function planPrompt(P, request, { extra = '', previous = '' } = {}) {
  return [
    opsCatalog(),
    '',
    projectSummary(P),
    extra,
    'TRANSCRIPCIÓN:',
    transcriptText(P, { maxWords: 900 }),
    previous ? `\nPEDIDO ANTERIOR (ya aplicado): ${previous}` : '',
    `\nPEDIDO: ${request}`,
  ].filter((x) => x !== '').join('\n');
}
