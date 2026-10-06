// Motor de reproducción: recorre los segmentos de la línea de tiempo con dos <video>
// alternos (A/B, el siguiente ya posicionado), mezcla voz + música con Web Audio y
// dibuja cada fotograma con renderFrame. Se usa para la vista previa y para exportar.
import { sfxBuffer, loadSfx } from './sfx.js';
import { buildSegments, locate } from './timeline.js';
import { buildCaptionIndex } from './captions.js';
import { renderFrame } from './render.js';
import { isSpeechAt } from './audio-analysis.js';
import { FxPipeline, fxNeeds } from './effects.js';
import { clamp } from '../lib/util.js';

const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;

function loadImg(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function workerTicker(fps, cb) {
  const src = 'let id=null;onmessage=e=>{clearInterval(id);id=null;if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = cb;
  return {
    start: () => w.postMessage(1000 / fps),
    stop: () => w.postMessage(0),
    destroy: () => {
      w.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

export class Player extends EventTarget {
  constructor({ project, brand, canvas, urlFor, assets = {}, analysis = {}, exportMode = false, audible = true, withAudio = true, fps = 30, fx = true }) {
    super();
    this.project = project;
    this.brand = brand;
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.urlFor = urlFor;
    this.assets = assets;
    this.analysis = analysis;
    this.exportMode = exportMode;
    this.audible = audible;
    this.withAudio = withAudio && !!AC;
    this.fps = fps;
    this.sceneExtras = {};
    this.t = 0;
    this.segIndex = 0;
    this.playing = false;
    this.advancing = false;
    this.cur = -1;
    this.elSeg = [-1, -1];
    this.elUrl = ['', ''];
    this.elReady = [Promise.resolve(), Promise.resolve()];
    this.prepToken = [0, 0];
    this.clipUrls = [];
    this.destroyed = false;
    this._lastMusicG = -1;
    this.fx = fx ? new FxPipeline({ maxSide: exportMode ? 1920 : 1080, temporal: 0.45 }) : null;
    this.ovEls = new Map();
    this.ovSources = new Map();

    const sink = document.getElementById('media-sink') || document.body;
    this.els = [0, 1].map(() => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.preload = 'auto';
      v.disableRemotePlayback = true;
      sink.appendChild(v);
      return v;
    });
    this.music = document.createElement('audio');
    this.music.loop = true;
    this.music.preload = 'auto';
    sink.appendChild(this.music);
    if (this.withAudio) this._setupAudio();
    else this.els.forEach((v) => (v.muted = true));
    this.rebuild();
  }

  get total() {
    return this.tl.total;
  }

  rebuild() {
    this.tl = buildSegments(this.project);
    this.capIndex = buildCaptionIndex(this.project);
    this.elSeg = [-1, -1];
    if (this.t > this.tl.total) this.t = this.tl.total;
  }

  /** Solo recalcula subtítulos (cambios de estilo o texto). */
  refreshCaptions() {
    this.capIndex = buildCaptionIndex(this.project);
  }

  setProject(p) {
    this.project = p;
    this.rebuild();
  }

  async load() {
    this.clipUrls = await Promise.all(this.project.clips.map((c) => this.urlFor(c.mediaId)));
    await this.setMusic();
    await Promise.all([this.prepareFx(), this.loadOverlays()]);
  }

  /** Carga los modelos de IA y la imagen de fondo que necesiten los efectos activos. */
  async prepareFx() {
    if (!this.fx) return;
    const bg = this.project.fx?.bg;
    if (bg?.mode === 'image' && bg.imageId) {
      if (this.assets.bgImageId !== bg.imageId) {
        const url = await this.urlFor(bg.imageId);
        this.assets.bgImage = url ? await loadImg(url) : null;
        this.assets.bgImageId = bg.imageId;
      }
    }
    if (fxNeeds(this.project).any) {
      try {
        await this.fx.prepare(this.project);
      } catch (e) {
        console.warn('Efectos de IA no disponibles', e);
        this.emit('fxerror');
      }
    }
    this.fx.reset();
  }

  /** Imágenes y videos de las capas (B-roll). */
  async loadOverlays() {
    const list = (this.project.overlays || []).filter((o) => o.kind === 'broll' && o.mediaId);
    const keep = new Set(list.map((o) => o.id));
    for (const [id, el] of this.ovEls) {
      if (!keep.has(id)) {
        el.pause?.();
        el.remove?.();
        this.ovEls.delete(id);
        this.ovSources.delete(id);
      }
    }
    for (const ov of list) {
      const url = await this.urlFor(ov.mediaId);
      if (!url) continue;
      const cur = this.ovEls.get(ov.id);
      if (cur && cur.dataset?.url === url) continue;
      let el;
      if (ov.mediaKind === 'video') {
        el = document.createElement('video');
        el.muted = true;
        el.playsInline = true;
        el.setAttribute('playsinline', '');
        el.preload = 'auto';
        el.src = url;
        (document.getElementById('media-sink') || document.body).appendChild(el);
      } else {
        el = await loadImg(url);
        if (!el) continue;
      }
      el.dataset && (el.dataset.url = url);
      this.ovEls.set(ov.id, el);
      this.ovSources.set(ov.id, el);
    }
    this._syncOverlays(true);
  }

  _syncOverlays(force = false) {
    if (!this.ovEls.size) return;
    for (const ov of this.project.overlays || []) {
      const el = this.ovEls.get(ov.id);
      if (!el || ov.mediaKind !== 'video') continue;
      const active = this.t >= ov.start && this.t < ov.end;
      const local = Math.max(0, this.t - ov.start + (ov.srcStart || 0));
      if (!active) {
        if (!el.paused) el.pause();
        continue;
      }
      if (this.playing) {
        if (el.paused) {
          try {
            el.currentTime = local;
          } catch {
            /* sin metadatos */
          }
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local;
      } else {
        if (!el.paused) el.pause();
        if (force || Math.abs(el.currentTime - local) > 0.05) {
          try {
            el.currentTime = local;
          } catch {
            /* sin metadatos */
          }
        }
      }
    }
  }

  /** Usa la salida de audio elegida en Ajustes (altavoces, audífonos, interfaz). */
  async _applyOutput() {
    try {
      const { db } = await import('../lib/db.js');
      const id = (await db.getKV('settings', {})).spkId;
      if (id && this.ac?.setSinkId) await this.ac.setSinkId(id);
    } catch {
      /* dispositivo ya no disponible: se usa el predeterminado */
    }
  }

  _setupAudio() {
    const ac = (this.ac = new AC());
    this._applyOutput();
    this.master = ac.createGain();
    this.voiceIn = ac.createGain();
    this.voiceGain = ac.createGain();
    this.musicGain = ac.createGain();
    this.musicGain.gain.value = 0;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85;
    const presence = ac.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    presence.gain.value = 3;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    const makeup = ac.createGain();
    makeup.gain.value = 1.5;
    hp.connect(presence);
    presence.connect(comp);
    comp.connect(makeup);
    this.enh = { input: hp, output: makeup };
    this.elGains = this.els.map((v) => {
      const s = ac.createMediaElementSource(v);
      const g = ac.createGain();
      g.gain.value = 0;
      s.connect(g);
      g.connect(this.voiceIn);
      return g;
    });
    ac.createMediaElementSource(this.music).connect(this.musicGain);
    this.voiceGain.connect(this.master);
    this.musicGain.connect(this.master);
    if (this.audible) this.master.connect(ac.destination);
    if (this.exportMode) {
      this.dest = ac.createMediaStreamDestination();
      this.master.connect(this.dest);
    }
    this.applyAudio();
  }

  /** Deja decodificados los sonidos reales del proyecto para que suenen sin demora. */
  preloadSfx() {
    if (this.ac && this.project.audio.sfx?.length) loadSfx(this.ac, this.project.audio.sfx);
  }

  applyAudio() {
    this.preloadSfx();
    if (!this.ac) return;
    const A = this.project.audio;
    try {
      this.voiceIn.disconnect();
    } catch {
      /* sin conexiones */
    }
    try {
      this.enh.output.disconnect();
    } catch {
      /* sin conexiones */
    }
    if (A.enhance) {
      this.voiceIn.connect(this.enh.input);
      this.enh.output.connect(this.voiceGain);
    } else this.voiceIn.connect(this.voiceGain);
    this.voiceGain.gain.value = A.voiceVol;
    this._lastMusicG = -1;
  }

  async setMusic() {
    const id = this.project.audio.musicId;
    const url = id ? await this.urlFor(id) : null;
    if (url) {
      if (this.musicUrl !== url) {
        this.music.src = url;
        this.musicUrl = url;
      }
    } else if (this.musicUrl) {
      this.music.pause();
      this.music.removeAttribute('src');
      this.music.load();
      this.musicUrl = null;
    }
    this.hasMusic = !!url;
    this._lastMusicG = -1;
  }

  /**
   * Debe llamarse de forma síncrona dentro de un toque/clic: en iPhone concede permiso
   * de reproducción a cada elemento y activa el AudioContext.
   */
  unlock() {
    if (this.ac && this.ac.state !== 'running') this.ac.resume().catch(() => {});
    if (this.unlocked) return;
    this.unlocked = true;
    for (const el of [...this.els, this.music]) {
      try {
        const p = el.play();
        el.pause();
        p?.catch(() => {});
      } catch {
        /* ignorar */
      }
    }
  }

  _activate(k) {
    if (this.elGains) this.elGains.forEach((g, i) => (g.gain.value = i === k ? 1 : 0));
    else this.els.forEach((v, i) => (v.muted = !this.withAudio || i !== k));
  }

  _prepare(k, i, srcTime) {
    const seg = this.tl.segs[i];
    const v = this.els[k];
    const url = this.clipUrls[seg.clip];
    const target = srcTime ?? seg.src0;
    this.elSeg[k] = i;
    const token = ++this.prepToken[k];
    const p = new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        v.removeEventListener('seeked', finish);
        resolve();
      };
      const timer = setTimeout(finish, 5000);
      const doSeek = () => {
        if (token !== this.prepToken[k] || this.destroyed) return finish();
        v.addEventListener('seeked', finish);
        try {
          v.currentTime = target;
        } catch {
          finish();
        }
      };
      if (!url) return finish();
      if (this.elUrl[k] !== url) {
        this.elUrl[k] = url;
        v.addEventListener('loadedmetadata', doSeek, { once: true });
        v.src = url;
        v.load();
      } else if (v.readyState >= 1) doSeek();
      else v.addEventListener('loadedmetadata', doSeek, { once: true });
    });
    this.elReady[k] = p;
    return p;
  }

  _preloadNext() {
    const segs = this.tl.segs;
    let j = this.segIndex + 1;
    while (j < segs.length && segs[j].type !== 'video') j++;
    if (j >= segs.length || this.elSeg.includes(j)) return;
    const k = this.cur >= 0 ? 1 - this.cur : this.elSeg[0] === this.segIndex ? 1 : 0;
    this._prepare(k, j);
  }

  async _enterSegment(i, t) {
    const seg = this.tl.segs[i];
    this.segIndex = i;
    if (seg.type === 'video') {
      const src = seg.src0 + (t - seg.tlStart) * this.tl.speed;
      let k = this.elSeg.indexOf(i);
      if (k >= 0) await this.elReady[k];
      if (k < 0 || Math.abs(this.els[k].currentTime - src) > 0.08) {
        if (k < 0) k = this.cur >= 0 ? 1 - this.cur : 0;
        await this._prepare(k, i, src);
      }
      if (!this.playing || this.destroyed) return false;
      const v = this.els[k];
      this.cur = k;
      this._activate(k);
      v.playbackRate = this.tl.speed;
      try {
        await v.play();
      } catch (err) {
        console.warn('Reproducción bloqueada', err);
        this.playing = false;
        this._stopClock();
        this.emit('blocked');
        return false;
      }
      if (!this.playing) {
        v.pause();
        return false;
      }
    } else {
      if (this.cur >= 0) this.els[this.cur].pause();
      this.cur = -1;
      this._activate(-1);
      this.cardStart = performance.now() - (t - seg.tlStart) * 1000;
    }
    this._preloadNext();
    return true;
  }

  async play() {
    if (this.playing || this.destroyed || !this.tl.segs.length) return;
    this.unlock();
    if (this.t >= this.tl.total - 0.03) {
      this.t = 0;
      this.segIndex = 0;
    } else {
      this.segIndex = locate(this.tl, this.t).i;
    }
    this.playing = true;
    this.emit('play');
    const ok = await this._enterSegment(this.segIndex, this.t);
    if (!ok) return;
    this._startMusic();
    this._startClips();
    this._startClock();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this._stopClock();
    this.els.forEach((v) => v.pause());
    this.music.pause();
    this._stopClips();
    this._syncOverlays();
    this.emit('pause');
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  async seek(t) {
    if (this.destroyed) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.t = clamp(t, 0, this.tl.total);
    this.fx?.reset();
    const { i, seg } = locate(this.tl, this.t);
    if (i < 0) {
      this.draw();
      this.emit('time');
      return;
    }
    this.segIndex = i;
    if (seg.type === 'video') {
      let k = this.elSeg.indexOf(i);
      if (k < 0) k = this.cur >= 0 ? this.cur : 0;
      this.cur = k;
      await this._prepare(k, i, seg.src0 + (this.t - seg.tlStart) * this.tl.speed);
    }
    if (this.destroyed) return;
    this.draw();
    this.emit('time');
    if (wasPlaying) this.play();
  }

  /** Búsqueda al arrastrar: agrupa peticiones para no saturar el decodificador. */
  scrub(t) {
    this.pendingScrub = t;
    if (this.scrubbing) return;
    this.scrubbing = true;
    (async () => {
      while (this.pendingScrub != null && !this.destroyed) {
        const x = this.pendingScrub;
        this.pendingScrub = null;
        await this.seek(x);
      }
      this.scrubbing = false;
    })();
  }

  _tick() {
    if (!this.playing || this.advancing) return;
    const seg = this.tl.segs[this.segIndex];
    if (!seg) return this._finish();
    let t;
    if (seg.type === 'video') {
      const v = this.els[this.cur];
      if (!v) return;
      const s = v.currentTime;
      if (s >= seg.src1 - 0.02 || v.ended) {
        this._advance();
        return;
      }
      t = seg.tlStart + Math.max(0, s - seg.src0) / this.tl.speed;
    } else {
      t = seg.tlStart + (performance.now() - this.cardStart) / 1000;
      if (t >= seg.tlStart + seg.dur) {
        this._advance();
        return;
      }
    }
    const prevT = this.t;
    this.t = Math.min(t, seg.tlStart + seg.dur);
    this._tickSfx(prevT, this.t);
    this._updateMusic();
    this._syncOverlays();
    this.draw();
    this.emit('time');
  }

  async _advance() {
    this.advancing = true;
    const prev = this.tl.segs[this.segIndex];
    const next = this.segIndex + 1;
    if (next >= this.tl.segs.length) {
      this.advancing = false;
      this._finish();
      return;
    }
    if (prev.type === 'video' && this.cur >= 0) this.els[this.cur].pause();
    const nseg = this.tl.segs[next];
    this.t = nseg.tlStart;
    const ok = await this._enterSegment(next, nseg.tlStart);
    this.advancing = false;
    if (ok) {
      this.draw();
      this.emit('time');
    }
  }

  _finish() {
    this.playing = false;
    this._stopClock();
    this.els.forEach((v) => v.pause());
    this.music.pause();
    this._stopClips();
    this.t = this.tl.total;
    this.segIndex = Math.max(0, this.tl.segs.length - 1);
    this.draw();
    this.emit('time');
    this.emit('ended');
  }

  _startClock() {
    this._stopClock();
    if (this.exportMode) {
      this.ticker ||= workerTicker(this.fps, () => this._tick());
      this.ticker.start();
    } else {
      const loop = () => {
        if (!this.playing) return;
        this._tick();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
  }

  _stopClock() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ticker?.stop();
  }

  _musicPos(t) {
    const d = this.music.duration;
    const x = t + (this.project.audio.musicOffset || 0);
    return Number.isFinite(d) && d > 0 ? x % d : x;
  }

  /** Audios importados por el usuario (pista libre de la línea de tiempo). */
  _stopClips() {
    this._clipGen = (this._clipGen || 0) + 1;
    for (const s of this._clipSrc || []) {
      try {
        s.stop();
      } catch {
        /* ya detenido */
      }
    }
    this._clipSrc = [];
  }

  async _clipBuffer(mediaId) {
    this._clipBufs ||= new Map();
    if (!this._clipBufs.has(mediaId)) {
      this._clipBufs.set(mediaId, (async () => {
        try {
          const url = await this.urlFor(mediaId);
          return await this.ac.decodeAudioData(await (await fetch(url)).arrayBuffer());
        } catch {
          return null;
        }
      })());
    }
    return this._clipBufs.get(mediaId);
  }

  async _startClips() {
    this._stopClips();
    const list = this.project.audioClips;
    if (!this.ac || !list?.length) return;
    const gen = this._clipGen;
    for (const c of list) {
      if (c.end <= this.t) continue;
      const buf = await this._clipBuffer(c.mediaId);
      if (!buf || gen !== this._clipGen || !this.playing) return;
      const now = this.ac.currentTime;
      const startAbs = now + (c.start - this.t);
      const elapsed = Math.max(0, this.t - c.start);
      const off = (c.in || 0) + elapsed;
      if (off >= buf.duration) continue;
      const s = this.ac.createBufferSource();
      s.buffer = buf;
      const g = this.ac.createGain();
      const vol = c.vol ?? 1;
      const fi = c.fadeIn || 0;
      const fo = c.fadeOut || 0;
      const at = Math.max(now, startAbs);
      g.gain.setValueAtTime(fi > 0 ? vol * Math.min(1, elapsed / fi) : vol, at);
      if (fi > elapsed) g.gain.linearRampToValueAtTime(vol, at + (fi - elapsed));
      const endAbs = now + (c.end - this.t);
      if (fo > 0) {
        g.gain.setValueAtTime(vol, Math.max(at, endAbs - fo));
        g.gain.linearRampToValueAtTime(0, endAbs);
      }
      s.connect(g);
      g.connect(this.master);
      s.start(at, off, Math.max(0.02, c.end - Math.max(c.start, this.t)));
      this._clipSrc.push(s);
    }
  }

  _startMusic() {
    if (!this.hasMusic) return;
    try {
      this.music.currentTime = this._musicPos(this.t);
    } catch {
      /* aún sin metadatos */
    }
    this._lastMusicG = -1;
    this._updateMusic(true);
    this.music.play().catch(() => {});
  }

  _speaking() {
    const seg = this.tl.segs[this.segIndex];
    if (!seg || seg.type !== 'video') return false;
    const a = this.analysis[this.project.clips[seg.clip]?.mediaId];
    if (!a?.regions) return true;
    const v = this.els[this.cur];
    const s = v ? v.currentTime : seg.src0;
    return isSpeechAt(a.regions, s) || isSpeechAt(a.regions, s + 0.25);
  }

  /** Reproduce los efectos de sonido cuyo instante se cruzó entre dos lecturas (solo al avanzar). */
  _tickSfx(a, b) {
    const A = this.project.audio;
    if (!this.ac || A.sfxOn === false || !A.sfx?.length || b <= a || b - a > 0.5) return;
    for (const e of A.sfx) {
      if (e.t > a && e.t <= b) {
        const buf = sfxBuffer(this.ac, e.kind);
        if (!buf) {
          loadSfx(this.ac, A.sfx); // primera vez: se decodifica y suena la próxima
          continue;
        }
        const s = this.ac.createBufferSource();
        s.buffer = buf;
        const g = this.ac.createGain();
        g.gain.value = e.vol ?? 0.5;
        s.connect(g);
        g.connect(this.ac.destination);
        s.start();
      }
    }
  }

  _updateMusic(immediate = false) {
    if (!this.hasMusic || !this.ac) return;
    const A = this.project.audio;
    let g = A.musicVol;
    if (A.duck && this._speaking()) g *= 0.3;
    if (A.fade) g *= Math.min(clamp(this.t / 1, 0, 1), clamp((this.tl.total - this.t) / 2, 0, 1));
    if (!immediate && Math.abs(g - this._lastMusicG) < 0.004) return;
    this._lastMusicG = g;
    const p = this.musicGain.gain;
    if (immediate) {
      p.cancelScheduledValues(this.ac.currentTime);
      p.setValueAtTime(g, this.ac.currentTime);
    } else p.setTargetAtTime(g, this.ac.currentTime, 0.12);
  }

  currentSource() {
    const seg = this.tl.segs[this.segIndex];
    if (!seg || seg.type !== 'video') return null;
    const local = clamp(this.t - seg.tlStart, 0, seg.dur);
    return { clip: seg.clip, src: seg.src0 + local * this.tl.speed, seg };
  }

  draw() {
    if (this.destroyed) return;
    const seg = this.tl.segs[this.segIndex] || null;
    const local = seg ? clamp(this.t - seg.tlStart, 0, seg.dur) : 0;
    let video = null;
    let src = 0;
    if (seg && seg.type === 'video') {
      const v = this.cur >= 0 ? this.els[this.cur] : null;
      if (v && this.elSeg[this.cur] === this.segIndex) video = v;
      src = this.playing && video ? video.currentTime : seg.src0 + local * this.tl.speed;
    }
    if (!this.playing) this._syncOverlays();
    renderFrame(this.ctx2d, this.canvas.width, this.canvas.height, {
      project: this.project,
      brand: this.brand,
      t: this.t,
      total: this.tl.total,
      videoStart: this.tl.videoStart,
      seg,
      local,
      src,
      video,
      fx: this.fx,
      overlaySources: this.ovSources,
      nextIsVideo: this.tl.segs[this.segIndex + 1]?.type === 'video',
      capIndex: this.capIndex,
      assets: this.assets,
      ...this.sceneExtras,
    });
  }

  emit(name) {
    this.dispatchEvent(new Event(name));
  }

  destroy() {
    this.destroyed = true;
    this.playing = false;
    this._stopClock();
    this.ticker?.destroy();
    const ovVideos = [...this.ovEls.values()].filter((e) => e instanceof HTMLVideoElement);
    for (const el of [...this.els, this.music, ...ovVideos]) {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {
        /* ignorar */
      }
      el.remove();
    }
    this.ac?.close().catch(() => {});
  }
}
