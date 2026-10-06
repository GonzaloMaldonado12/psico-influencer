// Exportación profesional cuadro a cuadro con WebCodecs (Mediabunny):
// H.264 High + AAC 48 kHz, MP4 «fast start», fotogramas exactos (sin saltos),
// audio mezclado sin conexión y normalizado a -14 LUFS (estándar de redes).
import { loadGlTransitions, projectUsesGl } from './gl-transitions.js';
import { buildSegments, locate } from './timeline.js';
import { buildCaptionIndex } from './captions.js';
import { renderFrame } from './render.js';
import { FxPipeline, fxNeeds } from './effects.js';
import { decodeAudio } from './media.js';
import { normalizeLoudness, timeStretch } from './loudness.js';
import { isSpeechAt } from './audio-analysis.js';
import { clamp } from '../lib/util.js';
import { sfxBuffer, loadSfx } from './sfx.js';
import { loadProjectFonts } from './fonts.js';
import { db } from '../lib/db.js';

const MB_URL = new URL('../../vendor/mediabunny.min.mjs', import.meta.url).href;
let mbP = null;
const mb = () => (mbP ||= import(MB_URL));

let supportCache = null;
export async function proExportSupport() {
  if (supportCache) return supportCache;
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    return (supportCache = { ok: false, reason: 'Este navegador no tiene WebCodecs completo; se usará la exportación en tiempo real.' });
  }
  try {
    const M = await mb();
    const video = await M.canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 8e6 });
    const aac = await M.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 });
    const opus = aac ? false : await M.canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000, bitrate: 160000 });
    const ok = video && (aac || opus);
    supportCache = { ok, video, aac, opus, reason: ok ? '' : 'El codificador H.264/AAC no está disponible; se usará la exportación en tiempo real.' };
  } catch (e) {
    supportCache = { ok: false, reason: `No se pudo iniciar el exportador profesional: ${e.message}` };
  }
  return supportCache;
}

function avcCodecFor(w, h, fps) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
  // Perfil High (64) con el nivel mínimo que soporta el tamaño y la frecuencia.
  if (mbs <= 108000 && w * h <= 2097152) return 'avc1.640028'; // 4.0 (1080p30)
  if (mbs <= 216000) return 'avc1.64002A'; // 4.2
  if (mbs <= 983040 && w * h <= 8912896) return 'avc1.640033'; // 5.1 (4K30)
  return 'avc1.640034';
}

async function pickFullCodec(w, h, fps, bitrate) {
  const codec = avcCodecFor(w, h, fps);
  try {
    const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } });
    return r.supported ? codec : null;
  } catch {
    return null;
  }
}

function loadImg(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Mezcla completa del audio (voz + música) sin conexión. */
export async function mixAudio(project, tl, analysis, { sr = 48000, normalize = true, onProgress } = {}) {
  const A = project.audio;
  const len = Math.max(1, Math.ceil(tl.total * sr));
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(2, len, sr);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const voiceIn = ctx.createGain();
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = A.voiceVol;
  if (A.enhance) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85;
    const pres = ctx.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = 3200;
    pres.Q.value = 0.9;
    pres.gain.value = 3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.5;
    voiceIn.connect(hp);
    hp.connect(pres);
    pres.connect(comp);
    comp.connect(makeup);
    makeup.connect(voiceGain);
  } else voiceIn.connect(voiceGain);
  voiceGain.connect(master);

  const buffers = [];
  for (let ci = 0; ci < project.clips.length; ci++) {
    onProgress?.(ci / project.clips.length, 'Preparando el audio…');
    const rec = await db.get('media', project.clips[ci].mediaId);
    try {
      buffers.push(rec ? await decodeAudio(rec.blob) : null);
    } catch {
      buffers.push(null);
    }
  }
  const speed = tl.speed || 1;
  for (const seg of tl.segs) {
    if (seg.type !== 'video') continue;
    const buf = buffers[seg.clip];
    if (!buf) continue;
    const s = ctx.createBufferSource();
    if (Math.abs(speed - 1) < 1e-3) {
      s.buffer = buf;
      s.start(seg.tlStart, seg.src0, Math.max(0.01, seg.src1 - seg.src0));
    } else {
      const a = Math.floor(seg.src0 * buf.sampleRate);
      const b = Math.min(buf.length, Math.ceil(seg.src1 * buf.sampleRate));
      const chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(timeStretch(buf.getChannelData(c).subarray(a, b), buf.sampleRate, speed));
      const nb = ctx.createBuffer(chans.length, chans[0].length || 1, buf.sampleRate);
      chans.forEach((d, c) => nb.copyToChannel(d, c));
      s.buffer = nb;
      s.start(seg.tlStart);
    }
    const g = ctx.createGain();
    const e = Math.min(0.006, seg.dur / 4);
    const nextSeg = tl.segs[tl.segs.indexOf(seg) + 1];
    const contNext = !!nextSeg && nextSeg.type === 'video' && nextSeg.cont; // división sin salto: sin fundido para no abrir un bache
    if (seg.cont) g.gain.setValueAtTime(1, seg.tlStart);
    else {
      g.gain.setValueAtTime(0, seg.tlStart);
      g.gain.linearRampToValueAtTime(1, seg.tlStart + e);
    }
    g.gain.setValueAtTime(1, seg.tlStart + seg.dur - e);
    if (!contNext) g.gain.linearRampToValueAtTime(0, seg.tlStart + seg.dur);
    s.connect(g);
    g.connect(voiceIn);
  }

  if (A.sfxOn !== false) {
    await loadSfx(ctx, A.sfx);
    for (const e of A.sfx || []) {
      if (e.t >= tl.total) continue;
      const buf = sfxBuffer(ctx, e.kind);
      if (!buf) continue;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = e.vol ?? 0.5;
      s.connect(g);
      g.connect(master);
      s.start(Math.max(0, e.t));
    }
  }

  if (A.musicId) {
    const rec = await db.get('media', A.musicId);
    let mbuf = null;
    try {
      mbuf = rec ? await decodeAudio(rec.blob) : null;
    } catch {
      mbuf = null;
    }
    if (mbuf) {
      const ms = ctx.createBufferSource();
      ms.buffer = mbuf;
      ms.loop = true;
      const mg = ctx.createGain();
      mg.gain.value = 0;
      ms.connect(mg);
      mg.connect(master);
      ms.start(0, (A.musicOffset || 0) % mbuf.duration);
      // Automatización: baja la música cuando hablas y hace fundidos.
      const regionsFor = (clip) => analysis?.[project.clips[clip]?.mediaId]?.regions;
      for (let t = 0; t < tl.total; t += 0.1) {
        let g = A.musicVol;
        const { seg, local } = locate(tl, t);
        if (A.duck && seg?.type === 'video') {
          const src = seg.src0 + local * speed;
          const regs = regionsFor(seg.clip);
          const speaking = !regs || isSpeechAt(regs, src) || isSpeechAt(regs, src + 0.25);
          if (speaking) g *= 0.3;
        }
        if (A.fade) g *= Math.min(clamp(t / 1, 0, 1), clamp((tl.total - t) / 2, 0, 1));
        mg.gain.setTargetAtTime(g, t, 0.1);
      }
    }
  }
  // Audios importados por el usuario.
  for (const c of project.audioClips || []) {
    if (c.end <= 0 || c.start >= tl.total) continue;
    const rec = await db.get('media', c.mediaId);
    let cb = null;
    try {
      cb = rec ? await decodeAudio(rec.blob) : null;
    } catch {
      cb = null;
    }
    if (!cb) continue;
    const s = ctx.createBufferSource();
    s.buffer = cb;
    const g = ctx.createGain();
    const vol = c.vol ?? 1;
    const fi = c.fadeIn || 0;
    const fo = c.fadeOut || 0;
    const end = Math.min(c.end, tl.total);
    g.gain.setValueAtTime(fi > 0 ? 0 : vol, c.start);
    if (fi > 0) g.gain.linearRampToValueAtTime(vol, c.start + fi);
    if (fo > 0) {
      g.gain.setValueAtTime(vol, Math.max(c.start, end - fo));
      g.gain.linearRampToValueAtTime(0, end);
    }
    s.connect(g);
    g.connect(master);
    s.start(Math.max(0, c.start), c.in || 0, Math.max(0.02, end - c.start));
  }
  onProgress?.(1, 'Mezclando el audio…');
  const out = await ctx.startRendering();
  if (normalize) normalizeLoudness([out.getChannelData(0), out.getChannelData(1)], sr, -14, -1);
  return out;
}

/**
 * Exporta un proyecto con los ajustes `spec` { aspect, w, h, fps, vbr, abr }.
 * Devuelve { blob, ext, mime, width, height, aspect } o null si se cancela.
 */
export async function proExport({ project, brand, assets = {}, analysis = {}, spec, normalize = true, onProgress = () => {}, isCancelled = () => false }) {
  await loadProjectFonts(project);
  if (projectUsesGl(project)) await loadGlTransitions();
  const M = await mb();
  const support = await proExportSupport();
  if (!support.ok) throw new Error(support.reason);
  const proj = structuredClone(project);
  proj.layout.aspect = spec.aspect;
  const tl = buildSegments(proj);
  if (!tl.total) throw new Error('El video está vacío.');
  const fps = spec.fps || 30;
  const W = spec.w;
  const H = spec.h;
  const N = Math.max(1, Math.ceil(tl.total * fps - 1e-6));

  // ---- Entradas de video (una por toma) ----
  const inputs = [];
  const sinks = [];
  const firsts = [];
  const cap = Math.max(W, H) >= 1920 ? 1920 : 1280;
  for (const clip of proj.clips) {
    const rec = await db.get('media', clip.mediaId);
    if (!rec?.blob) throw new Error('Falta el video de una toma.');
    const input = new M.Input({ source: new M.BlobSource(rec.blob), formats: M.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('Una toma no tiene pista de video.');
    const dw = vt.displayWidth || vt.codedWidth;
    const dh = vt.displayHeight || vt.codedHeight;
    const s = Math.min(1, cap / Math.max(dw, dh));
    sinks.push(new M.CanvasSink(vt, { width: Math.round((dw * s) / 2) * 2, height: Math.round((dh * s) / 2) * 2, fit: 'fill', poolSize: 3 }));
    firsts.push((await vt.getFirstTimestamp?.()) || 0);
    inputs.push(input);
  }
  const perClip = proj.clips.map(() => []);
  for (let n = 0; n < N; n++) {
    const { seg, local } = locate(tl, n / fps);
    if (seg?.type === 'video') perClip[seg.clip].push(firsts[seg.clip] + seg.src0 + local * tl.speed);
  }
  const iters = perClip.map((ts, ci) => (ts.length ? sinks[ci].canvasesAtTimestamps(ts)[Symbol.asyncIterator]() : null));
  const lastFrame = proj.clips.map(() => null);

  // ---- Capas (B-roll) ----
  const ovSources = new Map();
  const ovIters = [];
  for (const ov of proj.overlays || []) {
    if (ov.kind !== 'broll' || !ov.mediaId) continue;
    const rec = await db.get('media', ov.mediaId);
    if (!rec?.blob) continue;
    if (ov.mediaKind === 'video') {
      const input = new M.Input({ source: new M.BlobSource(rec.blob), formats: M.ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) continue;
      const first = (await vt.getFirstTimestamp?.()) || 0;
      const sink = new M.CanvasSink(vt, { width: 1280, height: Math.round((1280 * (vt.displayHeight || 720)) / (vt.displayWidth || 1280) / 2) * 2, fit: 'fill', poolSize: 3 });
      const frames = [];
      for (let n = 0; n < N; n++) {
        const t = n / fps;
        if (t >= ov.start && t < ov.end) frames.push(n);
      }
      if (!frames.length) continue;
      const ts = frames.map((n) => first + n / fps - ov.start + (ov.srcStart || 0));
      ovIters.push({ id: ov.id, frames: new Set(frames), it: sink.canvasesAtTimestamps(ts)[Symbol.asyncIterator](), last: null });
      inputs.push(input);
    } else {
      const url = URL.createObjectURL(rec.blob);
      const img = await loadImg(url);
      URL.revokeObjectURL(url);
      if (img) ovSources.set(ov.id, img);
    }
  }

  // ---- Efectos ----
  const fx = new FxPipeline({ maxSide: cap, temporal: 0.3 });
  const fxAssets = { ...assets };
  if (proj.fx?.bg?.mode === 'image' && proj.fx.bg.imageId) {
    const rec = await db.get('media', proj.fx.bg.imageId);
    if (rec?.blob) {
      const url = URL.createObjectURL(rec.blob);
      fxAssets.bgImage = await loadImg(url);
      URL.revokeObjectURL(url);
    }
  }
  // La exportación no es en tiempo real: en el PC siempre usa el recorte de alta calidad (mejor pelo y bordes).
  if (proj.fx?.bg && proj.fx.bg.mode !== 'none' && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) proj.fx.bg.hq = true;
  if (fxNeeds(proj).any) await fx.prepare(proj);

  // ---- Audio ----
  onProgress(0, 'Preparando el audio…');
  const audio = await mixAudio(proj, tl, analysis, { normalize, onProgress: (p, t) => onProgress(p * 0.06, t) });
  if (isCancelled()) return null;

  // ---- Salida ----
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const target = new M.BufferTarget();
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const vcfg = { codec: 'avc', bitrate: spec.vbr, keyFrameInterval: 2, bitrateMode: 'variable', latencyMode: 'quality' };
  const full = await pickFullCodec(W, H, fps, spec.vbr);
  if (full) vcfg.fullCodecString = full;
  const vsrc = new M.CanvasSource(canvas, vcfg);
  output.addVideoTrack(vsrc, { frameRate: fps });
  const asrc = new M.AudioBufferSource({ codec: support.aac ? 'aac' : 'opus', bitrate: spec.abr });
  output.addAudioTrack(asrc);
  output.setMetadataTags?.({ title: project.title, comment: 'Creado con Psico Influencer' });
  await output.start();
  await asrc.add(audio);
  asrc.close?.();

  const capIndex = buildCaptionIndex(proj);
  let lastSeg = -1;
  const t0 = performance.now();
  try {
    for (let n = 0; n < N; n++) {
      if (isCancelled()) {
        await output.cancel();
        return null;
      }
      const t = n / fps;
      const { i, seg, local } = locate(tl, t);
      if (i !== lastSeg) {
        fx.reset();
        lastSeg = i;
      }
      let frame = null;
      let src = 0;
      if (seg?.type === 'video') {
        const r = await iters[seg.clip].next();
        frame = r.value?.canvas || lastFrame[seg.clip];
        lastFrame[seg.clip] = frame;
        src = seg.src0 + local * tl.speed;
      }
      for (const o of ovIters) {
        if (!o.frames.has(n)) continue;
        const r = await o.it.next();
        o.last = r.value?.canvas || o.last;
        if (o.last) ovSources.set(o.id, o.last);
      }
      renderFrame(ctx, W, H, {
        project: proj, brand, t, total: tl.total, videoStart: tl.videoStart, seg, local, src, frame, video: null,
        fx, capIndex, assets: fxAssets, overlaySources: ovSources, nextIsVideo: tl.segs[i + 1]?.type === 'video',
      });
      await vsrc.add(t, 1 / fps);
      if (n % 6 === 0) {
        const el = (performance.now() - t0) / 1000;
        const eta = n > 10 ? (el / n) * (N - n) : 0;
        onProgress(0.06 + (0.92 * n) / N, `Cuadro ${n} de ${N}${eta ? ` · quedan ~${Math.ceil(eta)} s` : ''}`);
      }
    }
    vsrc.close?.();
    onProgress(0.99, 'Guardando el MP4…');
    await output.finalize();
  } catch (e) {
    try {
      await output.cancel();
    } catch {
      /* ya cerrado */
    }
    throw e;
  } finally {
    for (const it of iters) await it?.return?.();
    for (const o of ovIters) await o.it.return?.();
    for (const inp of inputs) inp.dispose?.();
  }
  onProgress(1, 'Listo');
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4', width: W, height: H, aspect: spec.aspect };
}
