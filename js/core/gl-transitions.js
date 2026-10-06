// Transiciones GLSL de gl-transitions (MIT, vendor/gl-transitions) entre el último fotograma del tramo
// anterior (congelado en el corte) y el tramo que entra. Mismo resultado en la vista previa y al exportar.
import { GL_NAMES } from '../../vendor/gl-transitions/names.js';

export { GL_NAMES };

const ES = {
  fade: 'Fundido cruzado', crosswarp: 'Deformación cruzada', CrossZoom: 'Zoom cruzado', Dreamy: 'Ensueño', DreamyZoom: 'Ensueño con zoom',
  LinearBlur: 'Desenfoque lineal', directionalwarp: 'Deformación direccional', directionalwipe: 'Barrido direccional', wind: 'Viento',
  ripple: 'Ondas', cube: 'Cubo 3D', morph: 'Transformación', Swirl: 'Remolino', burn: 'Quemado suave', FilmBurn: 'Película quemada',
  DefocusBlur: 'Desenfoque de lente', Overexposure: 'Sobreexposición', circleopen: 'Círculo que abre', heart: 'Corazón', pixelize: 'Pixelado GL',
  dissolve: 'Disolver', fadegrayscale: 'Fundido a gris', fadecolor: 'Fundido a color', colorphase: 'Fase de color', ZoomInCircles: 'Círculos con zoom',
  SimpleZoom: 'Zoom simple', SimpleZoomOut: 'Alejar', zoomInOut: 'Acercar y alejar', doorway: 'Puerta', InvertedPageCurl: 'Página que se pasa',
  BookFlip: 'Libro', GlitchMemories: 'Glitch recuerdo', GlitchDisplace: 'Glitch desplazado', Mosaic: 'Mosaico', windowslice: 'Rebanadas',
  windowblinds: 'Persianas GL', wipeLeft: 'Barrido ←', wipeRight: 'Barrido →', wipeUp: 'Barrido ↑', wipeDown: 'Barrido ↓', Radial: 'Radial',
  angular: 'Angular', pinwheel: 'Molinete', kaleidoscope: 'Caleidoscopio', perlin: 'Ruido orgánico', WaterDrop: 'Gota de agua',
  tangentMotionBlur: 'Barrido con movimiento', squeeze: 'Apretar', Directional: 'Empuje GL', StaticFade: 'Estática', TVStatic: 'TV sin señal',
};

/** Etiqueta en español (o el nombre separado en palabras). */
export function glLabel(name) {
  return ES[name] || name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

/** Selección recomendada para videos sobrios (la que se ofrece primero y a Claude). */
export const GL_RECOMMENDED = ['fade', 'LinearBlur', 'crosswarp', 'directionalwarp', 'Dreamy', 'CrossZoom', 'DefocusBlur', 'Overexposure', 'wind', 'ripple', 'burn', 'morph'];

let LIB = null;
let loading = null;
export function loadGlTransitions() {
  if (LIB) return Promise.resolve(LIB);
  loading ||= fetch(new URL('../../vendor/gl-transitions/transitions.json', import.meta.url))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((j) => (LIB = j));
  return loading;
}

const VS = 'attribute vec2 p; varying vec2 _uv; void main(){ _uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const fsFor = (src) => `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv){ return texture2D(from, uv); }
vec4 getToColor(vec2 uv){ return texture2D(to, uv); }
${src}
void main(){ gl_FragColor = transition(_uv); }`;

export function parseValue(type, raw) {
  // Quita el constructor (vec2(…), ivec2(…)) para no leer el «2» del nombre como número.
  const nums = (String(raw).replace(/\b[biu]?vec[234]\s*\(/gi, '(').match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
  if (type === 'bool') return /true/.test(raw) ? 1 : 0;
  const n = { float: 1, int: 1, vec2: 2, ivec2: 2, vec3: 3, vec4: 4 }[type] || 1;
  const out = nums.slice(0, n);
  while (out.length < n) out.push(out[0] ?? 0);
  return out;
}

class GLTransitioner {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, antialias: false });
    this.progs = new Map();
    if (!this.gl) return;
    const gl = this.gl;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tex = [gl.createTexture(), gl.createTexture()];
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
  }

  program(name) {
    if (this.progs.has(name)) return this.progs.get(name);
    const def = LIB?.[name];
    const gl = this.gl;
    let entry = null;
    if (def && gl) {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      try {
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsFor(def.glsl)));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        const params = Object.entries(def.params || {}).map(([k, v]) => ({ loc: gl.getUniformLocation(prog, k), type: v.type, val: parseValue(v.type, v.value) }));
        entry = { prog, p: gl.getAttribLocation(prog, 'p'), from: gl.getUniformLocation(prog, 'from'), to: gl.getUniformLocation(prog, 'to'), progress: gl.getUniformLocation(prog, 'progress'), ratio: gl.getUniformLocation(prog, 'ratio'), params };
      } catch (e) {
        console.warn('Transición GL no disponible:', name, e.message);
      }
    }
    this.progs.set(name, entry);
    return entry;
  }

  /** Dibuja la transición y devuelve el canvas (o null si no se pudo). */
  render(name, from, to, progress, w, h) {
    const gl = this.gl;
    const P = gl && this.program(name);
    if (!P) return null;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(P.p);
    gl.vertexAttribPointer(P.p, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    [from, to].forEach((img, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    });
    gl.uniform1i(P.from, 0);
    gl.uniform1i(P.to, 1);
    gl.uniform1f(P.progress, progress);
    gl.uniform1f(P.ratio, w / h);
    for (const u of P.params) {
      if (!u.loc) continue;
      const v = u.val;
      if (u.type === 'float') gl.uniform1f(u.loc, v[0]);
      else if (u.type === 'int' || u.type === 'bool') gl.uniform1i(u.loc, v[0] | 0);
      else if (u.type === 'vec2') gl.uniform2f(u.loc, v[0], v[1]);
      else if (u.type === 'ivec2') gl.uniform2i(u.loc, v[0] | 0, v[1] | 0);
      else if (u.type === 'vec3') gl.uniform3f(u.loc, v[0], v[1], v[2]);
      else if (u.type === 'vec4') gl.uniform4f(u.loc, v[0], v[1], v[2], v[3]);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

// Estado del corte: último fotograma del tramo saliente.
let gt = null;
const snap = { from: null, to: null, t: -1 };
const canvasOf = (c, w, h) => {
  c ||= document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
};
// Resolución de trabajo (la transición dura < 1 s: no hace falta la resolución completa).
const workSize = (box) => {
  const k = Math.min(1, 720 / Math.max(1, box.w));
  return [Math.max(2, Math.round(box.w * k)), Math.max(2, Math.round(box.h * k))];
};

export function projectUsesGl(project) {
  if (String(project.layout?.transition || '').startsWith('gl:')) return true;
  for (const k in project.transitions || {}) if (String(project.transitions[k]?.kind || '').startsWith('gl:')) return true;
  return false;
}

/** Guarda el fotograma actual (zona `box` del canvas) como posible origen de la próxima transición. */
export function rememberFrame(ctx, box, t) {
  const [w, h] = workSize(box);
  snap.from = canvasOf(snap.from, w, h);
  snap.from.getContext('2d').drawImage(ctx.canvas, box.x, box.y, box.w, box.h, 0, 0, w, h);
  snap.t = t;
}

/**
 * Aplica la transición GL sobre la zona `box` (que ya tiene dibujado el tramo entrante).
 * cutT = instante del corte en la línea de tiempo. Devuelve true si se aplicó.
 */
export function applyGl(ctx, box, name, progress, cutT) {
  if (!LIB) {
    loadGlTransitions();
    return false;
  }
  if (!snap.from || !(snap.t <= cutT + 0.02 && snap.t >= cutT - 0.35)) return false;
  gt ||= new GLTransitioner();
  const [w, h] = workSize(box);
  snap.to = canvasOf(snap.to, w, h);
  snap.to.getContext('2d').drawImage(ctx.canvas, box.x, box.y, box.w, box.h, 0, 0, w, h);
  const out = gt.render(name, snap.from, snap.to, Math.min(1, Math.max(0, progress)), w, h);
  if (!out) return false;
  ctx.drawImage(out, 0, 0, w, h, box.x, box.y, box.w, box.h);
  return true;
}
