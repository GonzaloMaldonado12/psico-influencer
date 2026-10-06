// Cadena de efectos por fotograma: contacto visual, cambio/desenfoque de fondo e
// iluminación/color. Se aplica igual en la vista previa y en la exportación.
import { personAlpha, detectFace, ensure, EYES } from '../ai/vision.js';
import { Grader, gradeParams, isIdentity } from './grade.js';
import { clamp, IS_MOBILE } from '../lib/util.js';
import { drawScene } from './scenes.js';

export const DEFAULT_FX = {
  // Perfil estándar: sin fondo virtual por defecto (se elige en Fondo > Box de atención) y mirada natural.
  bg: { mode: 'none', color: '#1f2a44', gradient: 'calma', scene: 'calido', imageId: null, blur: 16, edge: 0.5, hq: false, body: 2, strict: 0 },
  gaze: { enabled: !IS_MOBILE, strength: 0.7 },
  light: { auto: false, exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, faceBoost: 0, vignette: 0 },
  reframe: { enabled: false },
};

export const BG_GRADIENTS = {
  calma: { label: 'Calma', stops: ['#5fb3b3', '#b8a9e3'] },
  atardecer: { label: 'Atardecer', stops: ['#f6b38e', '#d9738f'] },
  noche: { label: 'Noche', stops: ['#1b2a4a', '#4b2d6b'] },
  bosque: { label: 'Bosque', stops: ['#1f4037', '#99b898'] },
  arena: { label: 'Arena', stops: ['#e8d8c3', '#c9a27e'] },
  estudio: { label: 'Estudio', stops: ['#3a3a44', '#15151b'], radial: true },
  bokeh: { label: 'Bokeh cálido', stops: ['#3b2a22', '#120d0b'], radial: true, bokeh: true },
  marca: { label: 'Mi marca', stops: null },
};

export function fxNeeds(project) {
  const fx = project.fx || DEFAULT_FX;
  const seg = fx.bg?.mode && fx.bg.mode !== 'none';
  const light = fx.light || {};
  const face = !!(fx.gaze?.enabled || light.faceBoost > 0 || (seg && fx.bg.mode !== 'blur' && (fx.bg.body ?? 2) > 0));
  const grade = !isIdentity(gradeParams(project.color, light));
  // Celular: sin fondo virtual (eso se hace en el PC); la mirada solo si se pidió al guardar una toma.
  if (IS_MOBILE) {
    const gaze = !!fx.gaze?.enabled;
    return { seg: false, hq: false, face: gaze, grade, any: grade || gaze };
  }
  return { seg, hq: !!fx.bg?.hq, face, grade, any: seg || face || grade };
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let filterOK = null;
function canFilter() {
  if (filterOK === null) {
    try {
      const c = document.createElement('canvas').getContext('2d');
      c.filter = 'blur(2px)';
      filterOK = c.filter === 'blur(2px)';
    } catch {
      filterOK = false;
    }
  }
  return filterOK;
}

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dibuja un fondo de degradado/bokeh (se cachea por tamaño). */
export function drawGradientBg(ctx, W, H, key, brand) {
  const g = BG_GRADIENTS[key] || BG_GRADIENTS.calma;
  const stops = g.stops || [brand?.primary || '#6C4DFF', brand?.secondary || '#00D2D3'];
  const grad = g.radial
    ? ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75)
    : ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(1, stops[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  if (g.bokeh) {
    const rnd = mulberry(7);
    const base = Math.min(W, H);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W;
      const y = rnd() * H * 0.9;
      const r = base * (0.03 + rnd() * 0.09);
      const warm = ['255,196,120', '255,168,96', '255,226,170', '240,150,110'][i % 4];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${warm},${0.22 + rnd() * 0.25})`);
      rg.addColorStop(0.7, `rgba(${warm},${0.08 + rnd() * 0.1})`);
      rg.addColorStop(1, `rgba(${warm},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCover(ctx, img, W, H) {
  const iw = img.width || img.videoWidth;
  const ih = img.height || img.videoHeight;
  if (!iw || !ih) return;
  const s = Math.max(W / iw, H / ih);
  ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}

function sampleColor(ctx, x, y) {
  try {
    const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    return [230, 225, 220];
  }
}

/** Corrige la mirada: mueve el iris hacia el centro del ojo (efecto «mirar a cámara»). */
/** Ancho del cuerpo (en anchos de cara a cada lado del centro) según el ajuste elegido. */
const BODY_HALF = [0, 1.75, 2.1, 2.8, 3.6];

/**
 * Limita el recorte al ancho razonable del torso, desde la barbilla hacia abajo. Quita restos de muebles,
 * cama o respaldo que la IA confunde con el cuerpo y que delatarían el fondo falso. 0 = sin límite.
 */
function bodyEnvelope(a, face, level) {
  const half = BODY_HALF[Math.max(0, Math.min(4, Math.round(level)))];
  if (!half || !face.box) return;
  const { w, h, alpha } = a;
  const cx = face.center.x;
  const hw = face.box.w * half;
  const chin = face.box.y + face.box.h;
  for (let y = 0; y < h; y++) {
    const t = smooth01((y / h - (chin - face.box.h * 0.1)) / (face.box.h * 0.6));
    if (t <= 0) continue;
    for (let x = 0; x < w; x++) {
      const e = smooth01((Math.abs(x / w - cx) - hw) / (hw * 0.18));
      if (e > 0) alpha[y * w + x] *= 1 - e * t;
    }
  }
}

const smooth01 = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Corrección de mirada natural. Cuando lees, el iris queda bajo/al lado del centro del ojo; aquí se
 * devuelve hacia el centro con estas reglas para que no se note:
 * - los dos ojos se mueven igual (evita ojos bizcos o desalineados);
 * - el movimiento se suaviza en el tiempo (sin temblor del iris) y se mantiene durante parpadeos;
 * - se atenúa si el ojo está casi cerrado, si giras la cabeza o si miras claramente a otro lado
 *   (no se inventa una mirada que no existe);
 * - solo se mueve el iris dentro del contorno del ojo, con borde suave y color de esclera real.
 * `state` guarda el suavizado entre fotogramas. Devuelve {nx, ny, w} para diagnóstico.
 */
export function applyGaze(ctx, lm, W, H, strength, scratch, state = {}) {
  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const eyes = [EYES.left, EYES.right].map((eye) => {
    const c = P(eye.iris[0]);
    const ring = eye.iris.slice(1).map(P);
    const r = ring.reduce((t, p) => t + Math.hypot(p.x - c.x, p.y - c.y), 0) / ring.length;
    const [ca, cb] = eye.corners.map(P);
    const [up, lo] = eye.lids.map(P);
    const eyeW = Math.hypot(cb.x - ca.x, cb.y - ca.y);
    const open = Math.hypot(lo.x - up.x, lo.y - up.y);
    return { eye, c, r, ca, cb, up, lo, eyeW, open, midX: (ca.x + cb.x) / 2, midY: (up.y + lo.y) / 2 - open * 0.06 };
  });
  if (eyes.some((e) => e.eyeW < 10 || e.r < 2)) return null;

  // Ojos abiertos (se atenúa al cerrarse) y cabeza de frente.
  // Al leer, los párpados bajan: solo un parpadeo real (ojo casi cerrado) anula la corrección.
  const openW = Math.min(...eyes.map((e) => smooth01((e.open / e.r - 0.5) / 0.4)));
  const eyeDist = Math.hypot(P(263).x - P(33).x, P(263).y - P(33).y);
  const nose = P(1);
  const yaw = Math.abs((nose.x - (P(263).x + P(33).x) / 2) / eyeDist);
  const yawW = 1 - smooth01((yaw - 0.18) / 0.25);
  // Desvío medido en diámetros de iris; si es muy grande, la persona mira a otro lado a propósito.
  const need = eyes.map((e) => ({ x: (e.midX - e.c.x) / e.eyeW, y: (e.midY - e.c.y) / e.eyeW }));
  const nx = (need[0].x + need[1].x) / 2;
  const ny = (need[0].y + need[1].y) / 2;
  const mag = Math.hypot(nx, ny) / ((eyes[0].r + eyes[1].r) / (eyes[0].eyeW + eyes[1].eyeW));
  const farW = 1 - smooth01((mag - 1.8) / 1.2);
  const tinyW = smooth01((mag - 0.1) / 0.3); // desvíos diminutos no se tocan

  // Suavizado temporal; durante un parpadeo se conserva el último valor.
  const hold = openW < 0.05;
  if (state.nx === undefined) {
    state.nx = nx;
    state.ny = ny;
  } else if (!hold) {
    state.nx += (nx - state.nx) * 0.35;
    state.ny += (ny - state.ny) * 0.35;
  }
  const w = Math.min(openW, yawW, farW) * tinyW * strength;
  state.lastW = state.lastW === undefined ? w : state.lastW + (w - state.lastW) * 0.4;
  if (state.lastW < 0.02) return { nx: state.nx, ny: state.ny, w: state.lastW, openW, yawW, farW, tinyW, mag };

  for (const e of eyes) {
    const { c, r, ca, cb, eye } = e;
    let dx = state.nx * e.eyeW * 0.9 * state.lastW;
    let dy = state.ny * e.eyeW * state.lastW;
    const len = Math.hypot(dx, dy);
    const maxShift = r * 0.8;
    if (len < 0.3) continue;
    if (len > maxShift) {
      dx *= maxShift / len;
      dy *= maxShift / len;
    }
    const pr = r * 1.2;
    const size = Math.max(4, Math.ceil(pr * 2));
    if (scratch.width !== size || scratch.height !== size) {
      scratch.width = size;
      scratch.height = size;
    }
    const sc = scratch.getContext('2d');
    sc.clearRect(0, 0, size, size);
    sc.globalCompositeOperation = 'source-over';
    sc.drawImage(ctx.canvas, c.x - pr, c.y - pr, size, size, 0, 0, size, size);
    const mask = sc.createRadialGradient(size / 2, size / 2, r * 0.92, size / 2, size / 2, pr);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    sc.globalCompositeOperation = 'destination-in';
    sc.fillStyle = mask;
    sc.fillRect(0, 0, size, size);
    sc.globalCompositeOperation = 'source-over';
    // Color del blanco del ojo, entre el iris y cada comisura.
    const s1 = sampleColor(ctx, c.x + (ca.x - c.x) * 0.62, c.y + (ca.y - c.y) * 0.62);
    const s2 = sampleColor(ctx, c.x + (cb.x - c.x) * 0.62, c.y + (cb.y - c.y) * 0.62);
    const scl = s1.map((v, i) => Math.round((v + s2[i]) / 2));
    ctx.save();
    ctx.beginPath();
    eye.contour.forEach((i, k) => {
      const p = P(i);
      if (k) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.clip();
    const g = ctx.createRadialGradient(c.x, c.y, r * 0.6, c.x, c.y, r * 1.15);
    g.addColorStop(0, `rgba(${scl},1)`);
    g.addColorStop(1, `rgba(${scl},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(c.x - r * 1.3, c.y - r * 1.3, r * 2.6, r * 2.6);
    ctx.drawImage(scratch, c.x - pr + dx, c.y - pr + dy);
    ctx.restore();
  }
  return { nx: state.nx, ny: state.ny, w: state.lastW, openW, yawW, farW, tinyW, mag };
}

export class FxPipeline {
  constructor({ maxSide = 1280, temporal = 0.45 } = {}) {
    this.maxSide = maxSide;
    this.temporal = temporal;
    this.work = mkCanvas(2, 2);
    this.out = mkCanvas(2, 2);
    this.person = mkCanvas(2, 2);
    this.maskC = mkCanvas(2, 2);
    this.small = mkCanvas(2, 2);
    this.scratch = mkCanvas(4, 4);
    this.bgCache = { key: '', canvas: mkCanvas(2, 2) };
    this.grader = new Grader();
    this.prev = null;
    this.lastFace = null;
    this.frame = 0;
    this.faceEvery = 1; // cara en cada cuadro: con puntos de un cuadro anterior el iris quedaría desfasado
  }

  reset() {
    this.prev = null;
    this.lastFace = null;
  }

  async prepare(project) {
    const n = fxNeeds(project);
    const jobs = [];
    if (n.seg) jobs.push(ensure(n.hq ? 'seg-hq' : 'seg-fast'));
    if (n.face) jobs.push(ensure('face'));
    await Promise.all(jobs);
    return n;
  }

  _size(c, w, h) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  _bg(W, H, bg, assets, brand) {
    const key = `${bg.mode}|${bg.scene}|${bg.gradient}|${bg.color}|${bg.imageId}|${W}x${H}|${brand?.primary}|${brand?.secondary}`;
    const cache = this.bgCache;
    if (cache.key === key) return cache.canvas;
    this._size(cache.canvas, W, H);
    const ctx = cache.canvas.getContext('2d');
    if (bg.mode === 'color') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, W, H);
    } else if (bg.mode === 'scene') {
      drawScene(ctx, W, H, bg.scene || 'calido');
    } else if (bg.mode === 'image' && assets?.bgImage) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      drawCover(ctx, assets.bgImage, W, H);
    } else {
      drawGradientBg(ctx, W, H, bg.gradient, brand);
    }
    cache.key = key;
    return cache.canvas;
  }

  _mask(a, edge, strict = 0) {
    const { w, h, alpha } = a;
    if (!this.prev || this.prev.length !== alpha.length) this.prev = alpha.slice();
    const k = this.temporal;
    const spread = 0.08 + edge * 0.3;
    const mid = 0.5 + strict * 0.25; // recorte más estricto: exige más confianza para conservar un píxel
    const lo = mid - spread;
    const hi = mid + spread;
    this._size(this.maskC, w, h);
    const mctx = this.maskC.getContext('2d');
    const img = mctx.createImageData(w, h);
    const d = img.data;
    const prev = this.prev;
    for (let i = 0; i < alpha.length; i++) {
      const v = prev[i] * k + alpha[i] * (1 - k);
      prev[i] = v;
      let t = (v - lo) / (hi - lo);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
    mctx.putImageData(img, 0, 0);
    return this.maskC;
  }

  /**
   * source: video/canvas/VideoFrame de sw×sh. Devuelve un canvas procesado (mismo aspecto)
   * o el propio source si no hay nada que aplicar.
   */
  process(source, sw, sh, project, { assets, brand } = {}) {
    const fx = project.fx || DEFAULT_FX;
    const n = fxNeeds(project);
    if (!n.any || !sw || !sh) return { image: source, face: null };
    const s = Math.min(1, this.maxSide / Math.max(sw, sh));
    const W = Math.max(2, Math.round(sw * s));
    const H = Math.max(2, Math.round(sh * s));
    this._size(this.work, W, H);
    const wctx = this.work.getContext('2d', { willReadFrequently: n.face && fx.gaze?.enabled });
    wctx.globalCompositeOperation = 'source-over';
    wctx.drawImage(source, 0, 0, W, H);
    this.frame++;

    let face = null;
    if (n.face) {
      if (this.frame % this.faceEvery === 0 || !this.lastFace) {
        try {
          face = detectFace(this.work);
        } catch (e) {
          console.warn(e);
        }
        this.lastFace = face;
      } else face = this.lastFace;
      if (fx.gaze?.enabled && face?.found) applyGaze(wctx, face.landmarks, W, H, clamp(fx.gaze.strength, 0, 1), this.scratch, (this.gazeState ||= {}));
    }

    let img = this.work;
    if (n.seg) {
      let a = null;
      try {
        a = personAlpha(this.work, n.hq);
      } catch (e) {
        console.warn(e);
      }
      if (a && face?.found && fx.bg.mode !== 'blur') bodyEnvelope(a, face, fx.bg.body ?? 2);
      if (a) {
        const mask = this._mask(a, clamp(fx.bg.edge ?? 0.5, 0, 1), clamp(fx.bg.strict ?? 0, 0, 1));
        this._size(this.person, W, H);
        const pctx = this.person.getContext('2d');
        pctx.globalCompositeOperation = 'source-over';
        pctx.clearRect(0, 0, W, H);
        pctx.drawImage(this.work, 0, 0);
        pctx.globalCompositeOperation = 'destination-in';
        pctx.imageSmoothingEnabled = true;
        pctx.imageSmoothingQuality = 'high';
        if (canFilter()) pctx.filter = `blur(${Math.max(0.5, W / 900)}px)`;
        pctx.drawImage(mask, 0, 0, W, H);
        pctx.filter = 'none';
        pctx.globalCompositeOperation = 'source-over';
        this._size(this.out, W, H);
        const octx = this.out.getContext('2d');
        octx.globalCompositeOperation = 'source-over';
        if (fx.bg.mode === 'blur') {
          const amount = clamp(fx.bg.blur ?? 16, 2, 60);
          if (canFilter()) {
            octx.filter = `blur(${(amount * W) / 1000}px)`;
            octx.drawImage(this.work, -W * 0.03, -H * 0.03, W * 1.06, H * 1.06);
            octx.filter = 'none';
          } else {
            const f = Math.max(8, Math.round(W / amount));
            this._size(this.small, f, Math.max(4, Math.round((f * H) / W)));
            const sctx = this.small.getContext('2d');
            sctx.drawImage(this.work, 0, 0, this.small.width, this.small.height);
            octx.imageSmoothingEnabled = true;
            octx.drawImage(this.small, 0, 0, W, H);
          }
        } else {
          octx.drawImage(this._bg(W, H, fx.bg, assets, brand), 0, 0);
        }
        octx.drawImage(this.person, 0, 0);
        img = this.out;
      }
    }

    if (n.grade) {
      const p = gradeParams(project.color, fx.light);
      const graded = this.grader.apply(img, W, H, p, face);
      if (graded) img = graded;
    }
    return { image: img, face };
  }
}
