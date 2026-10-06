// Composición de cada fotograma en un <canvas>. La vista previa y la exportación usan
// exactamente el mismo código, así lo que ves es lo que se exporta.
import { FONTS, captionAt } from './captions.js';
import { clamp } from '../lib/util.js';
import './fonts.js';
import { transitionSpec, activeEffects, mergeSpecs, drawShape } from './fx-lib.js';
import { applyGl, rememberFrame, projectUsesGl } from './gl-transitions.js';

const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}
const popScale = (since, dur = 0.18) => (since < 0 ? 1 : 0.78 + 0.22 * easeOutBack(since / dur));

export function fontCSS(key, px, weight) {
  const f = FONTS[key] || FONTS.sans;
  return `${weight || f.weight} ${Math.max(1, Math.round(px))}px ${f.family}`;
}

export function hexA(hex, a = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

let filterSupport = null;
export function supportsCanvasFilter() {
  if (filterSupport === null) {
    try {
      const c = document.createElement('canvas').getContext('2d');
      filterSupport = 'filter' in c;
      if (filterSupport) {
        c.filter = 'blur(1px)';
        filterSupport = c.filter === 'blur(1px)';
      }
    } catch {
      filterSupport = false;
    }
  }
  return filterSupport;
}

export const COLOR_PRESETS = {
  none: { label: 'Original', css: '' },
  vivido: { label: 'Vívido', css: 'saturate(1.4) contrast(1.08)', fb: { sat: 1.4 } },
  calido: { label: 'Cálido', css: 'sepia(0.22) saturate(1.15) brightness(1.03)', fb: { tint: '#ff9a3c', a: 0.16 } },
  frio: { label: 'Frío', css: 'saturate(0.9) brightness(1.03) hue-rotate(-12deg)', fb: { tint: '#3c8dff', a: 0.14 } },
  bn: { label: 'B/N', css: 'grayscale(1) contrast(1.12)', fb: { sat: 0 } },
  cine: { label: 'Cine', css: 'contrast(1.15) saturate(0.85) sepia(0.12)', fb: { tint: '#1a6f7a', a: 0.12, sat: 0.85 } },
  suave: { label: 'Suave', css: 'contrast(0.92) brightness(1.06) saturate(0.95)', fb: { bright: 1.06 } },
};

export function colorCSS(color) {
  if (!color) return 'none';
  const p = COLOR_PRESETS[color.preset] || COLOR_PRESETS.none;
  const parts = [];
  if (p.css) parts.push(p.css);
  if (color.brightness !== 1) parts.push(`brightness(${color.brightness})`);
  if (color.contrast !== 1) parts.push(`contrast(${color.contrast})`);
  if (color.saturation !== 1) parts.push(`saturate(${color.saturation})`);
  return parts.join(' ') || 'none';
}

function applyColorFallback(ctx, box, color) {
  const fb = COLOR_PRESETS[color.preset]?.fb || {};
  const sat = (fb.sat ?? 1) * color.saturation;
  const bright = (fb.bright ?? 1) * color.brightness;
  ctx.save();
  if (sat < 0.999) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = clamp(1 - sat, 0, 1);
    ctx.fillStyle = '#808080';
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  if (bright > 1.001) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp((bright - 1) * 1.2, 0, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(box.x, box.y, box.w, box.h);
  } else if (bright < 0.999) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clamp(1 - bright, 0, 1);
    ctx.fillStyle = '#000000';
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  if (fb.tint) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = fb.a;
    ctx.fillStyle = fb.tint;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.restore();
}

const TITLED = { '9:16': [0.2, 0.24], '4:5': [0.18, 0.2], '1:1': [0.17, 0.2], '16:9': [0.15, 0.2] };

export function computeLayout(project, W, H) {
  const L = project.layout;
  const base = Math.min(W, H);
  const full = { x: 0, y: 0, w: W, h: H };
  if (L.mode === 'titled') {
    const [tp, cp] = TITLED[L.aspect] || [0.18, 0.2];
    const titleH = Math.round(H * tp);
    const capH = Math.round(H * cp);
    const vh = H - titleH - capH;
    const vw = L.aspect === '16:9' ? Math.min(W, (vh * 16) / 9) : W;
    return {
      mode: 'titled', base, W, H,
      title: { x: 0, y: 0, w: W, h: titleH },
      video: { x: (W - vw) / 2, y: titleH, w: vw, h: vh },
      captions: { x: 0, y: titleH + vh, w: W, h: capH },
    };
  }
  if (L.mode === 'frame') {
    const m = Math.round(base * 0.06);
    return { mode: 'frame', base, W, H, video: { x: m, y: m, w: W - 2 * m, h: H - 2 * m, r: base * 0.045 }, captions: full, title: null };
  }
  return { mode: L.mode === 'blur' ? 'blur' : 'full', base, W, H, video: full, captions: full, title: null };
}

let featherC = null;
/**
 * Plano abierto (zoom < 1): el video queda más pequeño que el cuadro; se dibuja con los bordes difuminados
 * sobre una copia desenfocada de sí mismo, para que no se vea el corte.
 */
function drawSourceFeathered(ctx, src, sw, sh, box, zoom, ox, oy, mirror, focus) {
  const bw = Math.max(1, Math.round(box.w));
  const bh = Math.max(1, Math.round(box.h));
  featherC ||= document.createElement('canvas');
  if (featherC.width !== bw || featherC.height !== bh) {
    featherC.width = bw;
    featherC.height = bh;
  }
  const t = featherC.getContext('2d');
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, bw, bh);
  drawSource(t, src, sw, sh, { x: 0, y: 0, w: bw, h: bh }, 'cover', zoom, ox, oy, mirror, focus);
  const s = Math.max(bw / sw, bh / sh) * zoom;
  const dw = sw * s;
  const dh = sh * s;
  t.globalCompositeOperation = 'destination-in';
  if (dh < bh - 1) {
    const top = (bh - dh) / 2;
    const f = Math.max(2, dh * 0.04);
    const g = t.createLinearGradient(0, top, 0, top + dh);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(Math.min(0.49, f / dh), 'rgba(0,0,0,1)');
    g.addColorStop(Math.max(0.51, 1 - f / dh), 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = g;
    t.fillRect(0, 0, bw, bh);
  }
  if (dw < bw - 1) {
    const left = (bw - dw) / 2;
    const f = Math.max(2, dw * 0.04);
    const g = t.createLinearGradient(left, 0, left + dw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(Math.min(0.49, f / dw), 'rgba(0,0,0,1)');
    g.addColorStop(Math.max(0.51, 1 - f / dw), 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    t.fillStyle = g;
    t.fillRect(0, 0, bw, bh);
  }
  t.globalCompositeOperation = 'source-over';
  ctx.drawImage(featherC, box.x, box.y, box.w, box.h);
}

function drawSource(ctx, src, sw, sh, box, fit, zoom, ox, oy, mirror, focus = null) {
  const s = (fit === 'contain' ? Math.min(box.w / sw, box.h / sh) : Math.max(box.w / sw, box.h / sh)) * zoom;
  const dw = sw * s;
  const dh = sh * s;
  const mx = Math.max(0, (dw - box.w) / 2);
  const my = Math.max(0, (dh - box.h) / 2);
  let dx = box.x + (box.w - dw) / 2 - ox * mx;
  let dy = box.y + (box.h - dh) / 2 - oy * my;
  if (focus && dw >= box.w && dh >= box.h) {
    // Encuadre automático: la cara queda centrada (un poco sobre la mitad) sin salirse del video.
    dx = clamp(box.x + box.w / 2 - focus.x * dw, box.x + box.w - dw, box.x);
    dy = clamp(box.y + box.h * 0.42 - focus.y * dh, box.y + box.h - dh, box.y);
  }
  if (mirror) {
    ctx.save();
    ctx.translate(box.x * 2 + box.w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, dx, dy, dw, dh);
    ctx.restore();
  } else ctx.drawImage(src, dx, dy, dw, dh);
}

let blurSmall = null;
let blurMid = null;
function drawBlurred(ctx, src, sw, sh, box) {
  blurSmall ||= document.createElement('canvas');
  blurMid ||= document.createElement('canvas');
  const sW = 32;
  const sH = Math.max(8, Math.round((32 * box.h) / box.w));
  if (blurSmall.width !== sW || blurSmall.height !== sH) {
    blurSmall.width = sW;
    blurSmall.height = sH;
    blurMid.width = sW * 4;
    blurMid.height = sH * 4;
  }
  const sc = blurSmall.getContext('2d');
  drawSource(sc, src, sw, sh, { x: 0, y: 0, w: sW, h: sH }, 'cover', 1, 0, 0, false);
  const mc = blurMid.getContext('2d');
  mc.imageSmoothingEnabled = true;
  mc.drawImage(blurSmall, 0, 0, blurMid.width, blurMid.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(blurMid, box.x, box.y, box.w, box.h);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

function drawPlaceholder(ctx, box) {
  const g = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
  g.addColorStop(0, '#2b2d42');
  g.addColorStop(1, '#4a4e7a');
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const cx = box.x + box.w / 2;
  const r = Math.min(box.w, box.h) * 0.14;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(cx, box.y + box.h * 0.42, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, box.y + box.h * 0.42 + r * 3.1, r * 2.3, r * 1.7, 0, Math.PI, 0);
  ctx.fill();
}

function drawVideoLayer(ctx, scene, lay) {
  const { project, video } = scene;
  const L = project.layout;
  const box = lay.video;
  ctx.save();
  if (lay.mode === 'frame') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = lay.base * 0.04;
    ctx.fillStyle = '#000';
    roundRect(ctx, box.x, box.y, box.w, box.h, box.r);
    ctx.fill();
    ctx.restore();
    roundRect(ctx, box.x, box.y, box.w, box.h, box.r);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
  }
  let zoom = L.zoom || 1;
  if (L.dynamicZoom && scene.seg?.vi % 2 === 1) zoom *= 1.08;
  const tr = transitionState(scene);
  const fxs = activeEffects(project, scene.t);
  const M = mergeSpecs([tr, ...fxs.map((f) => f.def.pre?.(f.st))]);
  zoom *= M.zoom;
  if (scene.seg?.zoomBoost) zoom *= scene.seg.zoomBoost;
  let src = scene.frame || (video && video.readyState >= 2 && video.videoWidth ? video : null);
  if (src) {
    let sw = src.videoWidth || src.displayWidth || src.width;
    let sh = src.videoHeight || src.displayHeight || src.height;
    let graded = false;
    if (scene.fx) {
      const r = scene.fx.process(src, sw, sh, project, { assets: scene.assets, brand: scene.brand });
      if (r.image !== src) {
        src = r.image;
        sw = src.width;
        sh = src.height;
      }
      graded = scene.fx.grader?.ok;
    }
    const clip = project.clips?.[scene.seg?.clip];
    const focus = project.fx?.reframe?.enabled && L.mode !== 'blur' ? faceFocus(clip, scene.src) : null;
    const filter = graded ? 'none' : colorCSS(project.color);
    const canFilter = supportsCanvasFilter();
    const useFilter = filter !== 'none' && canFilter;
    const wide = L.mode !== 'blur' && zoom < 0.995; // plano abierto
    const fxFilter = canFilter ? [useFilter ? filter : '', M.filter, M.blur ? `blur(${(M.blur * box.w) / 1080}px)` : ''].filter(Boolean).join(' ') : '';
    ctx.save();
    if (M.dx || M.dy || M.rot) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx + M.dx * box.w, cy + M.dy * box.h);
      ctx.rotate(M.rot);
      ctx.translate(-cx, -cy);
    }
    if (L.mode === 'blur' || wide) drawBlurred(ctx, src, sw, sh, box);
    if (fxFilter) ctx.filter = fxFilter;
    if (wide) drawSourceFeathered(ctx, src, sw, sh, box, zoom, L.offsetX || 0, L.offsetY || 0, L.mirror, null);
    else drawSource(ctx, src, sw, sh, box, L.mode === 'blur' ? 'contain' : 'cover', zoom, L.offsetX || 0, L.offsetY || 0, L.mirror, focus);
    if (fxFilter) ctx.filter = 'none';
    else if (filter !== 'none') applyColorFallback(ctx, box, project.color);
    ctx.restore();
  } else if (scene.placeholder) drawPlaceholder(ctx, box);
  for (const post of M.posts) post(ctx, box);
  for (const f of fxs) f.def.post?.(ctx, box, f.st);
  for (const o of M.overlays) {
    ctx.fillStyle = o;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  // Transición GL: mezcla el fotograma congelado del tramo anterior con el que entra.
  if (tr.gl) applyGl(ctx, box, tr.gl, tr.glp, scene.t - (scene.local ?? 0));
  else if (src && projectUsesGl(project)) rememberFrame(ctx, box, scene.t);
  ctx.restore();
}

/** Posición de la cara (normalizada) en el instante s de la toma, interpolada. */
function faceFocus(clip, s) {
  const tr = clip?.faceTrack;
  if (!tr?.length) return null;
  let lo = 0;
  let hi = tr.length - 1;
  if (s <= tr[0].t) return tr[0];
  if (s >= tr[hi].t) return tr[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr[mid].t <= s) lo = mid;
    else hi = mid;
  }
  const a = tr[lo];
  const b = tr[hi];
  const k = (s - a.t) / Math.max(1e-6, b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Clave estable de un corte (no cambia al borrar otros tramos): toma + instante de origen del tramo que entra. */
export function segKey(seg) {
  return `${seg.clip}@${seg.src0.toFixed(2)}`;
}

/** Transición al inicio de un tramo de video: la elegida para ese corte o, si no hay, la general del proyecto. */
function transitionState(scene) {
  const seg = scene.seg;
  if (!seg || seg.type !== 'video') return {};
  const own = scene.project.transitions?.[segKey(seg)];
  const kind = own ? own.kind : seg.vi > 0 && !seg.cont ? scene.project.layout.transition || 'none' : 'none';
  return transitionSpec(kind, scene.local ?? 0, own?.dur) || {};
}

export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function fitText(ctx, text, font, px, maxW, maxH, lhMul = 1.15) {
  let size = px;
  let lines = [];
  for (let i = 0; i < 16; i++) {
    ctx.font = fontCSS(font, size);
    lines = wrapText(ctx, text, maxW);
    const tooWide = lines.some((l) => ctx.measureText(l).width > maxW);
    if (lines.length * size * lhMul <= maxH && !tooWide) break;
    size *= 0.9;
  }
  return { size, lines };
}

function drawLines(ctx, lines, font, size, cx, cy, color, { stroke = null, shadow = true } = {}) {
  ctx.save();
  ctx.font = fontCSS(font, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lh = size * 1.15;
  let y = cy - ((lines.length - 1) * lh) / 2;
  for (const l of lines) {
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = size * 0.15;
      ctx.shadowOffsetY = size * 0.04;
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = size * 0.16;
      ctx.strokeText(l, cx, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = color;
    ctx.fillText(l, cx, y);
    y += lh;
  }
  ctx.restore();
}

function drawHeadline(ctx, scene, lay) {
  const { project } = scene;
  const Hd = project.headline;
  let text = (Hd.text || '').trim();
  if (!text && lay.mode === 'titled') text = (project.title || '').trim();
  if (!text) return;
  if (Hd.upper) text = text.toLocaleUpperCase('es');
  const { W, H, base } = lay;
  const px = (base * Hd.sizePct) / 100;
  if (lay.mode === 'titled') {
    const a = lay.title;
    const pad = base * 0.05;
    const { size, lines } = fitText(ctx, text, Hd.font, px, a.w - pad * 2, a.h - pad * 1.2);
    drawLines(ctx, lines, Hd.font, size, a.x + a.w / 2, a.y + a.h / 2 + pad * 0.2, Hd.color, { shadow: false });
    return;
  }
  if (Hd.overlay === 'none') return;
  let alpha = 1;
  if (Hd.overlay === 'start') {
    const vt = scene.t - (scene.videoStart || 0);
    if (vt > 3.5 || vt < 0) return;
    alpha = vt > 3 ? 1 - (vt - 3) / 0.5 : 1;
  }
  const pad = base * 0.035;
  const { size, lines } = fitText(ctx, text, Hd.font, px, W * 0.8, H * 0.22);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontCSS(Hd.font, size);
  const lh = size * 1.15;
  const blockH = lines.length * lh;
  const maxLine = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const cy = H * (project.layout.aspect === '16:9' ? 0.2 : 0.17);
  if (Hd.boxOpacity > 0) {
    ctx.fillStyle = hexA(Hd.boxColor, Hd.boxOpacity);
    roundRect(ctx, W / 2 - maxLine / 2 - pad, cy - blockH / 2 - pad * 0.7, maxLine + pad * 2, blockH + pad * 1.4, pad * 0.8);
    ctx.fill();
  }
  drawLines(ctx, lines, Hd.font, size, W / 2, cy, Hd.color, { shadow: Hd.boxOpacity < 0.3 });
  ctx.restore();
}

function drawCaptions(ctx, scene, lay) {
  const { project, seg } = scene;
  const cap = project.captions;
  if (!cap?.enabled || scene.hideCaptions || !scene.capIndex || !seg || seg.type !== 'video') return;
  const st = cap.style;
  const s = scene.src;
  const hit = captionAt(scene.capIndex, seg.clip, s);
  if (!hit) return;
  let items = hit.words.map((w, k) => ({ w, k }));
  const activeK = hit.activeLocal;
  if (st.mode === 'word') {
    if (activeK < 0) return;
    items = [items[activeK]];
  }
  const { W, H, base } = lay;
  const px = (base * st.sizePct) / 100;
  ctx.save();
  ctx.font = fontCSS(st.font, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const texts = items.map(({ w }) => {
    const t = st.upper ? w.text.toLocaleUpperCase('es') : w.text;
    return w.emoji && cap.emojis !== false ? `${t} ${w.emoji}` : t;
  });
  const widths = texts.map((t) => ctx.measureText(t).width);
  const space = ctx.measureText(' ').width;
  const area = lay.mode === 'titled' ? lay.captions : { x: 0, y: 0, w: W, h: H };
  const maxW = area.w * 0.86;
  const lines = [];
  let line = null;
  texts.forEach((_, i) => {
    if (line && line.w + space + widths[i] > maxW) {
      lines.push(line);
      line = null;
    }
    if (!line) line = { items: [i], w: widths[i] };
    else {
      line.items.push(i);
      line.w += space + widths[i];
    }
  });
  if (line) lines.push(line);
  // Palabras sueltas más anchas que el área: se reduce la escala.
  const widest = Math.max(...lines.map((l) => l.w));
  const fitScale = widest > maxW ? maxW / widest : 1;
  const lh = px * 1.25;
  const cx = area.x + area.w / 2;
  const cy = lay.mode === 'titled' ? area.y + area.h * 0.5 : area.y + area.h * st.posY;
  const groupSince = s - hit.group.t0;
  const activeWord = activeK >= 0 ? hit.words[activeK] : null;
  const wordSince = activeWord ? s - activeWord.t0 : 99;
  let gScale = fitScale;
  let alpha = 1;
  if (st.anim === 'fade') alpha = clamp(groupSince / 0.18, 0, 1);
  if (st.anim === 'pop') gScale *= st.mode === 'word' ? popScale(wordSince) : 0.92 + 0.08 * easeOut(groupSince / 0.15);
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(gScale, gScale);
  ctx.translate(-cx, -cy);
  let y = cy - ((lines.length - 1) * lh) / 2;
  const padX = px * 0.3;
  for (const ln of lines) {
    let x = cx - ln.w / 2;
    if (st.box) {
      ctx.fillStyle = hexA(st.boxColor, st.boxOpacity);
      roundRect(ctx, x - padX, y - px * 0.68, ln.w + padX * 2, px * 1.36, px * 0.24);
      ctx.fill();
    }
    for (const i of ln.items) {
      const isActive = st.mode !== 'word' && items[i].k === activeK;
      const wW = widths[i];
      const wcx = x + wW / 2;
      ctx.save();
      if (isActive && st.anim === 'pop') {
        const sc = 1 + 0.12 * (1 - easeOut(wordSince / 0.25));
        ctx.translate(wcx, y);
        ctx.scale(sc, sc);
        ctx.translate(-wcx, -y);
      }
      if (isActive && st.hlMode === 'box') {
        ctx.fillStyle = st.hlColor;
        roundRect(ctx, x - px * 0.14, y - px * 0.62, wW + px * 0.28, px * 1.24, px * 0.18);
        ctx.fill();
      }
      if (st.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = px * 0.18;
        ctx.shadowOffsetY = px * 0.05;
      }
      if (st.strokeW > 0) {
        ctx.strokeStyle = st.strokeColor;
        ctx.lineWidth = px * st.strokeW * 2;
        ctx.strokeText(texts[i], x, y);
        ctx.shadowColor = 'transparent';
      }
      let color = st.color;
      if (items[i].w.kw && cap.keywords !== false) color = st.kwColor || st.hlColor;
      if (isActive && st.hlMode === 'color') color = st.hlColor;
      ctx.fillStyle = color;
      ctx.fillText(texts[i], x, y);
      if (isActive && st.hlMode === 'underline') {
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = st.hlColor;
        ctx.fillRect(x, y + px * 0.52, wW, Math.max(2, px * 0.09));
      }
      ctx.restore();
      x += wW + space;
    }
    y += lh;
  }
  ctx.restore();
}

function drawLowerThird(ctx, scene, lay) {
  const lt = scene.project.brand.lowerThird;
  if (!lt?.enabled) return;
  const name = (lt.name || scene.brand?.name || '').trim();
  const role = (lt.role || scene.brand?.role || '').trim();
  if (!name && !role) return;
  const local = scene.t - (scene.videoStart || 0) - lt.start;
  if (local < 0 || local > lt.dur) return;
  const p = Math.min(easeOut(local / 0.45), easeOut((lt.dur - local) / 0.45));
  const { H, base } = lay;
  const nPx = base * 0.046;
  const rPx = base * 0.032;
  const pad = base * 0.024;
  ctx.save();
  ctx.font = fontCSS('sans', nPx);
  const nW = name ? ctx.measureText(name).width : 0;
  ctx.font = fontCSS('sans', rPx, 600);
  const rW = role ? ctx.measureText(role).width : 0;
  const bar = base * 0.012;
  const x0 = base * 0.05;
  const nH = name ? nPx + pad * 1.2 : 0;
  const rH = role ? rPx + pad : 0;
  const boxW = Math.max(nW, rW) + pad * 2;
  let yTop;
  if (lt.pos === 'top') yTop = H * 0.1;
  else if (lay.mode === 'titled') yTop = lay.video.y + lay.video.h - nH - rH - base * 0.04;
  else yTop = H * (scene.project.layout.aspect === '9:16' ? 0.58 : 0.64);
  const x = x0 - (1 - p) * (boxW + x0 + bar);
  ctx.globalAlpha = clamp(p * 1.3, 0, 1);
  ctx.fillStyle = scene.brand?.secondary || '#00D2D3';
  ctx.fillRect(x, yTop, bar, nH + rH);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (name) {
    ctx.fillStyle = scene.brand?.primary || '#6C4DFF';
    ctx.fillRect(x + bar, yTop, nW + pad * 2, nH);
    ctx.font = fontCSS('sans', nPx);
    ctx.fillStyle = scene.brand?.textColor || '#FFFFFF';
    ctx.fillText(name, x + bar + pad, yTop + nH / 2);
  }
  if (role) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(x + bar, yTop + nH, rW + pad * 2, rH);
    ctx.font = fontCSS('sans', rPx, 600);
    ctx.fillStyle = '#111111';
    ctx.fillText(role, x + bar + pad, yTop + nH + rH / 2);
  }
  ctx.restore();
}

function drawBrandMarks(ctx, scene, lay) {
  const B = scene.project.brand;
  const brand = scene.brand || {};
  const logo = scene.assets?.logo;
  const { W, H, base } = lay;
  const m = base * 0.045;
  const pos = B.logoPos || 'tr';
  const right = pos.includes('r');
  const bottom = pos.includes('b');
  const progressBottom = B.progress?.enabled && B.progress.pos === 'bottom';
  let cursorY = bottom ? H - m - (progressBottom ? base * 0.015 : 0) : m;
  ctx.save();
  if (B.logo && logo && logo.width) {
    const lw = base * B.logoSize;
    const lh = (lw * logo.height) / logo.width;
    const x = right ? W - m - lw : m;
    const y = bottom ? cursorY - lh : cursorY;
    ctx.globalAlpha = B.logoOpacity;
    ctx.drawImage(logo, x, y, lw, lh);
    ctx.globalAlpha = 1;
    cursorY = bottom ? y - base * 0.012 : y + lh + base * 0.012;
  }
  if (B.handle && brand.handle) {
    const text = brand.handle.startsWith('@') ? brand.handle : `@${brand.handle}`;
    const px = base * 0.032;
    ctx.font = fontCSS('sans', px);
    ctx.textAlign = right ? 'right' : 'left';
    ctx.textBaseline = bottom ? 'bottom' : 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = px * 0.3;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, right ? W - m : m, cursorY);
  }
  ctx.restore();
}

function drawProgress(ctx, scene, lay) {
  const P = scene.project.brand.progress;
  if (!P?.enabled || !scene.total) return;
  const { W, H, base } = lay;
  const th = Math.max(4, base * 0.008);
  const y = P.pos === 'top' ? 0 : H - th;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, y, W, th);
  ctx.fillStyle = scene.brand?.primary || '#6C4DFF';
  ctx.fillRect(0, y, W * clamp(scene.t / scene.total, 0, 1), th);
  ctx.restore();
}

function drawCard(ctx, scene, lay) {
  const { project, brand, seg, local } = scene;
  const card = project[seg.card] || {};
  const { W, H, base } = lay;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, brand?.primary || '#6C4DFF');
  g.addColorStop(1, brand?.secondary || '#00D2D3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const pIn = easeOut(local / 0.5);
  const pOut = clamp((seg.dur - local) / 0.3, 0, 1);
  ctx.save();
  ctx.globalAlpha = Math.min(pIn, pOut);
  const sc = 0.9 + 0.1 * pIn;
  ctx.translate(W / 2, H / 2);
  ctx.scale(sc, sc);
  ctx.translate(-W / 2, -H / 2);
  const logo = scene.assets?.logo;
  const text =
    (card.text || '').trim() || (seg.card === 'intro' ? project.headline.text || project.title || '' : '¡Sígueme para más!');
  const { size, lines } = fitText(ctx, text, 'impact', base * 0.11, W * 0.84, H * 0.35);
  const blockH = lines.length * size * 1.15;
  const lw = base * 0.28;
  const logoH = logo?.width ? (lw * logo.height) / logo.width : 0;
  const handle = seg.card === 'outro' && brand?.handle ? (brand.handle.startsWith('@') ? brand.handle : `@${brand.handle}`) : '';
  const hPx = base * 0.045;
  const totalH = logoH + (logoH ? base * 0.05 : 0) + blockH + (handle ? hPx * 2 : 0);
  let top = H / 2 - totalH / 2;
  if (logoH) {
    ctx.drawImage(logo, W / 2 - lw / 2, top, lw, logoH);
    top += logoH + base * 0.05;
  }
  drawLines(ctx, lines, 'impact', size, W / 2, top + blockH / 2, brand?.textColor || '#FFFFFF');
  top += blockH;
  if (handle) {
    ctx.font = fontCSS('sans', hPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(handle, W / 2, top + hPx);
  }
  ctx.restore();
}

function drawCoverText(ctx, scene, lay) {
  const text = String(scene.coverText || '').trim();
  if (!text) return;
  const { W, H, base } = lay;
  const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);
  const upper = text.toLocaleUpperCase('es');
  const { size, lines } = fitText(ctx, upper, 'impact', base * 0.12, W * 0.88, H * 0.34);
  const cy = H * (scene.project.layout.aspect === '16:9' ? 0.66 : 0.7);
  drawLines(ctx, lines, 'impact', size, W / 2, cy, '#FFFFFF', { stroke: '#000000' });
  const accent = scene.brand?.primary || '#6C4DFF';
  ctx.fillStyle = accent;
  const bw = W * 0.2;
  ctx.fillRect(W / 2 - bw / 2, cy + (lines.length * size * 1.15) / 2 + base * 0.02, bw, Math.max(4, base * 0.012));
}

/**
 * Capas: B-roll (imagen/video a pantalla completa o en recuadro), textos y stickers.
 * 'under' se dibuja bajo títulos y subtítulos; 'over', encima.
 */
function drawOverlays(ctx, scene, lay, phase) {
  const list = scene.project.overlays;
  if (!list?.length) return;
  const { W, H, base } = lay;
  const t = scene.t;
  for (const ov of list) {
    if (!(t >= ov.start && t < ov.end)) continue;
    const isMedia = ov.kind === 'broll';
    if ((phase === 'under') !== isMedia) continue;
    const pIn = ov.anim === 'none' ? 1 : easeOut((t - ov.start) / 0.3);
    const pOut = ov.anim === 'none' ? 1 : easeOut((ov.end - t) / 0.25);
    const p = Math.min(pIn, pOut);
    ctx.save();
    if (ov.rot) {
      ctx.translate(W * (ov.x ?? 0.5), H * (ov.y ?? 0.3));
      ctx.rotate((ov.rot * Math.PI) / 180);
      ctx.translate(-W * (ov.x ?? 0.5), -H * (ov.y ?? 0.3));
    }
    if (ov.opacity != null && ov.opacity < 1) ctx.globalAlpha = ov.opacity;
    if (ov.kind === 'shape') {
      const since = t - ov.start;
      const a = ov.anim === 'none' ? 1 : p;
      const sc = ov.anim === 'pop' ? 0.6 + 0.4 * easeOutBack(Math.min(1, since / 0.35)) : 1;
      ctx.globalAlpha *= ov.anim === 'draw' ? 1 : a;
      ctx.translate(W * (ov.x ?? 0.5), H * (ov.y ?? 0.5) + (ov.anim === 'slide' ? (1 - p) * H * 0.06 : 0));
      ctx.scale(sc, sc);
      drawShape(ctx, ov.shape || 'rect', W * (ov.w ?? 0.4), H * (ov.h ?? 0.12), {
        color: ov.color || '#ffd166', fill: ov.fill !== false, line: Math.max(2, (base * (ov.line ?? 0.8)) / 100),
        reveal: ov.anim === 'draw' ? easeOut(since / 0.5) : 1,
      });
    } else if (isMedia) {
      const src = scene.overlaySources?.get(ov.id);
      const sw = src?.videoWidth || src?.displayWidth || src?.width;
      const sh = src?.videoHeight || src?.displayHeight || src?.height;
      if (!src || !sw || (src.readyState !== undefined && src.readyState < 2)) {
        ctx.restore();
        continue;
      }
      if (ov.layout === 'free') {
        // Sticker con transparencia (emoji 3D del Material): sin marco, entra con rebote y se mece suave.
        const bw = W * (ov.w || 0.28);
        const bh = (bw * sh) / sw;
        const since = t - ov.start;
        const sc = (0.6 + 0.4 * easeOutBack(Math.min(1, since / 0.35))) * (1 + 0.03 * Math.sin(since * 5));
        ctx.globalAlpha = (ov.anim === 'none' ? 1 : p) * (ov.opacity ?? 1);
        if (ov.blend) ctx.globalCompositeOperation = ov.blend;
        ctx.translate(W * (ov.x ?? 0.78), H * (ov.y ?? 0.22));
        ctx.rotate(0.05 * Math.sin(since * 3));
        ctx.scale(sc, sc);
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = base * 0.02;
        ctx.drawImage(src, -bw / 2, -bh / 2, bw, bh);
      } else if (ov.layout === 'pip') {
        const bw = W * (ov.w || 0.45);
        const bh = (bw * sh) / sw;
        const sc = ov.anim === 'pop' ? 0.85 + 0.15 * easeOutBack(Math.min(1, (t - ov.start) / 0.35)) : 1;
        const cx = W * (ov.x ?? 0.5);
        const cy = H * (ov.y ?? 0.35);
        ctx.globalAlpha = (ov.anim === 'fade' || ov.anim === 'pop' ? p : 1) * (ov.opacity ?? 1);
        if (ov.blend) ctx.globalCompositeOperation = ov.blend;
        ctx.translate(cx, cy + (ov.anim === 'slide' ? (1 - p) * H * 0.1 : 0));
        ctx.scale(sc, sc);
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = base * 0.03;
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, base * 0.03);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        const b = Math.max(3, base * 0.008);
        roundRect(ctx, -bw / 2 + b, -bh / 2 + b, bw - 2 * b, bh - 2 * b, base * 0.025);
        ctx.clip();
        ctx.drawImage(src, -bw / 2 + b, -bh / 2 + b, bw - 2 * b, bh - 2 * b);
      } else {
        const box = lay.video;
        ctx.globalAlpha = (ov.anim === 'none' ? 1 : p) * (ov.opacity ?? 1);
        if (ov.blend) ctx.globalCompositeOperation = ov.blend; // overlays de luz: «screen»
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.w, box.h);
        ctx.clip();
        const zoom = 1 + 0.06 * ((t - ov.start) / Math.max(0.5, ov.end - ov.start)); // leve efecto Ken Burns
        drawSource(ctx, src, sw, sh, box, 'cover', zoom, 0, 0, false);
      }
    } else {
      const text = ov.kind === 'sticker' ? ov.emoji || ov.text || '⭐' : ov.text || '';
      if (!text.trim()) {
        ctx.restore();
        continue;
      }
      const px = (base * (ov.size || (ov.kind === 'sticker' ? 16 : 7))) / 100;
      const font = ov.font || 'impact';
      let shown = ov.upper ? text.toLocaleUpperCase('es') : text;
      if (ov.anim === 'type') shown = shown.slice(0, Math.ceil(shown.length * clamp((t - ov.start) / Math.min(1.2, (ov.end - ov.start) * 0.6), 0, 1)));
      const { size, lines } = fitText(ctx, shown, font, px, W * 0.86, H * 0.4);
      const cx = W * (ov.x ?? 0.5);
      const cy = H * (ov.y ?? 0.3);
      let sc = 1;
      if (ov.anim === 'pop') sc = 0.7 + 0.3 * easeOutBack(Math.min(1, (t - ov.start) / 0.3));
      if (ov.anim === 'zoomout') sc = 1 + 0.7 * (1 - easeOut((t - ov.start) / 0.4));
      if (ov.anim === 'blur' && supportsCanvasFilter()) ctx.filter = `blur(${(1 - easeOut((t - ov.start) / 0.45)) * 14}px)`;
      const bob = ov.anim === 'bounce' ? -Math.abs(Math.sin(Math.min(1, (t - ov.start) / 0.6) * Math.PI * 2.5)) * (1 - Math.min(1, (t - ov.start) / 0.6)) * H * 0.04 : 0;
      if (ov.kind === 'sticker') sc *= 1 + 0.04 * Math.sin((t - ov.start) * 6);
      ctx.globalAlpha = ov.anim === 'none' ? 1 : p;
      ctx.translate(cx, cy + bob + (ov.anim === 'slide' ? (1 - p) * H * 0.06 : 0));
      ctx.scale(sc, sc);
      if (ov.kind === 'text' && ov.box) {
        ctx.font = fontCSS(font, size);
        const lw = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const pad = size * 0.35;
        const bh = lines.length * size * 1.15;
        ctx.fillStyle = hexA(ov.boxColor || '#000000', ov.boxOpacity ?? 0.65);
        roundRect(ctx, -lw / 2 - pad, -bh / 2 - pad * 0.6, lw + pad * 2, bh + pad * 1.2, size * 0.3);
        ctx.fill();
      }
      drawLines(ctx, lines, font, size, 0, 0, ov.color || '#FFFFFF', { stroke: ov.kind === 'text' && !ov.box ? ov.stroke || '#000000' : null, shadow: ov.kind === 'sticker' });
    }
    ctx.restore();
  }
}

/**
 * scene: { project, brand, t, total, videoStart, seg, local, src, video, frame, fx, capIndex, assets,
 *          overlaySources, nextIsVideo, placeholder, hideCaptions, coverText }
 */
export function renderFrame(ctx, W, H, scene) {
  const lay = computeLayout(scene.project, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = scene.project.layout.bg || '#000000';
  ctx.fillRect(0, 0, W, H);
  if (scene.seg?.type === 'card') {
    drawCard(ctx, scene, lay);
    drawProgress(ctx, scene, lay);
    ctx.restore();
    return lay;
  }
  drawVideoLayer(ctx, scene, lay);
  drawOverlays(ctx, scene, lay, 'under');
  if (!scene.coverText) drawHeadline(ctx, scene, lay);
  drawCaptions(ctx, scene, lay);
  drawOverlays(ctx, scene, lay, 'over');
  drawLowerThird(ctx, scene, lay);
  drawBrandMarks(ctx, scene, lay);
  if (!scene.coverText) drawProgress(ctx, scene, lay);
  drawCoverText(ctx, scene, lay);
  ctx.restore();
  return lay;
}
