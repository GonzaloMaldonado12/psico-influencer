// Grabación de pantalla (PC) con burbuja de cámara y micrófono; al terminar abre el editor.
import { h, icon, toast, toggle, segmented, slider } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, even } from '../lib/util.js';
import { addMedia, newProject, saveProject, getBrand, mediaUrl } from '../store.js';
import { pickMime, probeVideo, captureThumb, hasScreenCapture } from '../core/media.js';

function workerTicker(fps, cb) {
  const src = 'let id=null;onmessage=e=>{clearInterval(id);id=null;if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = cb;
  w.postMessage(1000 / fps);
  return () => {
    w.terminate();
    URL.revokeObjectURL(url);
  };
}

export default async function render(root, { go }) {
  if (!hasScreenCapture()) {
    root.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Grabar pantalla')),
      h('div', { class: 'empty' }, icon('screen', 36), h('h2', null, 'No disponible en este dispositivo'), h('p', null, 'La grabación de pantalla funciona en el PC con Chrome o Edge. En el iPhone usa la grabación de pantalla del Centro de control y luego «Importar video».'))
    );
    return;
  }
  const opts = { cam: true, pos: 'br', size: 0.26, circle: true, mic: true, sysAudio: true, ...(await db.getKV('screenOpts', {})) };
  const saveOpts = () => db.setKV('screenOpts', opts);
  let screen = null;
  let user = null;
  let recorder = null;
  let chunks = [];
  let recording = false;
  let start = 0;
  let timerId = 0;
  let stopTicker = null;
  let ac = null;
  let destroyed = false;

  const canvas = h('canvas', { class: 'screen-preview', width: 1280, height: 720, 'aria-label': 'Vista previa de la grabación', role: 'img' });
  const ctx = canvas.getContext('2d');
  const mkVideo = () => {
    const v = h('video', { playsinline: true, autoplay: true });
    v.muted = true;
    return v;
  };
  const screenVid = mkVideo();
  const camVid = mkVideo();
  const timer = h('span', { class: 'rec-timer' }, '0:00');
  const recBtn = h('button', { class: 'btn btn-rec', onclick: () => (recording ? stop() : startRec()) }, icon('record', 18), 'Grabar');

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, W, H);
    if (screenVid.readyState >= 2 && screenVid.videoWidth) {
      const s = Math.min(W / screenVid.videoWidth, H / screenVid.videoHeight);
      const dw = screenVid.videoWidth * s;
      const dh = screenVid.videoHeight * s;
      ctx.drawImage(screenVid, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#a0a0b4';
      ctx.font = '600 28px -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pulsa «Elegir pantalla» para empezar', W / 2, H / 2);
    }
    if (opts.cam && camVid.readyState >= 2 && camVid.videoWidth) {
      const size = Math.round(H * opts.size);
      const m = Math.round(H * 0.04);
      const x = opts.pos.includes('r') ? W - m - size : m;
      const y = opts.pos.includes('b') ? H - m - size : m;
      const vw = camVid.videoWidth;
      const vh = camVid.videoHeight;
      const side = Math.min(vw, vh);
      ctx.save();
      ctx.beginPath();
      if (opts.circle) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      else ctx.roundRect ? ctx.roundRect(x, y, size, size, size * 0.12) : ctx.rect(x, y, size, size);
      ctx.clip();
      ctx.translate(x + size, y);
      ctx.scale(-1, 1);
      ctx.drawImage(camVid, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
      ctx.restore();
      ctx.save();
      ctx.lineWidth = Math.max(3, size * 0.03);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      if (opts.circle) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      else ctx.rect(x, y, size, size);
      ctx.stroke();
      ctx.restore();
    }
  }

  function stopTracks(s) {
    s?.getTracks().forEach((t) => t.stop());
  }

  async function pickScreen() {
    stopTracks(screen);
    screen = null;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: opts.sysAudio });
    } catch (e) {
      if (e.name !== 'NotAllowedError') toast(`No se pudo capturar la pantalla: ${e.message}`, 'error');
      return false;
    }
    screenVid.srcObject = screen;
    await screenVid.play().catch(() => {});
    const track = screen.getVideoTracks()[0];
    track.addEventListener('ended', () => (recording ? stop() : null));
    const s = track.getSettings();
    const w = Math.min(1920, s.width || 1920);
    canvas.width = even(w);
    canvas.height = even(w * ((s.height || 1080) / (s.width || 1920)));
    return true;
  }

  async function ensureUser() {
    if (user || (!opts.cam && !opts.mic)) return;
    try {
      user = await navigator.mediaDevices.getUserMedia({
        video: opts.cam ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: opts.mic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      });
      if (opts.cam) {
        camVid.srcObject = user;
        await camVid.play().catch(() => {});
      }
    } catch (e) {
      toast(`Sin cámara/micrófono: ${e.message}`, 'error');
    }
  }

  async function startRec() {
    if (typeof MediaRecorder === 'undefined') return toast('Este navegador no puede grabar.', 'error');
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = AC ? new AC() : null;
    if (!screen && !(await pickScreen())) return;
    await ensureUser();
    const dest = ac?.createMediaStreamDestination();
    if (dest) {
      if (opts.mic && user?.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(user.getAudioTracks())).connect(dest);
      if (screen.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(dest);
    }
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...(dest ? dest.stream.getAudioTracks() : [])]);
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : { videoBitsPerSecond: 8e6 });
    chunks = [];
    recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    recorder.onstop = finish;
    recorder.start(1000);
    recording = true;
    start = performance.now();
    timer.classList.add('on');
    timerId = setInterval(() => (timer.textContent = fmtTime((performance.now() - start) / 1000)), 250);
    recBtn.replaceChildren(icon('pause', 18), 'Detener');
    toast('Grabando. Puedes cambiar de ventana; vuelve aquí para detener.', 'info', 4000);
  }

  function stop() {
    if (!recording) return;
    recording = false;
    clearInterval(timerId);
    timer.classList.remove('on');
    recBtn.replaceChildren(icon('record', 18), 'Grabar');
    recorder.stop();
  }

  async function finish() {
    const elapsed = (performance.now() - start) / 1000;
    const type = (recorder.mimeType || 'video/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    chunks = [];
    ac?.close().catch(() => {});
    ac = null;
    if (blob.size < 2000) return toast('La grabación está vacía.', 'error');
    const url = URL.createObjectURL(blob);
    const meta = { duration: elapsed, width: canvas.width, height: canvas.height };
    try {
      const m = await probeVideo(url);
      if (m.duration > 0.3) meta.duration = m.duration;
    } catch {
      /* duración medida */
    }
    URL.revokeObjectURL(url);
    const rec = await addMedia({ blob, name: 'Grabación de pantalla', kind: 'video', ...meta });
    const p = newProject({ title: `Pantalla ${new Date().toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, clips: [rec], aspect: '16:9', brand: await getBrand() });
    p.brand.lowerThird.enabled = false;
    p.thumb = await captureThumb(await mediaUrl(rec.id));
    await saveProject(p);
    if (!destroyed) go(`editor/${p.id}`);
  }

  stopTicker = workerTicker(30, draw);
  root.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Grabar pantalla'), h('p', { class: 'muted small' }, 'Tutoriales, demos y presentaciones con tu cara en una burbuja.')),
      h('div', { class: 'actions' }, timer)
    ),
    canvas,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => pickScreen() }, icon('screen', 18), 'Elegir pantalla'),
      recBtn
    ),
    h('div', { class: 'card' },
      toggle({ label: 'Mostrar mi cámara', checked: opts.cam, onChange: async (v) => { opts.cam = v; saveOpts(); if (v) { stopTracks(user); user = null; await ensureUser(); } } }),
      segmented({ label: 'Posición de la cámara', value: opts.pos, options: [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], onChange: (v) => { opts.pos = v; saveOpts(); } }),
      slider({ label: 'Tamaño de la cámara', value: opts.size, min: 0.12, max: 0.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { opts.size = v; saveOpts(); } }),
      toggle({ label: 'Burbuja redonda', checked: opts.circle, onChange: (v) => { opts.circle = v; saveOpts(); } }),
      toggle({ label: 'Micrófono', checked: opts.mic, onChange: (v) => { opts.mic = v; saveOpts(); stopTracks(user); user = null; } }),
      toggle({ label: 'Sonido del sistema/pestaña', hint: 'Marca «Compartir audio» al elegir la pantalla.', checked: opts.sysAudio, onChange: (v) => { opts.sysAudio = v; saveOpts(); } })
    )
  );
  ensureUser();

  return () => {
    destroyed = true;
    if (recording) stop();
    stopTicker?.();
    stopTracks(screen);
    stopTracks(user);
  };
}
