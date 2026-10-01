// Modelo de línea de tiempo: tomas (clips) con cortes en tiempo de origen,
// más tarjetas de intro/outro. Todo puro para poder probarlo en Node.

export const MIN_SEG = 0.05;

/** Rangos conservados de un clip en tiempo de origen, tras aplicar recorte (in/out) y cortes. */
export function keptRanges(clip) {
  let ranges = [[clip.in ?? 0, clip.out ?? clip.duration]];
  const cuts = [...(clip.cuts || [])].sort((a, b) => a.start - b.start);
  for (const c of cuts) {
    const next = [];
    for (const [a, b] of ranges) {
      if (c.end <= a || c.start >= b) {
        next.push([a, b]);
        continue;
      }
      if (c.start > a) next.push([a, c.start]);
      if (c.end < b) next.push([c.end, b]);
    }
    ranges = next;
  }
  // Divisiones («cuchilla»): parten un rango en dos tramos contiguos, que se pueden mover, borrar o transicionar por separado.
  for (const sp of clip.splits || []) {
    ranges = ranges.flatMap(([a, b]) => (sp - a >= MIN_SEG && b - sp >= MIN_SEG ? [[a, sp], [sp, b]] : [[a, b]]));
  }
  return ranges.filter(([a, b]) => b - a >= MIN_SEG);
}

export function buildSegments(project) {
  const speed = project.speed || 1;
  const segs = [];
  let t = 0;
  const intro = project.intro;
  if (intro?.enabled && intro.duration > 0) {
    segs.push({ type: 'card', card: 'intro', tlStart: 0, dur: intro.duration });
    t += intro.duration;
  }
  const videoStart = t;
  let vi = 0;
  (project.clips || []).forEach((clip, ci) => {
    for (const [a, b] of keptRanges(clip)) {
      const dur = (b - a) / speed;
      const prev = segs[segs.length - 1];
      const cont = !!prev && prev.type === 'video' && prev.clip === ci && Math.abs(prev.src1 - a) < 1e-3; // continúa sin salto
      segs.push({ type: 'video', clip: ci, src0: a, src1: b, tlStart: t, dur, vi: vi++, cont });
      t += dur;
    }
  });
  const videoEnd = t;
  const outro = project.outro;
  if (outro?.enabled && outro.duration > 0) {
    segs.push({ type: 'card', card: 'outro', tlStart: t, dur: outro.duration });
    t += outro.duration;
  }
  return { segs, total: t, speed, videoStart, videoEnd };
}

/** Segmento que contiene el instante t (el último si t >= total). */
export function locate(tl, t) {
  const { segs } = tl;
  if (!segs.length) return { i: -1, seg: null, local: 0 };
  let lo = 0;
  let hi = segs.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].tlStart <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const seg = segs[found];
  const local = Math.min(Math.max(0, t - seg.tlStart), seg.dur);
  return { i: found, seg, local };
}

export function tlToSrc(tl, t) {
  const { seg, local } = locate(tl, t);
  if (!seg || seg.type !== 'video') return null;
  return { clip: seg.clip, src: seg.src0 + local * tl.speed, seg };
}

export function srcToTl(tl, clip, src) {
  for (const seg of tl.segs) {
    if (seg.type === 'video' && seg.clip === clip && src >= seg.src0 - 1e-6 && src <= seg.src1 + 1e-6) {
      return seg.tlStart + (src - seg.src0) / tl.speed;
    }
  }
  return null;
}

export function mergeCuts(cuts) {
  const sorted = [...cuts].filter((c) => c.end - c.start > 1e-4).sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end);
    else out.push({ start: c.start, end: c.end });
  }
  return out;
}

/** Elimina el rango [t0, t1] de la línea de tiempo final, convirtiéndolo en cortes por clip. */
export function cutRange(project, t0, t1) {
  if (t1 < t0) [t0, t1] = [t1, t0];
  const tl = buildSegments(project);
  let changed = false;
  for (const seg of tl.segs) {
    if (seg.type !== 'video') continue;
    const a = Math.max(t0, seg.tlStart);
    const b = Math.min(t1, seg.tlStart + seg.dur);
    if (b - a < 0.01) continue;
    const clip = project.clips[seg.clip];
    const srcA = seg.src0 + (a - seg.tlStart) * tl.speed;
    const srcB = seg.src0 + (b - seg.tlStart) * tl.speed;
    clip.cuts = mergeCuts([...(clip.cuts || []), { start: srcA, end: srcB }]);
    changed = true;
  }
  return changed;
}

export function trimBefore(project, t) {
  const tl = buildSegments(project);
  return cutRange(project, tl.videoStart, Math.min(t, tl.videoEnd));
}

export function trimAfter(project, t) {
  const tl = buildSegments(project);
  return cutRange(project, Math.max(t, tl.videoStart), tl.videoEnd);
}

/** Corta en origen un rango de un clip concreto (p. ej. una frase de los subtítulos). */
export function cutSource(project, clipIdx, start, end) {
  const clip = project.clips[clipIdx];
  if (!clip || end - start < 0.01) return false;
  clip.cuts = mergeCuts([...(clip.cuts || []), { start, end }]);
  return true;
}

export function clearCuts(project) {
  for (const c of project.clips) c.cuts = [];
}

export function listCuts(project) {
  const out = [];
  project.clips.forEach((clip, ci) => (clip.cuts || []).forEach((c, k) => out.push({ clip: ci, index: k, ...c })));
  return out;
}

export function removeCut(project, clipIdx, cutIdx) {
  const clip = project.clips[clipIdx];
  if (!clip) return;
  clip.cuts = clip.cuts.filter((_, k) => k !== cutIdx);
}

/** Divide el tramo bajo el instante t de la línea de tiempo (no borra nada). */
export function splitAt(project, t) {
  const tl = buildSegments(project);
  const src = tlToSrc(tl, t);
  if (!src) return false;
  const clip = project.clips[src.clip];
  if (src.src - src.seg.src0 < MIN_SEG || src.seg.src1 - src.src < MIN_SEG) return false;
  clip.splits = [...(clip.splits || []), +src.src.toFixed(3)].sort((a, b) => a - b);
  return true;
}

/** Une una división: quita la división que empieza el tramo `seg` (si existe). */
export function removeSplit(project, seg) {
  const clip = project.clips[seg.clip];
  const before = (clip.splits || []).length;
  clip.splits = (clip.splits || []).filter((x) => Math.abs(x - seg.src0) > 1e-3);
  return clip.splits.length !== before;
}

/** Tras borrar [t0,t1] de la línea de tiempo, corre hacia atrás capas, efectos, sonidos y marcadores posteriores. */
export function rippleShift(project, t0, t1) {
  const d = t1 - t0;
  if (d <= 0) return;
  const mv = (v) => (v >= t1 ? v - d : v > t0 ? t0 : v);
  for (const key of ['overlays', 'effects', 'audioClips']) {
    if (!project[key]) continue;
    for (const it of project[key]) {
      it.start = mv(it.start);
      it.end = mv(it.end);
    }
    project[key] = project[key].filter((it) => it.end - it.start >= 0.1);
  }
  for (const s of project.audio?.sfx || []) s.t = mv(s.t);
  for (const m of project.markers || []) m.t = mv(m.t);
}
