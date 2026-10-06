// Exportación: reproduce la composición en un canvas oculto y la graba con MediaRecorder
// (MP4 en iPhone/Chrome recientes, WebM como alternativa). También genera portadas PNG.
import { Player } from './player.js';
import { pickMime, extFor } from './media.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Crear la sesión DENTRO del clic del usuario (iPhone exige ese gesto para reproducir con sonido).
 * Luego `run()` puede llamarse varias veces (un formato por llamada).
 */
export class ExportSession {
  constructor({ project, brand, assets, analysis, urlFor }) {
    if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador no permite exportar video (MediaRecorder no disponible).');
    this.baseProject = project;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'export-canvas';
    (document.getElementById('media-sink') || document.body).appendChild(this.canvas);
    this.player = new Player({
      project: structuredClone(project), brand, canvas: this.canvas, urlFor, assets, analysis, exportMode: true, audible: false,
    });
    this.player.unlock();
  }

  async run({ aspect, width, height, fps = 30, onProgress, isCancelled = () => false }) {
    const proj = structuredClone(this.baseProject);
    proj.layout.aspect = aspect;
    this.player.setProject(proj);
    this.player.applyAudio();
    this.canvas.width = width;
    this.canvas.height = height;
    await this.player.load();
    await this.player.seek(0);
    const mime = pickMime();
    const vStream = this.canvas.captureStream(fps);
    const aTracks = this.player.dest ? this.player.dest.stream.getAudioTracks() : [];
    const stream = new MediaStream([...vStream.getVideoTracks(), ...aTracks]);
    const opts = { videoBitsPerSecond: Math.round(width * height * fps * 0.13), audioBitsPerSecond: 160000 };
    if (mime) opts.mimeType = mime;
    const rec = new MediaRecorder(stream, opts);
    const chunks = [];
    rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    let blocked = false;
    const onBlocked = () => (blocked = true);
    const onTime = () => onProgress?.(this.player.total ? this.player.t / this.player.total : 0);
    this.player.addEventListener('blocked', onBlocked);
    this.player.addEventListener('time', onTime);
    let finished = false;
    const ended = new Promise((r) => this.player.addEventListener('ended', r, { once: true })).then(() => (finished = true));
    let cancelled = false;
    const cancelWatch = (async () => {
      while (!finished && !blocked) {
        if (isCancelled()) {
          cancelled = true;
          return;
        }
        await wait(200);
      }
    })();
    rec.start(1000);
    await this.player.play();
    await Promise.race([ended, cancelWatch]);
    if (cancelled || blocked) this.player.pause();
    await wait(150);
    rec.stop();
    await stopped;
    vStream.getTracks().forEach((t) => t.stop());
    this.player.removeEventListener('blocked', onBlocked);
    this.player.removeEventListener('time', onTime);
    if (blocked) throw new Error('El navegador bloqueó la reproducción. Vuelve a pulsar «Exportar».');
    if (cancelled) return null;
    onProgress?.(1);
    const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
    return { blob: new Blob(chunks, { type }), mime: type, ext: extFor(type), width, height, aspect };
  }

  destroy() {
    this.player.destroy();
    this.canvas.remove();
  }
}

/** Fotograma fijo (portada/miniatura) en PNG o JPEG. */
export async function renderStill({ project, brand, assets, urlFor, time, width, height, coverText = '', type = 'image/png' }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const player = new Player({ project: structuredClone(project), brand, canvas, urlFor, assets, withAudio: false });
  try {
    await player.load();
    player.sceneExtras = { coverText, hideCaptions: !!coverText };
    await player.seek(time);
    for (let i = 0; i < 20; i++) {
      const v = player.els[player.cur];
      if (!v || v.readyState >= 2) break;
      await wait(50);
    }
    player.draw();
    return await new Promise((r) => canvas.toBlob(r, type, 0.92));
  } finally {
    player.destroy();
  }
}
