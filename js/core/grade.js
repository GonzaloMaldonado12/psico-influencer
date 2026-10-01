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
  vec2 q = v - 0.5;
  c *= 1.0 - u_vignette * dot(q, q) * 1.8;
  // Grano fino de cine: devuelve textura natural y evita el aspecto «plástico».
  if (u_grain > 0.0) {
    float n = hash(v * 1731.0 + u_seed) - 0.5;
    c += n * u_grain * 0.045 * (1.0 - abs(l - 0.5));
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

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
  return p;
}

export function isIdentity(p) {
  return (
    Math.abs(p.exposure) < 1e-3 && Math.abs(p.contrast - 1) < 1e-3 && Math.abs(p.saturation - 1) < 1e-3 &&
    Math.abs(p.temp) < 1e-3 && Math.abs(p.tint) < 1e-3 && p.faceBoost < 1e-3 && p.vignette < 1e-3 &&
    p.denoise < 1e-3 && p.sharpen < 1e-3 && p.grain < 1e-3
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
      for (const n of ['u_exposure', 'u_contrast', 'u_saturation', 'u_temp', 'u_tint', 'u_faceBoost', 'u_faceR', 'u_vignette', 'u_aspect', 'u_face', 'u_denoise', 'u_sharpen', 'u_grain', 'u_seed', 'u_texel']) {
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
