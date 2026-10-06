// Corrección de color por GPU (WebGL): exposición, contraste, saturación, temperatura,
// tinte, luz en el rostro y viñeta. Funciona igual en PC y iPhone.

const VS = `attribute vec2 p; varying vec2 v;
void main(){ v = vec2((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D u_tex;
uniform float u_exposure, u_contrast, u_saturation, u_temp, u_tint, u_faceBoost, u_faceR, u_vignette, u_aspect;
uniform float u_denoise, u_sharpen, u_grain, u_seed;
uniform vec2 u_face, u_texel;
uniform sampler2D u_lut;
uniform float u_lutN, u_lutAmt;
// LUT 3D (.cube) guardado como tira 2D (N cortes de N×N): interpolación trilineal manual (WebGL 1).
vec3 lut3(vec3 c){
  float n = u_lutN;
  float b = clamp(c.b, 0.0, 1.0) * (n - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, n - 1.0);
  vec2 rg = clamp(c.rg, 0.0, 1.0) * (n - 1.0) + 0.5;
  vec3 a = texture2D(u_lut, vec2((rg.x + b0 * n) / (n * n), rg.y / n)).rgb;
  vec3 d = texture2D(u_lut, vec2((rg.x + b1 * n) / (n * n), rg.y / n)).rgb;
  return mix(a, d, b - b0);
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec3 c = texture2D(u_tex, v).rgb;
  // Limpieza de ruido que respeta bordes (bilateral 3x3): quita el ruido de la webcam sin aplastar la piel.
  vec3 mean = c;
  if (u_denoise > 0.0 || u_sharpen > 0.0) {
    float sig = 0.04 + u_denoise * 0.10;
    vec3 acc = c; float wsum = 1.0; vec3 box = c;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        if (i == 0 && j == 0) continue;
        vec3 s = texture2D(u_tex, v + vec2(float(i), float(j)) * u_texel).rgb;
        vec3 d = s - c;
        float w = exp(-dot(d, d) / (6.0 * sig * sig)) * ((i == 0 || j == 0) ? 1.0 : 0.7);
        acc += s * w; wsum += w; box += s;
      }
    }
    mean = box / 9.0;
    if (u_denoise > 0.0) c = mix(c, acc / wsum, min(1.0, u_denoise * 1.6));
  }
  // Nitidez natural: realza solo los bordes que sobreviven a la limpieza (no el ruido), sin halos.
  if (u_sharpen > 0.0) {
    float dl = luma(c) - luma(mean);
    c += clamp(dl * u_sharpen * 1.8, -0.05, 0.05) * smoothstep(0.006, 0.03, abs(dl));
  }
  c *= pow(2.0, u_exposure);
  c *= vec3(1.0 + u_temp * 0.12, 1.0 + u_tint * 0.06, 1.0 - u_temp * 0.12);
  vec2 d2 = v - u_face; d2.x *= u_aspect;
  c *= 1.0 + u_faceBoost * exp(-dot(d2, d2) / max(0.0001, u_faceR * u_faceR));
  c = (c - 0.5) * u_contrast + 0.5;
  // Hombro suave en luces altas: la piel y la lámpara no se queman de golpe.
  float l = luma(c);
  if (l > 0.78) { float k = l - 0.78; c *= (0.78 + k / (1.0 + k * 2.2)) / l; }
  l = luma(c);
  c = mix(vec3(l), c, u_saturation);
  if (u_lutAmt > 0.0) { c = clamp(c, 0.0, 1.0); c = mix(c, lut3(c), u_lutAmt); l = luma(c); }
  vec2 q = v - 0.5;
  c *= 1.0 - u_vignette * dot(q, q) * 1.8;
  // Grano fino de cine: devuelve textura natural y evita el aspecto «plástico».
  if (u_grain > 0.0) {
    float n = hash(v * 1731.0 + u_seed) - 0.5;
    c += n * u_grain * 0.045 * (1.0 - abs(l - 0.5));
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// ---------- LUTs .cube (carpeta «Material» del PC) ----------
const LUTS = new Map(); // ruta → { n, data } | 'cargando' | 'error'

/** Lee un .cube 3D y lo convierte en tira RGBA (ancho N·N, alto N). */
export function parseCube(text) {
  let n = 0;
  const vals = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(t);
    if (m) { n = Number(m[1]); continue; }
    if (/^[A-Z_]/i.test(t)) continue;
    const p = t.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every((x) => Number.isFinite(x))) vals.push(p[0], p[1], p[2]);
  }
  if (!n || vals.length < n * n * n * 3) throw new Error('LUT .cube no válido');
  const data = new Uint8Array(n * n * n * 4);
  for (let i = 0; i < n * n * n; i++) {
    const r = i % n;
    const g = Math.floor(i / n) % n;
    const b = Math.floor(i / (n * n));
    const o = (g * n * n + b * n + r) * 4;
    data[o] = Math.round(Math.min(1, Math.max(0, vals[i * 3])) * 255);
    data[o + 1] = Math.round(Math.min(1, Math.max(0, vals[i * 3 + 1])) * 255);
    data[o + 2] = Math.round(Math.min(1, Math.max(0, vals[i * 3 + 2])) * 255);
    data[o + 3] = 255;
  }
  return { n, data };
}

/** Carga (una vez) el LUT de la ruta del Material. Devuelve true si quedó listo. */
export async function loadLut(ruta) {
  if (!ruta) return false;
  const have = LUTS.get(ruta);
  if (have && typeof have === 'object') return true;
  if (have === 'error') return false;
  LUTS.set(ruta, 'cargando');
  try {
    const r = await fetch(`/material/f/${String(ruta).split('/').map(encodeURIComponent).join('/')}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    LUTS.set(ruta, parseCube(await r.text()));
    return true;
  } catch (e) {
    console.warn('LUT', ruta, e);
    LUTS.set(ruta, 'error');
    return false;
  }
}

export const IDENTITY = { exposure: 0, contrast: 1, saturation: 1, temp: 0, tint: 0, faceBoost: 0, vignette: 0, denoise: 0, sharpen: 0, grain: 0 };

/** Mejora natural de cámara activada por defecto (sin alisar la piel ni deformar nada). */
export const NATURAL = { denoise: 0.45, sharpen: 0.4, grain: 0.3 };

export const LOOKS = {
  none: { label: 'Original' },
  vivido: { label: 'Vívido', saturation: 1.35, contrast: 1.08 },
  calido: { label: 'Cálido', temp: 0.35, saturation: 1.08, exposure: 0.04 },
  frio: { label: 'Frío', temp: -0.35, saturation: 0.95, exposure: 0.04 },
  bn: { label: 'B/N', saturation: 0, contrast: 1.12 },
  cine: { label: 'Cine', contrast: 1.15, saturation: 0.85, temp: 0.1, vignette: 0.25 },
  suave: { label: 'Suave', contrast: 0.92, exposure: 0.08, saturation: 0.95 },
  consulta: { label: 'Consulta', temp: 0.18, contrast: 0.96, saturation: 0.98, exposure: 0.05, vignette: 0.15 },
};

/** Combina el look, los deslizadores de color y la iluminación IA en parámetros finales. */
export function gradeParams(color = {}, light = {}) {
  const look = LOOKS[color.preset] || LOOKS.none;
  const p = { ...IDENTITY };
  p.exposure = (look.exposure || 0) + Math.log2(color.brightness || 1) + (light.exposure || 0);
  p.contrast = (look.contrast ?? 1) * (color.contrast ?? 1) * (light.contrast ?? 1);
  p.saturation = (look.saturation ?? 1) * (color.saturation ?? 1) * (light.saturation ?? 1);
  p.temp = (look.temp || 0) + (color.temp || 0) + (light.temp || 0);
  p.tint = (look.tint || 0) + (color.tint || 0) + (light.tint || 0);
  p.faceBoost = light.faceBoost || 0;
  p.vignette = Math.max(look.vignette || 0, color.vignette || 0, light.vignette || 0);
  p.denoise = color.denoise ?? NATURAL.denoise;
  p.sharpen = color.sharpen ?? NATURAL.sharpen;
  p.grain = color.grain ?? NATURAL.grain;
  p.lut = color.lut || '';
  p.lutAmt = color.lut ? (color.lutAmt ?? 1) : 0;
  return p;
}

export function isIdentity(p) {
  return (
    Math.abs(p.exposure) < 1e-3 && Math.abs(p.contrast - 1) < 1e-3 && Math.abs(p.saturation - 1) < 1e-3 &&
    Math.abs(p.temp) < 1e-3 && Math.abs(p.tint) < 1e-3 && p.faceBoost < 1e-3 && p.vignette < 1e-3 &&
    p.denoise < 1e-3 && p.sharpen < 1e-3 && p.grain < 1e-3 && !(p.lutAmt > 0)
  );
}

export class Grader {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, antialias: false });
    this.gl = gl;
    this._seed = 0;
    this.ok = !!gl && this._init();
  }

  _init() {
    const gl = this.gl;
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
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.u = {};
      this.lutTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      this.lutKey = '';
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      for (const n of ['u_lut', 'u_lutN', 'u_lutAmt', 'u_exposure', 'u_contrast', 'u_saturation', 'u_temp', 'u_tint', 'u_faceBoost', 'u_faceR', 'u_vignette', 'u_aspect', 'u_face', 'u_denoise', 'u_sharpen', 'u_grain', 'u_seed', 'u_texel']) {
        this.u[n] = gl.getUniformLocation(prog, n);
      }
      return true;
    } catch (e) {
      console.warn('WebGL de color no disponible', e);
      return false;
    }
  }

  /** Devuelve un canvas w×h con el color aplicado (o null si WebGL no está disponible). */
  apply(source, w, h, p, face) {
    if (!this.ok) return null;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    // LUT: se sube a la GPU solo cuando cambia; mientras carga, el fotograma sale sin LUT.
    const lut = p.lutAmt > 0 ? LUTS.get(p.lut) : null;
    if (p.lutAmt > 0 && !lut) loadLut(p.lut);
    const useLut = lut && typeof lut === 'object';
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    if (useLut && this.lutKey !== p.lut) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.n * lut.n, lut.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
      this.lutKey = p.lut;
    }
    gl.uniform1i(this.u.u_lut, 1);
    gl.uniform1f(this.u.u_lutN, useLut ? lut.n : 2);
    gl.uniform1f(this.u.u_lutAmt, useLut ? Math.min(1, Math.max(0, p.lutAmt)) : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (e) {
      console.warn('No se pudo subir el fotograma a la GPU', e);
      return null;
    }
    const u = this.u;
    gl.uniform1f(u.u_exposure, p.exposure);
    gl.uniform1f(u.u_contrast, p.contrast);
    gl.uniform1f(u.u_saturation, p.saturation);
    gl.uniform1f(u.u_temp, p.temp);
    gl.uniform1f(u.u_tint, p.tint);
    gl.uniform1f(u.u_vignette, p.vignette);
    gl.uniform1f(u.u_aspect, w / h);
    gl.uniform1f(u.u_denoise, p.denoise || 0);
    gl.uniform1f(u.u_sharpen, p.sharpen || 0);
    gl.uniform1f(u.u_grain, p.grain || 0);
    gl.uniform1f(u.u_seed, (this._seed = (this._seed + 1) % 97) * 0.37);
    gl.uniform2f(u.u_texel, 1 / w, 1 / h);
    const hasFace = face?.found && p.faceBoost > 0;
    gl.uniform1f(u.u_faceBoost, hasFace ? p.faceBoost : 0);
    gl.uniform2f(u.u_face, hasFace ? face.center.x : 0.5, hasFace ? face.center.y : 0.4);
    gl.uniform1f(u.u_faceR, hasFace ? Math.max(0.08, face.size * 0.75) : 0.3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
