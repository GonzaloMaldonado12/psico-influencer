// Subtítulos: alineación de palabras con la voz, agrupación, estilos y exportación SRT/VTT.
import { splitWords, countSyllables, round3 } from '../lib/util.js';

export const FONTS = {
  impact: { label: 'Impacto', family: 'Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif', weight: 900 },
  sans: { label: 'Moderna', family: '"Helvetica Neue", Helvetica, Arial, sans-serif', weight: 800 },
  rounded: { label: 'Redonda', family: '"Arial Rounded MT Bold", "Trebuchet MS", "Helvetica Neue", sans-serif', weight: 700 },
  condensed: { label: 'Condensada', family: '"Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif', weight: 800 },
  serif: { label: 'Elegante', family: 'Georgia, "Times New Roman", serif', weight: 700 },
  mono: { label: 'Máquina', family: '"Courier New", Courier, monospace', weight: 700 },
};

export const BASE_CAPTION_STYLE = {
  preset: 'karaoke',
  font: 'impact',
  sizePct: 8.5,
  color: '#FFFFFF',
  hlColor: '#FFD60A',
  hlMode: 'color', // none | color | box | underline
  strokeColor: '#000000',
  strokeW: 0.14,
  shadow: true,
  box: false,
  boxColor: '#000000',
  boxOpacity: 0.6,
  upper: true,
  mode: 'group', // group | word
  maxWords: 3,
  posY: 0.72,
  anim: 'pop', // none | pop | fade
};

export const CAPTION_PRESETS = {
  karaoke: { label: 'Karaoke' },
  clasico: {
    label: 'Clásico', font: 'sans', sizePct: 6.2, hlMode: 'none', strokeW: 0.1, upper: false,
    maxWords: 6, posY: 0.8, anim: 'none',
  },
  pop: {
    label: 'Palabra pop', mode: 'word', sizePct: 12, hlMode: 'none', strokeW: 0.16, posY: 0.62, anim: 'pop',
  },
  caja: {
    label: 'Caja', font: 'sans', sizePct: 6.6, box: true, boxColor: '#000000', boxOpacity: 0.72, hlMode: 'box',
    hlColor: '#FF2D55', strokeW: 0, shadow: false, upper: false, maxWords: 4, posY: 0.78, anim: 'none',
  },
  neon: {
    label: 'Neón', font: 'rounded', hlColor: '#00F5D4', strokeColor: '#7B2FF7', strokeW: 0.18, maxWords: 3,
  },
  minimal: {
    label: 'Minimal', font: 'serif', sizePct: 6, hlMode: 'underline', hlColor: '#FFFFFF', strokeW: 0, shadow: true,
    upper: false, maxWords: 5, posY: 0.82, anim: 'fade',
  },
  titular: {
    label: 'Titular', font: 'condensed', sizePct: 7.4, color: '#111111', hlColor: '#111111', hlMode: 'underline',
    box: true, boxColor: '#FFFFFF', boxOpacity: 0.95, strokeW: 0, shadow: false, upper: true, maxWords: 4, posY: 0.75,
    anim: 'pop',
  },
};

export function presetStyle(key, extra = {}) {
  const p = CAPTION_PRESETS[key] || {};
  const { label, ...rest } = p;
  return { ...BASE_CAPTION_STYLE, ...rest, ...extra, preset: key };
}

/**
 * Reparte palabras sobre las regiones con voz, en proporción a su peso silábico.
 * Cada palabra queda dentro de la región que contiene su centro (no cruza silencios).
 */
export function alignWords(words, regions, duration) {
  const list = words.map((w) => String(w).trim()).filter(Boolean);
  if (!list.length || !(duration > 0)) return [];
  let segs = (regions || [])
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(duration, r.end) }))
    .filter((r) => r.end - r.start > 0.05)
    .sort((a, b) => a.start - b.start);
  if (!segs.length) {
    const pad = Math.min(0.2, duration * 0.05);
    segs = [{ start: pad, end: duration - pad }];
  }
  const cum = [];
  let speechTotal = 0;
  for (const r of segs) {
    cum.push(speechTotal);
    speechTotal += r.end - r.start;
  }
  const toReal = (x) => {
    for (let i = segs.length - 1; i >= 0; i--) {
      if (x >= cum[i] - 1e-9) return { t: segs[i].start + Math.min(x - cum[i], segs[i].end - segs[i].start), r: i };
    }
    return { t: segs[0].start, r: 0 };
  };
  const weights = list.map((w) => countSyllables(w) + 0.35);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const out = [];
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    const a = (acc / totalW) * speechTotal;
    const b = ((acc + weights[i]) / totalW) * speechTotal;
    acc += weights[i];
    const A = toReal(a);
    const B = toReal(b - 1e-9);
    const mid = toReal((a + b) / 2);
    const reg = segs[mid.r];
    let t0 = A.r < mid.r ? reg.start : Math.max(A.t, reg.start);
    let t1 = B.r > mid.r ? reg.end : Math.min(B.t, reg.end);
    if (t1 - t0 < 0.06) t1 = Math.min(duration, t0 + 0.06);
    out.push({ text: list[i], t0, t1 });
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i].t0 < out[i - 1].t1) out[i].t0 = out[i - 1].t1;
    if (out[i].t1 < out[i].t0 + 0.04) out[i].t1 = out[i].t0 + 0.04;
  }
  return out.map((w) => ({ text: w.text, t0: round3(w.t0), t1: round3(w.t1) }));
}

/** Vuelve a repartir un texto editado dentro de [t0, t1]. */
export function retimeText(text, t0, t1) {
  return alignWords(splitWords(text), [{ start: t0, end: t1 }], t1).map((w) => ({
    ...w,
    t0: Math.max(t0, w.t0),
    t1: Math.min(t1, w.t1),
  }));
}

/** Frases (grupos) para mostrar en pantalla. `end` es cuándo deja de verse. */
export function groupWords(words, { maxWords = 4, maxChars = 26, maxDur = 2.8, gap = 0.6 } = {}) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const chars = cur ? cur.chars + 1 + w.text.length : w.text.length;
    const breakHere =
      !cur ||
      cur.idx.length >= maxWords ||
      chars > maxChars ||
      (prev && w.t0 - prev.t1 > gap) ||
      (prev && /[.!?…]["'»”)]?$/.test(prev.text)) ||
      w.t1 - cur.t0 > maxDur ||
      (prev && /[,;:]$/.test(prev.text) && cur.idx.length >= Math.ceil(maxWords / 2));
    if (breakHere) {
      cur = { t0: w.t0, t1: w.t1, idx: [i], chars: w.text.length };
      groups.push(cur);
    } else {
      cur.idx.push(i);
      cur.t1 = w.t1;
      cur.chars = chars;
    }
  }
  for (let g = 0; g < groups.length; g++) {
    const next = groups[g + 1];
    groups[g].end = next ? Math.max(groups[g].t1, Math.min(next.t0, groups[g].t1 + 0.5)) : groups[g].t1 + 0.5;
  }
  return groups;
}

/** Índice por clip: palabras ordenadas y frases, según el estilo actual. */
export function buildCaptionIndex(project) {
  const index = new Map();
  const cap = project.captions;
  if (!cap || !cap.words?.length) return index;
  const st = cap.style || BASE_CAPTION_STYLE;
  const opts = st.mode === 'word' ? { maxWords: 1, maxChars: 99 } : { maxWords: st.maxWords, maxChars: Math.max(12, st.maxWords * 9) };
  const byClip = new Map();
  for (const w of cap.words) {
    if (!byClip.has(w.clip)) byClip.set(w.clip, []);
    byClip.get(w.clip).push(w);
  }
  for (const [clip, words] of byClip) {
    words.sort((a, b) => a.t0 - b.t0);
    index.set(clip, { words, groups: groupWords(words, opts) });
  }
  return index;
}

export function captionAt(index, clip, s) {
  const entry = index.get(clip);
  if (!entry) return null;
  const { groups, words } = entry;
  let lo = 0;
  let hi = groups.length - 1;
  let g = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid].t0 <= s) {
      g = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (g < 0 || s >= groups[g].end) return null;
  const group = groups[g];
  let activeLocal = -1;
  group.idx.forEach((wi, k) => {
    if (words[wi].t0 <= s) activeLocal = k;
  });
  return { group, groupIndex: g, words: group.idx.map((i) => words[i]), activeLocal };
}

/** Reparte las palabras de un guion entre varias tomas según los segundos de voz de cada una. */
export function distributeWords(words, speechSeconds) {
  const n = speechSeconds.length;
  if (n <= 1) return [words];
  const total = speechSeconds.reduce((a, b) => a + b, 0) || n;
  const weights = words.map((w) => countSyllables(w) + 0.35);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const out = Array.from({ length: n }, () => []);
  let acc = 0;
  let clip = 0;
  let limit = (speechSeconds[0] / total) * totalW;
  for (let i = 0; i < words.length; i++) {
    const center = acc + weights[i] / 2;
    while (clip < n - 1 && center > limit) {
      clip++;
      limit += (speechSeconds[clip] / total) * totalW;
    }
    out[clip].push(words[i]);
    acc += weights[i];
  }
  return out;
}

/** Transcripción aproximada capturada al grabar (frases con su instante final) → palabras. */
export function wordsFromHints(hints, regions, duration) {
  const words = [];
  let prevEnd = 0;
  for (const h of hints || []) {
    const end = Math.min(duration, Math.max(prevEnd + 0.3, h.t - 0.25));
    const phraseRegions = (regions || [])
      .map((r) => ({ start: Math.max(prevEnd, r.start), end: Math.min(end, r.end) }))
      .filter((r) => r.end - r.start > 0.05);
    const regs = phraseRegions.length ? phraseRegions : [{ start: prevEnd, end }];
    words.push(...alignWords(splitWords(h.text), regs, end));
    prevEnd = end;
  }
  return words;
}

// Muletillas frecuentes en español de Chile. Las ambiguas («este», «igual», «como que»)
// solo cuentan si van seguidas de pausa o coma.
const FILLER_SURE = new Set(['eh', 'ehh', 'eeh', 'eee', 'em', 'emm', 'ehm', 'mm', 'mmm', 'hmm', 'ah', 'ahh', 'aah', 'cachai', 'cachay', 'po', 'pos']);
const FILLER_PAUSED = new Set(['este', 'igual', 'bueno', 'onda']);
const FILLER_PAIRS = [['o', 'sea'], ['como', 'que']];

/**
 * Detecta muletillas en una lista de palabras con tiempos.
 * Devuelve [{ from, to, text }] (índices inclusivos).
 */
export function findFillers(words) {
  const norm = (w) => String(w?.text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ]/g, '');
  const pausedAfter = (i) => {
    const w = words[i];
    const next = words[i + 1];
    return /[,;.…]$/.test(w.text) || !next || next.t0 - w.t1 > 0.25;
  };
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const a = norm(words[i]);
    if (!a) continue;
    const pair = FILLER_PAIRS.find(([x, y]) => a === x && norm(words[i + 1]) === y);
    if (pair && (pair[0] === 'o' || pausedAfter(i + 1))) {
      out.push({ from: i, to: i + 1, text: `${words[i].text} ${words[i + 1].text}` });
      i++;
      continue;
    }
    if (FILLER_SURE.has(a) || /^e+h*$|^m+$|^e+m+$/.test(a) || (FILLER_PAUSED.has(a) && pausedAfter(i))) {
      out.push({ from: i, to: i, text: words[i].text });
    }
  }
  return out;
}

/** Palabras clave para resaltar (las más largas y significativas de cada frase). */
export function pickKeywords(words, stop = new Set()) {
  const keep = new Set();
  const groups = groupWords(words, { maxWords: 6, maxChars: 40 });
  for (const g of groups) {
    let best = -1;
    let bestLen = 5;
    for (const i of g.idx) {
      const n = words[i].text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');
      if (stop.has(n)) continue;
      // Se prefieren sustantivos y cifras: las terminaciones verbales típicas restan.
      const verbish = /(amos|emos|imos|ando|iendo|aron|ieron|aste|iste|aba|ian|ar|er|ir)$/.test(n) ? 3 : 0;
      const score = n.length + (/\d/.test(n) ? 4 : 0) - verbish;
      if (score > bestLen) {
        bestLen = score;
        best = i;
      }
    }
    if (best >= 0) keep.add(best);
  }
  return keep;
}

/** Cues finales (tiempo de la línea de tiempo) a partir de las frases visibles. */
export function captionCues(tl, index, upper = false) {
  const cues = [];
  for (const seg of tl.segs) {
    if (seg.type !== 'video') continue;
    const entry = index.get(seg.clip);
    if (!entry) continue;
    for (const g of entry.groups) {
      const a = Math.max(g.t0, seg.src0);
      const b = Math.min(g.end, seg.src1);
      if (b - a < 0.05) continue;
      let text = g.idx.map((i) => entry.words[i].text).join(' ');
      if (upper) text = text.toLocaleUpperCase('es');
      cues.push({
        start: seg.tlStart + (a - seg.src0) / tl.speed,
        end: seg.tlStart + (b - seg.src0) / tl.speed,
        text,
      });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const c of cues) {
    const last = merged[merged.length - 1];
    if (last && last.text === c.text && c.start - last.end < 0.06) last.end = c.end;
    else merged.push({ ...c });
  }
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].end > merged[i + 1].start) merged[i].end = merged[i + 1].start;
  }
  return merged;
}

function stamp(s, sep) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(sec)}${sep}${p(ms % 1000, 3)}`;
}

export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
}

export function toVTT(cues) {
  return 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n');
}
