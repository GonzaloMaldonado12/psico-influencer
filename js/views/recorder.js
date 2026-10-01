// Estudio de grabación con teleprompter (PC y celular). En el celular es la pantalla principal:
// cámara, guion que baja (fijo, siguiendo tu voz o reconociendo palabras), modo mirada, revisión
// de luz, lentes y linterna, tomas a prueba de cortes y guardado en Fotos con la mirada corregida.
import { h, icon, toast, modal, slider, toggle, segmented, select, textInput } from '../lib/dom.js';
import { lockCamera, lockSummary, monoMic, resetAuto } from '../core/camera-pro.js';
import { db } from '../lib/db.js';
import { fmtTime, splitWords, clamp, IS_MOBILE, IS_IOS, MOBILE_APP, uid, fmtBytes } from '../lib/util.js';
import {
  getSettings, saveSettings, addMedia, deleteMedia, newProject, saveProject, getBrand, migrateProject, clipFrom, mediaUrl, ASPECTS,
} from '../store.js';
import { pickMime, probeVideo, captureThumb, speechRecognitionCtor, hasCamera } from '../core/media.js';
import { ScriptFollower } from '../core/follow.js';
import { PaceTracker, rmsDb } from '../core/voice-pace.js';
import { TakeWriter, recoverTakes } from '../core/take-store.js';
import { scriptStats } from '../core/script-tools.js';
import { saveBox } from './take-actions.js';

const MODE_HINT = {
  fijo: 'El texto baja a velocidad constante.',
  voz: 'El texto avanza mientras hablas y te espera en las pausas. Funciona sin internet.',
  palabras: 'Reconoce lo que dices y te sigue palabra por palabra (servicio de voz de Google).',
};

export default async function render(root, { query, go }) {
  const settings = await getSettings();
  const P = settings.prompter;
  const SR = speechRecognitionCtor();
  // El reconocimiento de palabras solo funciona de verdad en Chrome (no en iPhone, ni en el programa de PC, ni en el WebView de Android).
  const canWords = !!SR && !IS_IOS && !window.psicoDesktop && !window.AndroidBridge;
  if (!P.mode) P.mode = P.voiceFollow && canWords ? 'palabras' : IS_MOBILE ? 'voz' : 'fijo'; // en PC parte con velocidad fija: el texto siempre baja
  if (P.mode === 'palabras' && !canWords) P.mode = 'voz';
  if (MOBILE_APP) settings.naturalAudio ??= true;

  const existing = query.project ? migrateProject(await db.get('projects', query.project)) : null;
  let script = query.script ? await db.get('scripts', query.script) : null;
  if (!script && !existing) {
    const lastId = await db.getKV('lastScript', null);
    if (lastId) script = (await db.get('scripts', lastId)) || null;
  }
  if (script) db.setKV('lastScript', script.id).catch(() => {});
  let scriptText = script?.text || existing?.scriptText || '';
  let aspect = existing?.layout.aspect || (await db.getKV('lastAspect', '9:16'));
  let grid = await db.getKV('recGrid', false);
  let facing = 'user';
  let camId = settings.camId || null;
  let micId = settings.micId || null;
  let stream = null;
  let recorder = null;
  let writer = null;
  let recording = false;
  let recStart = 0;
  let timerId = 0;
  let hints = [];
  let countdown = null;
  let destroyed = false;
  let finished = false;
  let wakeLock = null;
  let torchOn = false;
  let hiddenStop = false;
  const takes = [];

  // ---------- DOM ----------
  const video = h('video', { class: 'rec-preview', autoplay: true, playsinline: true, 'aria-label': 'Vista de cámara' });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const frame = h('div', { class: 'rec-frame' });
  const guides = h('div', { class: 'rec-guides' }, frame);

  const promptText = h('div', { class: 'prompter-text' });
  const readLine = h('div', { class: 'prompter-line' });
  const view = h('div', { class: 'prompter-view' }, promptText, readLine);
  const restartBtn = h('button', { class: 'prompter-restart', 'aria-label': 'Volver al inicio del guion', title: 'Volver al inicio', onclick: () => tpRestart() }, icon('restart', 18));
  const handle = h('div', { class: 'prompter-handle', 'aria-hidden': 'true' }, h('i'));
  const emptyCard = h('div', { class: 'prompter-empty hidden' },
    h('b', null, 'Elige qué vas a decir'),
    h('span', null, 'El texto bajará junto a la cámara para que mires al lente.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm btn-primary', onclick: () => openScriptSheet() }, icon('script', 16), 'Elegir guion'),
      h('button', { class: 'btn btn-sm', onclick: () => editScript(null) }, icon('edit', 16), 'Escribir')
    )
  );
  const prompter = h('div', { class: 'prompter', role: 'region', 'aria-label': 'Teleprompter: toca para pausar, arrastra para mover el texto, pellizca para cambiar el tamaño' }, view, restartBtn, handle, emptyCard);
  for (const el of [restartBtn, handle, emptyCard]) el.addEventListener('pointerdown', (e) => e.stopPropagation());

  const timer = h('span', { class: 'rec-timer' }, '0:00');
  const meterFill = h('i');
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, meterFill);
  const waitChip = h('div', { class: 'wait-chip hidden', role: 'status' }, icon('wave', 16), 'Te espero: el texto sigue cuando hablas');
  const recBtn = h('button', { class: 'rec-btn', 'aria-label': 'Empezar a grabar', onclick: () => onRecBtn() }, h('span'));
  const tpBtn = h('button', { class: 'icon-btn round', 'aria-label': 'Reproducir teleprompter', onclick: () => tpToggle() }, icon('play'));
  const speedOut = h('button', { class: 'speed-val', 'aria-label': 'Ajustar velocidad del texto', title: 'Velocidad del texto', onclick: () => speedPop.classList.toggle('hidden') }, settings.wpm);
  const speedRange = h('input', { type: 'range', min: 30, max: 300, step: 5, value: settings.wpm, 'aria-label': 'Velocidad del texto (palabras por minuto)', oninput: (e) => setWpm(Number(e.target.value)) });
  const speedPop = h('div', { class: 'speed-pop hidden', role: 'group', 'aria-label': 'Velocidad de bajada del texto' },
    h('div', { class: 'speed-pop-head' }, h('span', null, 'Velocidad del texto'), h('b', { class: 'speed-pop-val' }, `${settings.wpm} pal/min`)),
    speedRange,
    h('div', { class: 'speed-pop-presets' },
      [['Lento', 100], ['Normal', 140], ['Rápido', 190], ['Muy rápido', 240]].map(([l, v]) => h('button', { class: 'lib-chip', onclick: () => setWpm(v) }, l))
    ),
    h('p', { class: 'hint' }, 'En «Sigue tu voz» es tu ritmo normal: el texto se adapta si hablas más rápido o más lento.')
  );
  const takesBtn = h('button', { class: 'btn btn-primary btn-sm hidden', onclick: () => finishTakes() });
  const thumbBtn = h('button', { class: 'take-thumb', 'aria-label': 'Mis tomas', title: 'Mis tomas', onclick: () => !recording && go('takes') }, icon('photos', 22));
  const msg = h('div', { class: 'rec-msg hidden' });
  const fxCanvas = h('canvas', { class: 'rec-fx-canvas hidden', 'aria-hidden': 'true' });
  const lightPanel = h('div', { class: 'light-panel hidden', role: 'status', 'aria-live': 'polite' });
  const chipTitle = h('span', { class: 'rec-chip-t' });
  const scriptChip = h('button', { class: 'rec-chip', 'aria-label': 'Elegir guion', onclick: () => openScriptSheet() }, icon('script', 16), chipTitle, icon('chev', 14));
  const qBadge = h('button', { class: 'rec-badge', title: 'Calidad de grabación', onclick: () => openSettings() }, '…');
  const spaceBadge = h('span', { class: 'rec-badge warn hidden' });
  const modeSeg = h('div', { class: 'mode-seg', role: 'radiogroup', 'aria-label': 'Cómo baja el texto' });
  const lensRow = h('div', { class: 'lens-row hidden', role: 'group', 'aria-label': 'Lente' });

  const railBtn = (ic, label, onclick) => h('button', { class: 'rail-btn', 'aria-label': label, title: label, onclick }, icon(ic, 22), h('small', null, label));
  const flipBtn = railBtn('flip', 'Girar', () => flip());
  const torchBtn = railBtn('bolt', 'Linterna', () => toggleTorch());
  torchBtn.classList.add('hidden');
  const aspectBtn = railBtn('aspect', aspect, () => cycleAspect());
  const gridBtn = railBtn('grid', 'Guías', () => {
    grid = !grid;
    db.setKV('recGrid', grid);
    layoutGuides();
  });
  const eyeBtn = railBtn('eye', 'Mirada', () => toggleEye());
  const lightBtn = railBtn('bulb', 'Luz', () => toggleLight());
  const bgBtn = railBtn('image', 'Fondo', () => cycleBg());
  const rail = h('div', { class: 'rec-rail' }, flipBtn, torchBtn, aspectBtn, gridBtn, eyeBtn, lightBtn, MOBILE_APP ? null : bgBtn);

  const shell = h(
    'div',
    { class: `recorder${MOBILE_APP ? ' mobile' : ''}` },
    video,
    fxCanvas,
    guides,
    prompter,
    waitChip,
    meter,
    lightPanel,
    h('div', { class: 'rec-top' },
      h('div', { class: 'rec-top-l' },
        MOBILE_APP ? null : h('button', { class: 'icon-btn round', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close')),
        scriptChip
      ),
      h('div', { class: 'rec-center' }, timer, h('div', { class: 'rec-badges' }, qBadge, spaceBadge)),
      h('div', { class: 'rec-top-r' }, h('button', { class: 'icon-btn round', 'aria-label': 'Ajustes de grabación', onclick: () => openSettings() }, icon('settings')))
    ),
    rail,
    speedPop,
    h('div', { class: 'rec-bottom' },
      h('div', { class: 'rec-bottom-top' }, lensRow, modeSeg),
      h('div', { class: 'rec-bottom-row' },
        h('div', { class: 'rec-side' },
          tpBtn,
          h('div', { class: 'speed-ctl' },
            h('button', { class: 'icon-btn', 'aria-label': 'Más lento', onclick: () => setWpm(settings.wpm - 5) }, '−'),
            speedOut,
            h('button', { class: 'icon-btn', 'aria-label': 'Más rápido', onclick: () => setWpm(settings.wpm + 5) }, '+')
          )
        ),
        recBtn,
        h('div', { class: 'rec-side right' }, MOBILE_APP ? thumbBtn : takesBtn)
      )
    ),
    msg
  );
  root.append(shell);

  // ---------- Teleprompter ----------
  const tp = { offset: 0, running: false, last: 0, raf: 0, words: [], follower: null, target: null, drag: null, pinch: null };
  const pacer = new PaceTracker();
  let pace = { speed: 0, speaking: false, silentMs: 0 };

  function updateChip() {
    chipTitle.textContent = script?.title || (scriptText.trim() ? 'Guion' : 'Sin guion');
  }

  function buildPrompterText() {
    promptText.replaceChildren();
    tp.words = [];
    const paras = scriptText.split(/\n+/).filter((p) => p.trim());
    emptyCard.classList.toggle('hidden', paras.length > 0);
    view.classList.toggle('hidden', !paras.length);
    for (const para of paras) {
      const p = h('p');
      for (const w of splitWords(para)) {
        const span = h('span', { class: 'w' }, w);
        tp.words.push(span);
        p.append(span, ' ');
      }
      promptText.append(p);
    }
    tp.follower = new ScriptFollower(scriptText);
    tp.offset = 0;
    tp.target = null;
    updateChip();
    applyPrompterStyle();
  }

  /** Lado donde está la cámara del celular (en horizontal, el lente queda a un costado). */
  function camSide() {
    if (!IS_MOBILE) return 'top';
    const a = screen.orientation?.angle ?? window.orientation ?? 0;
    return a === 90 ? 'left' : a === 270 || a === -90 ? 'right' : 'top';
  }

  function applyPrompterStyle() {
    const eye = !!P.eyeMode;
    prompter.style.setProperty('--pf', `${eye ? Math.max(P.fontSize, 30) : P.fontSize}px`);
    prompter.style.setProperty('--ph', `${eye ? Math.min(P.heightPct, 32) : P.heightPct}%`);
    prompter.style.setProperty('--po', P.opacity);
    prompter.style.setProperty('--pm', `${eye ? 5 : P.margin}%`);
    prompter.classList.toggle('mirror', P.mirror);
    prompter.classList.toggle('eye', eye);
    const side = camSide();
    prompter.classList.toggle('eye-left', eye && side === 'left');
    prompter.classList.toggle('eye-right', eye && side === 'right');
    eyeBtn.classList.toggle('on', eye);
    const lineY = view.clientHeight * (eye ? 0.22 : P.lineY);
    readLine.style.top = `${lineY}px`;
    promptText.style.paddingTop = `${lineY}px`;
    promptText.style.paddingBottom = `${view.clientHeight}px`;
    waitChip.style.top = `${prompter.offsetTop + prompter.offsetHeight + 10}px`;
    renderOffset();
  }

  const contentHeight = () => {
    if (!tp.words.length) return 0;
    const a = tp.words[0];
    const b = tp.words[tp.words.length - 1];
    return b.offsetTop + b.offsetHeight - a.offsetTop;
  };
  const pxPerSec = () => (contentHeight() / Math.max(1, tp.words.length)) * (settings.wpm / 60);
  const renderOffset = () => {
    promptText.style.transform = `translateY(${-tp.offset}px)${P.mirror ? ' scaleX(-1)' : ''}`;
  };

  function updateWait() {
    const show = P.mode === 'voz' && tp.running && pace.silentMs > 1600 && tp.offset < contentHeight() - 2;
    waitChip.classList.toggle('hidden', !show);
  }

  function tpLoop(now) {
    if (!tp.running) return;
    const dt = Math.min(0.1, (now - tp.last) / 1000);
    tp.last = now;
    if (P.mode === 'palabras') {
      if (tp.target != null) tp.offset += (tp.target - tp.offset) * Math.min(1, dt * 5);
    } else if (P.mode === 'voz') {
      if (pace.speaking) tp.heard = true;
      tp.offset += pxPerSec() * dt * pace.speed;
      // Si en 5 s no se oye nada (micrófono mudo o muy bajo), el texto no se queda quieto: pasa a velocidad fija.
      if (!tp.heard && now - tp.t0 > 5000) {
        setMode('fijo');
        toast('No detecté tu voz, el texto sigue a velocidad fija. Revisa tu micrófono.', 'info', 4200);
      }
    }
    else tp.offset += pxPerSec() * dt;
    tp.offset = clamp(tp.offset, 0, contentHeight());
    renderOffset();
    updateWait();
    tp.raf = requestAnimationFrame(tpLoop);
  }
  function tpStart() {
    if (tp.running) return;
    if (!tp.words.length) {
      toast('El teleprompter no tiene texto: elige o pega un guion.');
      openScriptSheet();
      return;
    }
    meterCtx?.resume?.().catch(() => {});
    tp.running = true;
    tp.last = performance.now();
    tp.t0 = tp.last;
    tp.heard = false;
    tp.raf = requestAnimationFrame(tpLoop);
    tpBtn.replaceChildren(icon('pause'));
    tpBtn.setAttribute('aria-label', 'Pausar teleprompter');
    if (P.mode === 'palabras') startSpeech();
  }
  function tpStop() {
    tp.running = false;
    cancelAnimationFrame(tp.raf);
    tpBtn.replaceChildren(icon('play'));
    tpBtn.setAttribute('aria-label', 'Reproducir teleprompter');
    waitChip.classList.add('hidden');
    if (!recording) stopSpeech();
  }
  const tpToggle = () => (tp.running ? tpStop() : tpStart());
  function tpRestart() {
    tp.offset = 0;
    tp.target = null;
    tp.follower?.reset(0);
    tp.words.forEach((w) => w.classList.remove('done', 'cur'));
    renderOffset();
  }

  function followTo(pos) {
    const n = tp.words.length;
    if (!n) return;
    const i = Math.min(pos, n - 1);
    tp.words.forEach((w, k) => {
      w.classList.toggle('done', k < pos);
      w.classList.toggle('cur', k === i);
    });
    tp.target = tp.words[i].offsetTop - view.clientHeight * (P.eyeMode ? 0.22 : P.lineY);
  }

  function setWpm(v) {
    settings.wpm = clamp(Math.round(v), 30, 300);
    speedOut.textContent = settings.wpm;
    speedRange.value = settings.wpm;
    speedPop.querySelector('.speed-pop-val').textContent = `${settings.wpm} pal/min`;
    saveSettings(settings);
  }

  function renderMode() {
    const opts = [['fijo', 'Fijo'], ['voz', 'Sigue tu voz'], ...(canWords ? [['palabras', 'Palabras']] : [])];
    modeSeg.replaceChildren(
      ...opts.map(([k, l]) => h('button', { class: `mode-btn${P.mode === k ? ' on' : ''}`, role: 'radio', 'aria-checked': String(P.mode === k), onclick: () => setMode(k) }, k === 'voz' ? [icon('wave', 14), l] : l))
    );
  }
  function setMode(k) {
    P.mode = k;
    saveSettings(settings);
    renderMode();
    if (k === 'palabras' && tp.running) startSpeech();
    else if (!recording) stopSpeech();
    toast(MODE_HINT[k], 'info', 2600);
  }

  // Gestos sobre el texto: tocar = pausa, arrastrar = mover, pellizcar = tamaño de letra.
  const pointers = new Map();
  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  prompter.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    prompter.setPointerCapture?.(e.pointerId);
    if (pointers.size === 2) {
      tp.pinch = { d0: pinchDist(), f0: P.fontSize };
      tp.drag = null;
    } else if (pointers.size === 1) tp.drag = { y: e.clientY, off: tp.offset, moved: false };
  });
  prompter.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tp.pinch && pointers.size >= 2) {
      const f = clamp(Math.round((tp.pinch.f0 * pinchDist()) / tp.pinch.d0), 18, 80);
      if (f !== P.fontSize) {
        P.fontSize = f;
        applyPrompterStyle();
      }
      return;
    }
    if (!tp.drag) return;
    const dy = e.clientY - tp.drag.y;
    if (Math.abs(dy) > 6) tp.drag.moved = true;
    if (!tp.drag.moved) return;
    tp.offset = clamp(tp.drag.off - dy, 0, contentHeight());
    if (P.mode === 'palabras') tp.target = tp.offset;
    renderOffset();
  });
  const endPointer = (e, cancel) => {
    pointers.delete(e.pointerId);
    if (tp.pinch) {
      if (pointers.size < 2) {
        tp.pinch = null;
        tp.drag = null;
        saveSettings(settings);
      }
      return;
    }
    if (!cancel && tp.drag && !tp.drag.moved) tpToggle();
    tp.drag = null;
  };
  prompter.addEventListener('pointerup', (e) => endPointer(e, false));
  prompter.addEventListener('pointercancel', (e) => endPointer(e, true));

  // Asa inferior: arrastrar para cambiar el alto del teleprompter.
  let resize = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture?.(e.pointerId);
    resize = { top0: prompter.getBoundingClientRect().top, H: shell.clientHeight };
  });
  handle.addEventListener('pointermove', (e) => {
    if (!resize) return;
    P.heightPct = clamp(Math.round(((e.clientY - resize.top0) / resize.H) * 100), 18, 85);
    applyPrompterStyle();
  });
  const endResize = () => {
    if (!resize) return;
    resize = null;
    saveSettings(settings);
  };
  handle.addEventListener('pointerup', endResize);
  handle.addEventListener('pointercancel', endResize);

  // ---------- Reconocimiento de palabras (Chrome) ----------
  let sr = null;
  let srActive = false;
  let finalText = '';
  function startSpeech() {
    if (srActive) return true;
    if (!SR) {
      toast('Este navegador no reconoce la voz; usa «Sigue tu voz».');
      return false;
    }
    sr = new SR();
    sr.lang = settings.lang;
    sr.continuous = true;
    sr.interimResults = true;
    sr.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          finalText += ` ${r[0].transcript}`;
          if (recording) hints.push({ text: r[0].transcript.trim(), t: (performance.now() - recStart) / 1000 });
        } else interim += r[0].transcript;
      }
      const tail = `${finalText} ${interim}`.split(/\s+/).slice(-8).join(' ');
      if (tp.follower && P.mode === 'palabras') followTo(tp.follower.update(tail));
    };
    sr.onend = () => {
      if (srActive && !destroyed) {
        try {
          sr.start();
        } catch {
          /* ya iniciado */
        }
      }
    };
    sr.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
        srActive = false;
        toast('El reconocimiento de palabras no está disponible aquí. Cambio a «Sigue tu voz».', 'error', 5000);
        setMode('voz');
      }
    };
    srActive = true;
    try {
      sr.start();
    } catch {
      /* ignorar */
    }
    return true;
  }
  function stopSpeech() {
    srActive = false;
    try {
      sr?.stop();
    } catch {
      /* ignorar */
    }
    sr = null;
  }

  // ---------- Cámara ----------
  let meterCtx = null;
  let meterRaf = 0;
  let recStream = null; // video + audio corregido (micrófono de estudio en mono, solo PC)
  let micFix = null;
  function stopStream() {
    micFix?.stop();
    micFix = null;
    recStream = null;
    stream?.getTracks().forEach((t) => {
      // Al soltar la cámara vuelve a automático, para que otros programas no la hereden bloqueada.
      if (t.kind === 'video') resetAuto(t).finally(() => t.stop());
      else t.stop();
    });
    stream = null;
    cancelAnimationFrame(meterRaf);
    meterCtx?.close().catch(() => {});
    meterCtx = null;
  }

  const audioClean = () => (MOBILE_APP ? settings.naturalAudio !== false : !!settings.studioAudio);

  async function startCamera() {
    stopStream();
    if (!hasCamera()) {
      showMessage(
        'Cámara no disponible',
        window.isSecureContext ? 'Este navegador no permite usar la cámara.' : 'La cámara solo funciona en una conexión segura (https:// o localhost).'
      );
      return false;
    }
    const q = settings.recordQuality;
    const [w, hh] = q === '720' ? [1280, 720] : q === '4k' ? [3840, 2160] : [1920, 1080];
    // Siempre en medidas del sensor (horizontal): iOS y Android giran solos la imagen si el celular está vertical.
    const vc = { width: { ideal: w }, height: { ideal: hh }, frameRate: { ideal: settings.recordFps || 30 } };
    if (camId) vc.deviceId = { exact: camId };
    else vc.facingMode = facing;
    // Voz natural: sin cancelación de eco, ruido ni ganancia automática (el teleprompter no suena, no hay eco).
    const clean = audioClean();
    const ac = clean
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (micId) ac.deviceId = { exact: micId };
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: ac });
      } catch (e) {
        // Si el dispositivo guardado ya no está conectado, se usa el predeterminado.
        if (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError') throw e;
        if (!camId && !micId) throw e;
        camId = micId = null;
        delete vc.deviceId;
        vc.facingMode = facing;
        delete ac.deviceId;
        toast('No se encontró el dispositivo guardado; uso el predeterminado.');
        stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: ac });
      }
    } catch (err) {
      console.warn(err);
      const name = err?.name || '';
      const text =
        name === 'NotAllowedError'
          ? IS_IOS
            ? 'Has denegado el permiso. Ve a Ajustes › Apps › Safari › Cámara y Micrófono → Permitir, y vuelve a abrir la app.'
            : 'Has denegado el permiso. Permite cámara y micrófono para esta app (en Android: Ajustes › Apps › Psico Influencer › Permisos).'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No se encontró una cámara o micrófono compatible.'
            : name === 'NotReadableError'
              ? 'Otra app está usando la cámara. Ciérrala y toca Reintentar.'
              : `No se pudo abrir la cámara (${name || err}).`;
      showMessage('Sin acceso a la cámara', text);
      return false;
    }
    if (destroyed) return stopStream(), false;
    hideMessage();
    const vt = stream.getVideoTracks()[0];
    await resetAuto(vt); // parte siempre desde automático
    video.srcObject = stream;
    const s0 = vt.getSettings?.() || {};
    if (s0.facingMode) facing = s0.facingMode === 'environment' ? 'environment' : 'user';
    video.classList.toggle('mirror', facing === 'user');
    await video.play().catch(() => {});
    if (!MOBILE_APP && settings.studioAudio) {
      micFix = monoMic(stream);
      recStream = micFix.stream !== stream ? micFix.stream : null;
    }
    setupMeter();
    vt.addEventListener('ended', () => {
      if (destroyed || stream?.getVideoTracks()[0] !== vt) return;
      if (recording) stopRecording();
      showMessage('La cámara se detuvo', 'Otra app pudo haberla usado o el sistema la pausó. Toca Reintentar.');
    });
    if (settings.camLock !== false && !recording && !MOBILE_APP) {
      const mine = stream;
      lockCamera(vt, video).then((res) => {
        if (stream === mine && !destroyed) toast(lockSummary(res), 'ok', 3500);
      }).catch(() => {});
    }
    video.addEventListener('loadedmetadata', () => { layoutGuides(); updateBadge(); }, { once: true });
    layoutGuides();
    updateBadge();
    setupCaps(vt);
    return true;
  }

  function updateBadge() {
    const s = stream?.getVideoTracks()[0]?.getSettings?.() || {};
    const p = Math.min(s.width || video.videoWidth || 0, s.height || video.videoHeight || 0);
    qBadge.textContent = p ? `${p >= 2000 ? '4K' : `${p}p`} · ${Math.round(s.frameRate || settings.recordFps || 30)}` : '…';
  }

  // Linterna y lentes (si el dispositivo los expone).
  async function setupCaps(vt) {
    torchOn = false;
    const caps = vt.getCapabilities?.() || {};
    torchBtn.classList.toggle('hidden', !caps.torch);
    torchBtn.classList.remove('on');
    lensRow.replaceChildren();
    lensRow.classList.add('hidden');
    if (facing !== 'environment') return;
    const cams = await listCams();
    const back = cams.filter((d) => !isFront(d.label) && !/dual|triple/i.test(d.label));
    const lenses = back.map((d) => ({ d, f: /ultra|gran angular/i.test(d.label) ? 0.5 : /tele/i.test(d.label) ? 2 : 1 })).sort((a, b) => a.f - b.f);
    const cur = vt.getSettings?.().deviceId;
    if (lenses.length > 1) {
      lensRow.append(...lenses.map(({ d, f }) => h('button', { class: `lens-chip${d.deviceId === cur ? ' on' : ''}`, onclick: () => useCam(d.deviceId) }, f === 0.5 ? '.5' : f === 2 ? 'Tele' : '1×')));
      lensRow.classList.remove('hidden');
    } else if (caps.zoom && caps.zoom.max >= 2) {
      const now = vt.getSettings?.().zoom || 1;
      const steps = [Math.max(1, caps.zoom.min), 2, caps.zoom.max >= 3 ? 3 : null].filter(Boolean);
      lensRow.append(...steps.map((z) => h('button', { class: `lens-chip${Math.abs(now - z) < 0.05 ? ' on' : ''}`, onclick: async (e) => {
        try {
          await vt.applyConstraints({ advanced: [{ zoom: z }] });
          lensRow.querySelectorAll('.lens-chip').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
        } catch {
          toast('Este lente no permite zoom');
        }
      } }, `${z}×`)));
      lensRow.classList.remove('hidden');
    }
  }

  async function toggleTorch() {
    const vt = stream?.getVideoTracks()[0];
    if (!vt) return;
    try {
      await vt.applyConstraints({ advanced: [{ torch: !torchOn }] });
      torchOn = !torchOn;
      torchBtn.classList.toggle('on', torchOn);
    } catch {
      toast('La linterna no está disponible con esta cámara');
    }
  }

  function setupMeter() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !stream?.getAudioTracks().length) return;
    meterCtx = new AC();
    const src = meterCtx.createMediaStreamSource(recStream || stream);
    const an = meterCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    // Banda de voz (180–3800 Hz) para seguir tu ritmo sin confundirlo con ruidos graves o agudos.
    const hp = meterCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    const lp = meterCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    const voiceAn = meterCtx.createAnalyser();
    voiceAn.fftSize = 1024;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(voiceAn);
    const buf = new Float32Array(an.fftSize);
    const vbuf = new Float32Array(voiceAn.fftSize);
    pacer.reset();
    const loop = (now) => {
      an.getFloatTimeDomainData(buf);
      const lvl = clamp((rmsDb(buf) + 60) / 60, 0, 1);
      meterFill.style.height = `${lvl * 100}%`;
      voiceAn.getFloatTimeDomainData(vbuf);
      pace = pacer.update(rmsDb(vbuf), now);
      meterRaf = requestAnimationFrame(loop);
    };
    meterRaf = requestAnimationFrame(loop);
  }

  function layoutGuides() {
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const W = shell.clientWidth;
    const H = shell.clientHeight;
    const s = Math.max(W / vw, H / vh);
    const dw = vw * s;
    const dh = vh * s;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    const [aw, ah] = ASPECTS[aspect].size;
    const ar = aw / ah;
    let cw = dw;
    let ch = dw / ar;
    if (ch > dh) {
      ch = dh;
      cw = dh * ar;
    }
    const x0 = Math.max(0, dx + (dw - cw) / 2);
    const y0 = Math.max(0, dy + (dh - ch) / 2);
    const x1 = Math.min(W, dx + (dw + cw) / 2);
    const y1 = Math.min(H, dy + (dh + ch) / 2);
    Object.assign(frame.style, { position: 'absolute', left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    // Si el formato ocupa toda la pantalla no se dibuja marco (en el celular vertical con 9:16).
    frame.classList.toggle('full', x1 - x0 >= W - 2 && y1 - y0 >= H - 2);
    frame.replaceChildren(grid ? h('div', { class: 'rec-grid' }) : '');
    gridBtn.classList.toggle('on', grid);
    aspectBtn.querySelector('small').textContent = aspect;
  }

  function cycleAspect() {
    if (recording) return;
    const keys = Object.keys(ASPECTS);
    aspect = keys[(keys.indexOf(aspect) + 1) % keys.length];
    db.setKV('lastAspect', aspect);
    layoutGuides();
    toast(`${ASPECTS[aspect].label} · ${ASPECTS[aspect].hint}`, 'info', 1800);
  }

  const isFront = (label) => /front|frontal|delantera|user|facetime|anterior/i.test(label || '');
  async function listCams() {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    } catch {
      return [];
    }
  }

  async function useCam(deviceId) {
    if (recording) return;
    camId = deviceId;
    await startCamera();
  }

  async function flip() {
    if (recording) return;
    const cams = await listCams();
    const curId = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
    if (IS_MOBILE) {
      // Celular: frontal ↔ trasera (los lentes traseros se eligen con los botones .5 / 1× / Tele).
      facing = facing === 'user' ? 'environment' : 'user';
      camId = null;
    } else if (cams.length > 1) {
      const i = cams.findIndex((d) => d.deviceId === curId);
      const next = cams[(i + 1) % cams.length];
      camId = next.deviceId;
      facing = isFront(next.label) ? 'user' : 'environment';
    }
    await startCamera();
    const label = stream?.getVideoTracks()[0]?.label;
    if (label && !IS_MOBILE) toast(label);
  }

  function showMessage(title, text) {
    msg.replaceChildren(
      icon('info', 40),
      h('h2', null, title),
      h('p', { class: 'muted', style: { maxWidth: '460px' } }, text),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn btn-primary', onclick: () => startCamera() }, 'Reintentar'),
        MOBILE_APP ? h('button', { class: 'btn', onclick: () => go('takes') }, 'Mis tomas') : h('button', { class: 'btn', onclick: () => go('') }, 'Importar un video'),
        MOBILE_APP ? null : h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cerrar')
      )
    );
    msg.classList.remove('hidden');
  }
  const hideMessage = () => msg.classList.add('hidden');

  // ---------- Grabación ----------
  function updateTimer() {
    timer.textContent = fmtTime((performance.now() - recStart) / 1000);
  }

  function beep(freq, dur = 0.09) {
    try {
      const ctx = meterCtx;
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur + 0.02);
    } catch {
      /* sin audio */
    }
  }

  function runCountdown(n) {
    return new Promise((resolve) => {
      let k = n;
      const el = h('div', { class: 'countdown', 'aria-live': 'assertive' }, String(k));
      shell.append(el);
      beep(660);
      const id = setInterval(() => {
        k--;
        if (k <= 0) {
          clearInterval(id);
          el.remove();
          countdown = null;
          beep(990, 0.14);
          resolve(true);
        } else {
          el.textContent = String(k);
          beep(660);
        }
      }, 1000);
      countdown = {
        cancel: () => {
          clearInterval(id);
          el.remove();
          countdown = null;
          resolve(false);
        },
      };
    });
  }

  async function onRecBtn() {
    meterCtx?.resume?.().catch(() => {});
    if (recording) return stopRecording();
    if (countdown) return countdown.cancel();
    if (!stream && !(await startCamera())) return;
    if (typeof MediaRecorder === 'undefined') return toast('Este navegador no puede grabar video.', 'error');
    speedPop.classList.add('hidden');
    if (P.mode === 'palabras') startSpeech();
    if (P.countdown > 0 && !(await runCountdown(P.countdown))) return;
    if (destroyed || recording) return;
    startRecording();
  }

  function startRecording() {
    const mime = pickMime();
    const q = settings.recordQuality;
    const boost = (settings.recordFps || 30) > 30 ? 1.4 : 1;
    const opts = { videoBitsPerSecond: Math.round((q === '720' ? 6e6 : q === '4k' ? 35e6 : 12e6) * boost), audioBitsPerSecond: 192000 };
    if (mime) opts.mimeType = mime;
    try {
      recorder = new MediaRecorder(recStream || stream, opts);
    } catch {
      recorder = new MediaRecorder(recStream || stream);
    }
    writer = new TakeWriter({ mime: recorder.mimeType || mime || '', scriptId: script?.id || null, scriptTitle: script?.title || '', aspect, facing });
    writer.begin();
    const w = writer;
    hints = [];
    finalText = '';
    recorder.ondataavailable = (e) => w.push(e.data);
    recorder.onstop = onRecorderStop;
    recorder.onerror = (e) => {
      toast(`Error al grabar: ${e.error?.message || e.error?.name || 'desconocido'}`, 'error', 6000);
      if (recording) stopRecording();
    };
    recorder.start(1000);
    recStart = performance.now();
    recording = true;
    shell.classList.add('is-rec');
    recBtn.classList.add('on');
    recBtn.setAttribute('aria-label', 'Detener grabación');
    timer.classList.add('on');
    timerId = setInterval(updateTimer, 250);
    tpStart();
    navigator.vibrate?.(30);
    window.AndroidBridge?.lockOrientation?.(true);
  }

  function stopRecording() {
    recording = false;
    shell.classList.remove('is-rec');
    clearInterval(timerId);
    recBtn.classList.remove('on');
    recBtn.setAttribute('aria-label', 'Empezar a grabar');
    timer.classList.remove('on');
    tpStop();
    stopSpeech();
    navigator.vibrate?.(20);
    window.AndroidBridge?.lockOrientation?.(false);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  let stopDone = null;
  async function onRecorderStop() {
    try {
      await saveTake();
    } catch (e) {
      toast(`No se pudo guardar la toma: ${e.message}`, 'error', 6000);
    } finally {
      stopDone?.();
      stopDone = null;
    }
  }

  async function saveTake() {
    const elapsed = (performance.now() - recStart) / 1000;
    const type = (recorder.mimeType || pickMime() || 'video/webm').split(';')[0];
    const w = writer;
    writer = null;
    const blob = await w.finish(type);
    if (blob.size < 2000) {
      await w.cleanup();
      return toast('La grabación está vacía.', 'error');
    }
    const meta = { duration: elapsed, width: video.videoWidth, height: video.videoHeight };
    const url = URL.createObjectURL(blob);
    let thumb = null;
    try {
      const m = await probeVideo(url);
      if (m.duration > 0.3) meta.duration = m.duration;
      if (m.width) Object.assign(meta, { width: m.width, height: m.height });
    } catch {
      /* se usa la duración medida */
    }
    try {
      thumb = await captureThumb(url, 0.8, 240);
    } catch {
      /* sin miniatura */
    }
    URL.revokeObjectURL(url);
    const fps = Math.round(stream?.getVideoTracks()[0]?.getSettings?.().frameRate || settings.recordFps || 30);
    const rec = await addMedia({
      blob,
      name: `${script?.title ? `${script.title} · ` : ''}Toma ${takes.length + 1}`,
      kind: 'video',
      ...meta,
      extra: { take: true, hints: hints.slice(), facing, scriptId: script?.id || null, scriptTitle: script?.title || '', aspect, fps, thumb },
    });
    await w.cleanup();
    takes.push(rec);
    updateTakes(rec);
    if (!destroyed) showReview(rec);
  }

  function updateTakes(last) {
    takesBtn.classList.toggle('hidden', !takes.length);
    takesBtn.textContent = takes.length > 1 ? `Editar (${takes.length})` : 'Editar';
    if (MOBILE_APP) setThumb(last?.thumb);
  }
  function setThumb(src) {
    thumbBtn.style.backgroundImage = src ? `url("${src}")` : '';
    thumbBtn.classList.toggle('has', !!src);
  }

  function resetPrompter() {
    tpRestart();
    timer.textContent = '0:00';
  }

  function showReview(rec) {
    const url = URL.createObjectURL(rec.blob);
    const v = h('video', { src: url, controls: true, playsinline: true, autoplay: true, class: 'review-video' });
    v.setAttribute('playsinline', '');
    let closed = false;
    const closeReview = () => {
      if (closed) return;
      closed = true;
      v.pause();
      URL.revokeObjectURL(url);
      ov.remove();
      resetPrompter();
    };
    const retake = async () => {
      takes.splice(takes.indexOf(rec), 1);
      await deleteMedia(rec.id);
      updateTakes(takes[takes.length - 1]);
      closeReview();
    };
    const title = `Toma ${takes.length} · ${fmtTime(rec.duration)}`;
    let actions;
    if (MOBILE_APP) {
      actions = h('div', { class: 'review-actions' },
        saveBox(rec, settings, { isAlive: () => !destroyed && !closed }),
        h('div', { class: 'review-row' },
          h('button', { class: 'btn btn-ghost', onclick: retake }, icon('restart', 18), 'Repetir'),
          h('button', { class: 'btn', onclick: closeReview }, icon('record', 18), 'Otra toma'),
          h('button', { class: 'btn btn-ghost', onclick: () => { closeReview(); go('takes'); } }, icon('photos', 18), 'Mis tomas')
        )
      );
    } else {
      actions = h('div', { class: 'review-row' },
        h('button', { class: 'btn btn-danger', onclick: retake }, icon('trash', 18), 'Repetir'),
        h('button', { class: 'btn', onclick: closeReview }, icon('record', 18), 'Otra toma'),
        h('button', { class: 'btn btn-primary', onclick: () => { closeReview(); finishTakes(); } }, icon('edit', 18), takes.length > 1 ? `Editar ${takes.length} tomas` : 'Editar video')
      );
    }
    const ov = h('div', { class: 'review', role: 'dialog', 'aria-label': 'Revisar toma' },
      h('div', { class: 'review-card' },
        h('div', { class: 'review-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Cerrar revisión', onclick: closeReview }, icon('close'))),
        v,
        actions
      )
    );
    shell.append(ov);
  }

  async function finishTakes() {
    if (!takes.length || finished) return;
    finished = true;
    let p;
    if (existing) {
      p = existing;
      p.clips.push(...takes.map(clipFrom));
    } else {
      const brand = await getBrand();
      p = newProject({
        title: script?.title || `Grabación ${new Date().toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
        clips: takes,
        scriptId: script?.id || null,
        aspect,
        brand,
      });
      p.scriptText = scriptText;
      p.recFps = settings.recordFps || 30; // para conservar los 60 fps al exportar
      // El fondo elegido al grabar se aplica en el editor (el original queda intacto).
      if (BG_CYCLE[bgIdx][0] !== 'none') Object.assign(p.fx.bg, fxProject.fx.bg);
      else p.fx.bg.mode = 'none'; // eligió ver el fondo real
      if (brand.stdBg?.mode === 'scene' && p.fx.bg.mode === 'scene') p.fx.bg.scene = brand.stdBg.scene;
      if (scriptText.trim()) p.captions.pending = 'script';
      else if (takes.some((t) => t.hints?.length)) p.captions.pending = 'hints';
    }
    p.thumb ||= await captureThumb(await mediaUrl(takes[0].id));
    await saveProject(p);
    if (!destroyed) go(`editor/${p.id}`);
  }

  async function close() {
    if (recording) stopRecording();
    if (MOBILE_APP) return go('takes');
    if (takes.length) {
      const v = await modal({
        title: `Tienes ${takes.length} toma(s)`,
        body: h('p', null, '¿Quieres editarlas o descartarlas?'),
        actions: [
          { label: 'Descartar', value: 'discard', kind: 'danger' },
          { label: 'Editar', value: 'edit', kind: 'primary' },
        ],
      });
      if (v === 'edit') return finishTakes();
      if (v !== 'discard') return;
      for (const t of takes.splice(0)) await deleteMedia(t.id);
    }
    go('');
  }

  // ---------- Guiones ----------
  async function setScript(s) {
    script = s;
    scriptText = s?.text || '';
    db.setKV('lastScript', s?.id || null).catch(() => {});
    tpStop();
    buildPrompterText();
  }

  async function newScript(data) {
    const s = { id: uid('s_'), title: 'Nuevo guion', text: '', createdAt: Date.now(), updatedAt: Date.now(), ...data };
    await db.put('scripts', s);
    return s;
  }

  const firstWords = (t) => splitWords(t).slice(0, 6).join(' ').replace(/[.,;:!?¡¿]+$/, '') || 'Guion pegado';

  async function pasteScript() {
    let t = '';
    try {
      t = (await navigator.clipboard.readText()).trim();
    } catch {
      /* sin permiso */
    }
    if (!t) {
      toast('No encontré texto copiado. Escríbelo o pégalo aquí.', 'info', 3500);
      return editScript(null);
    }
    await setScript(await newScript({ title: firstWords(t), text: t }));
    toast('Guion pegado', 'ok');
  }

  async function openScriptSheet() {
    if (recording) return;
    const list = (await db.all('scripts')).sort((a, b) => b.updatedAt - a.updatedAt);
    let closeFn = () => {};
    const pick = async (s) => {
      closeFn();
      await setScript(s);
    };
    const body = h('div', null,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => { closeFn(); editScript(null); } }, icon('plus', 16), 'Nuevo'),
        h('button', { class: 'btn btn-sm', onclick: () => { closeFn(); pasteScript(); } }, icon('paste', 16), 'Pegar'),
        script ? h('button', { class: 'btn btn-sm', onclick: () => { closeFn(); editScript(script); } }, icon('edit', 16), 'Editar este') : null
      ),
      list.length
        ? h('div', { class: 'list' },
            list.map((s) => {
              const st = scriptStats(s.text, settings.wpm);
              return h('button', { class: `list-item${script?.id === s.id ? ' selected' : ''}`, onclick: () => pick(s) },
                icon('script'),
                h('div', { class: 'grow' }, h('div', { class: 'title' }, s.title || 'Sin título'), h('div', { class: 'sub' }, `${st.words} palabras · ~${fmtTime(st.seconds)}`))
              );
            })
          )
        : h('p', { class: 'hint' }, 'Aún no tienes guiones. Crea uno o pega el texto que copiaste (por ejemplo, desde el PC).'),
      h('button', { class: 'list-item', style: { marginTop: '8px' }, onclick: () => pick(null) },
        icon('record'),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Grabar sin guion'), h('div', { class: 'sub' }, 'El teleprompter queda vacío'))
      )
    );
    await modal({ title: 'Guion para el teleprompter', body, actions: [], onOpen: (_p, c) => (closeFn = c) });
  }

  async function editScript(s) {
    if (recording) return;
    const titleIn = h('input', { class: 'input', type: 'text', placeholder: 'Título', 'aria-label': 'Título del guion' });
    titleIn.value = s?.title && s.title !== 'Nuevo guion' ? s.title : '';
    const text = h('textarea', { class: 'input', rows: 10, placeholder: 'Escribe o pega lo que vas a decir. Frases cortas, como hablas.', 'aria-label': 'Texto del guion' });
    text.value = s?.text || '';
    const stats = h('p', { class: 'hint' });
    const upd = () => {
      const st = scriptStats(text.value, settings.wpm);
      stats.textContent = `${st.words} palabras · ~${fmtTime(st.seconds)} a ${settings.wpm} pal/min`;
    };
    text.addEventListener('input', upd);
    upd();
    const v = await modal({
      title: s ? 'Editar guion' : 'Nuevo guion',
      body: h('div', null, titleIn, h('div', { style: { height: '8px' } }), text, stats),
      actions: [{ label: 'Cancelar', value: null }, { label: 'Usar en el teleprompter', value: 'ok', kind: 'primary' }],
      onOpen: () => setTimeout(() => (s ? text : titleIn).focus(), 80),
    });
    if (v !== 'ok') return;
    const body = text.value;
    const title = titleIn.value.trim() || firstWords(body);
    if (s) {
      Object.assign(s, { title, text: body, updatedAt: Date.now() });
      await db.put('scripts', s);
      await setScript(s);
    } else if (body.trim()) await setScript(await newScript({ title, text: body }));
  }

  // ---------- Ajustes ----------
  async function openSettings() {
    if (recording) return;
    let devices = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      /* sin permiso */
    }
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    let reopenCamera = false;
    const sec = (t) => h('h3', { class: 'sheet-sec' }, t);
    const body = h(
      'div',
      null,
      sec('Teleprompter'),
      segmented({ label: 'Cómo baja el texto', value: P.mode, options: [['fijo', 'Fijo'], ['voz', 'Sigue tu voz'], ...(canWords ? [['palabras', 'Palabras']] : [])], onChange: (v) => setMode(v) }),
      slider({ label: 'Velocidad (palabras por minuto)', value: settings.wpm, min: 30, max: 300, step: 5, onInput: (v) => setWpm(v) }),
      slider({ label: 'Tamaño del texto', value: P.fontSize, min: 18, max: 80, step: 1, format: (v) => `${v}px`, onInput: (v) => { P.fontSize = v; applyPrompterStyle(); } }),
      slider({ label: 'Alto del teleprompter', value: P.heightPct, min: 18, max: 85, step: 1, format: (v) => `${v}%`, onInput: (v) => { P.heightPct = v; applyPrompterStyle(); } }),
      slider({ label: 'Oscuridad del fondo', value: P.opacity, min: 0, max: 0.9, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { P.opacity = v; applyPrompterStyle(); } }),
      slider({ label: 'Márgenes laterales', value: P.margin, min: 2, max: 25, step: 1, format: (v) => `${v}%`, onInput: (v) => { P.margin = v; applyPrompterStyle(); } }),
      slider({ label: 'Línea de lectura', value: P.lineY, min: 0.1, max: 0.7, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { P.lineY = v; applyPrompterStyle(); } }),
      toggle({ label: 'Modo mirada (contacto visual)', hint: 'Columna angosta pegada al lente: tus ojos casi no se mueven y parece que miras a quien te ve.', checked: !!P.eyeMode, onChange: (v) => { P.eyeMode = v; applyPrompterStyle(); } }),
      toggle({ label: 'Texto en espejo', hint: 'Para teleprompters con cristal.', checked: P.mirror, onChange: (v) => { P.mirror = v; applyPrompterStyle(); } }),
      segmented({ label: 'Cuenta atrás', value: P.countdown, options: [[0, 'No'], [3, '3 s'], [5, '5 s'], [10, '10 s']], onChange: (v) => (P.countdown = v) }),
      sec('Cámara'),
      segmented({ label: 'Formato final', value: aspect, options: Object.keys(ASPECTS).map((k) => [k, k]), onChange: (v) => { aspect = v; db.setKV('lastAspect', v); layoutGuides(); } }),
      segmented({ label: 'Calidad', value: settings.recordQuality, options: [['720', '720p'], ['1080', '1080p'], ['4k', '4K']], onChange: (v) => { settings.recordQuality = v; reopenCamera = true; } }),
      segmented({ label: 'Cuadros por segundo', value: settings.recordFps || 30, options: [[30, '30 fps'], [60, '60 fps']], onChange: (v) => { settings.recordFps = v; reopenCamera = true; } }),
      h('p', { class: 'hint' }, IS_MOBILE ? 'Si tu celular no permite la calidad elegida, usa la más alta posible (se ve arriba, junto al tiempo). 4K y 60 fps ocupan más espacio y batería.' : '4K y 60 fps necesitan una cámara que los soporte.'),
      cams.length > 1 && !IS_MOBILE ? select({ label: 'Cámara', value: camId || '', options: [['', 'Automática'], ...cams.map((d, i) => [d.deviceId, d.label || `Cámara ${i + 1}`])], onChange: (v) => { camId = v || null; settings.camId = camId; reopenCamera = true; } }) : null,
      MOBILE_APP ? null : toggle({ label: 'Cámara estable', hint: 'Fija enfoque y balance de blancos para que la imagen no «respire» mientras hablas.', checked: settings.camLock !== false, onChange: (v) => { settings.camLock = v; reopenCamera = true; } }),
      sec('Audio'),
      mics.length > 0 ? select({ label: 'Micrófono', value: micId || '', options: [['', 'Predeterminado'], ...mics.map((d, i) => [d.deviceId, d.label || `Micrófono ${i + 1}`])], onChange: (v) => { micId = v || null; settings.micId = micId; if (!MOBILE_APP && micId && !/cam|webcam/i.test(mics.find((d) => d.deviceId === v)?.label || '')) settings.studioAudio = true; reopenCamera = true; } }) : null,
      MOBILE_APP
        ? toggle({ label: 'Voz natural', hint: 'Graba tu voz sin el procesado de llamada (suena más real). Apágalo solo si hay mucho ruido alrededor.', checked: settings.naturalAudio !== false, onChange: (v) => { settings.naturalAudio = v; reopenCamera = true; } })
        : toggle({ label: 'Audio de estudio', hint: 'Para micrófono de condensador o interfaz de audio: voz limpia, sin procesado automático y centrada.', checked: !!settings.studioAudio, onChange: (v) => { settings.studioAudio = v; reopenCamera = true; } }),
      MOBILE_APP ? sec('Al guardar') : null,
      MOBILE_APP ? toggle({ label: 'Corregir mirada con IA', hint: 'Al guardar una toma, mueve tus ojos hacia el lente de forma natural.', checked: !!settings.saveGaze, onChange: (v) => (settings.saveGaze = v) }) : null
    );
    await modal({ title: 'Grabación', body, wide: true, actions: [{ label: 'Listo', value: true, kind: 'primary' }] });
    await saveSettings(settings);
    if (reopenCamera && !recording) await startCamera();
  }

  // ---------- Contacto visual ----------
  function toggleEye() {
    P.eyeMode = !P.eyeMode;
    saveSettings(settings);
    applyPrompterStyle();
    toast(P.eyeMode ? 'Modo mirada: celular a la altura de los ojos; lee sin mover la cabeza.' : 'Teleprompter normal', 'info', 2600);
  }

  // ---------- Vista previa del fondo (PC: se graba el original; el fondo se aplica al editar) ----------
  const BG_CYCLE = [['none', 'Fondo'], ['scene', 'Box'], ['blur', 'Desenfoque'], ['gradient', 'Degradado'], ['bokeh', 'Bokeh']];
  let bgIdx = 0;
  let fxPipe = null;
  let fxRaf = 0;
  const fxProject = {
    color: { preset: 'none', brightness: 1, contrast: 1, saturation: 1 },
    fx: { bg: { mode: 'none', gradient: 'calma', scene: 'calido', blur: 16, edge: 0.5, hq: false, body: 2, strict: 0 }, gaze: { enabled: false }, light: {} },
  };
  const cycleBg = () => applyBg((bgIdx + 1) % BG_CYCLE.length);
  async function applyBg(idx) {
    bgIdx = idx;
    db.setKV('recBg', idx).catch(() => {});
    const [mode, label] = BG_CYCLE[bgIdx];
    bgBtn.querySelector('small').textContent = label;
    bgBtn.classList.toggle('on', mode !== 'none');
    cancelAnimationFrame(fxRaf);
    if (mode === 'none') {
      fxCanvas.classList.add('hidden');
      return;
    }
    Object.assign(fxProject.fx.bg, mode === 'scene' ? { mode: 'scene', scene: 'calido' } : mode === 'bokeh' ? { mode: 'gradient', gradient: 'bokeh' } : mode === 'gradient' ? { mode: 'gradient', gradient: 'calma' } : { mode: 'blur' });
    try {
      const { FxPipeline } = await import('../core/effects.js');
      fxPipe ||= new FxPipeline({ maxSide: 720, temporal: 0.5 });
      toast('Cargando la IA de fondo…', 'info', 1500);
      await fxPipe.prepare(fxProject);
    } catch (e) {
      toast(`El cambio de fondo no está disponible aquí: ${e.message}`, 'error');
      return;
    }
    fxCanvas.classList.remove('hidden');
    fxCanvas.classList.toggle('mirror', facing === 'user');
    const fctx = fxCanvas.getContext('2d');
    let last = 0;
    const loop = (now) => {
      fxRaf = requestAnimationFrame(loop);
      if (now - last < 33 || video.readyState < 2 || !video.videoWidth) return;
      last = now;
      const r = fxPipe.process(video, video.videoWidth, video.videoHeight, fxProject, {});
      if (fxCanvas.width !== r.image.width || fxCanvas.height !== r.image.height) {
        fxCanvas.width = r.image.width;
        fxCanvas.height = r.image.height;
      }
      fctx.drawImage(r.image, 0, 0);
    };
    fxRaf = requestAnimationFrame(loop);
  }

  // ---------- Revisión de iluminación en vivo ----------
  let lightTimer = 0;
  async function toggleLight() {
    if (lightTimer) {
      clearInterval(lightTimer);
      lightTimer = 0;
      lightPanel.classList.add('hidden');
      lightBtn.classList.remove('on');
      return;
    }
    lightBtn.classList.add('on');
    lightPanel.classList.remove('hidden');
    lightPanel.replaceChildren('Analizando tu luz…');
    let vision;
    let lighting;
    try {
      vision = await import('../ai/vision.js');
      lighting = await import('../core/lighting.js');
      await vision.ensure('face');
    } catch (e) {
      lightPanel.replaceChildren(`No disponible: ${e.message}`);
      return;
    }
    const c = document.createElement('canvas');
    const cctx = c.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      c.width = 240;
      c.height = Math.round((240 * video.videoHeight) / video.videoWidth);
      cctx.drawImage(video, 0, 0, c.width, c.height);
      const f = vision.detectFace(c);
      const res = lighting.analyzeLighting(cctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, f?.found ? f.box : null);
      const color = res.score >= 80 ? 'var(--ok)' : res.score >= 55 ? 'var(--warn)' : 'var(--danger)';
      lightPanel.replaceChildren(
        h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', { style: { color } }, `Luz ${res.score}/100`), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => go('luz') }, 'Guía')),
        h('div', null, res.tips[0].text)
      );
    };
    tick();
    lightTimer = setInterval(tick, 900);
  }

  // ---------- Espacio disponible ----------
  async function checkSpace() {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est?.quota) return;
      const free = est.quota - est.usage;
      spaceBadge.textContent = `Quedan ${fmtBytes(free)}`;
      spaceBadge.classList.toggle('hidden', free > 800 * 1024 * 1024);
    } catch {
      /* sin datos */
    }
  }

  // ---------- Ciclo de vida ----------
  const onResize = () => {
    applyPrompterStyle();
    layoutGuides();
  };
  window.addEventListener('resize', onResize);
  screen.orientation?.addEventListener?.('change', onResize);
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, .overlay')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      onRecBtn();
    } else if (e.key === 'Escape' && !document.querySelector('.overlay.show') && !MOBILE_APP) close();
    else if (e.key === 'p') tpToggle();
    else if (e.key === 'ArrowUp') setWpm(settings.wpm + 10);
    else if (e.key === 'ArrowDown') setWpm(settings.wpm - 10);
  };
  document.addEventListener('keydown', onKey);
  const requestWake = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* no soportado */
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'hidden') {
      // En el celular el sistema pausa la cámara al salir: se cierra la toma para no perderla.
      if (recording && IS_MOBILE) {
        hiddenStop = true;
        stopRecording();
      }
      return;
    }
    requestWake();
    if (hiddenStop) {
      hiddenStop = false;
      toast('La grabación se detuvo al salir de la app. La toma quedó guardada.', 'info', 5000);
    }
    if (!destroyed && !recording && (!stream || !stream.active || stream.getVideoTracks().some((t) => t.readyState === 'ended'))) startCamera();
  };
  document.addEventListener('visibilitychange', onVisible);
  requestWake();

  renderMode();
  buildPrompterText();
  requestAnimationFrame(() => {
    applyPrompterStyle();
    layoutGuides();
  });
  checkSpace();
  if (MOBILE_APP) {
    // Miniatura de la última toma (acceso a «Mis tomas»).
    db.all('media').then((all) => {
      const last = all.filter((m) => m.take || m.kind === 'video').sort((a, b) => b.createdAt - a.createdAt)[0];
      if (last?.thumb && !takes.length) setThumb(last.thumb);
    }).catch(() => {});
  }
  // Tomas que quedaron a medias (la app se cerró mientras grababas).
  recoverTakes().then(async (list) => {
    for (const r of list) {
      const rec = await addMedia({ blob: r.blob, name: `${r.meta.scriptTitle ? `${r.meta.scriptTitle} · ` : ''}Toma recuperada`, kind: 'video', duration: r.seconds, extra: { take: true, recovered: true, scriptId: r.meta.scriptId || null, scriptTitle: r.meta.scriptTitle || '', aspect: r.meta.aspect || aspect } });
      if (!MOBILE_APP) {
        const p = newProject({ title: 'Toma recuperada', clips: [rec], aspect: r.meta.aspect || aspect, brand: await getBrand() });
        await saveProject(p);
      }
    }
    if (list.length) toast(MOBILE_APP ? 'Recuperé una toma que se interrumpió: está en Mis tomas.' : 'Recuperé una toma que se interrumpió: está en Proyectos.', 'ok', 6000);
  }).catch(() => {});

  startCamera().then(async (ok) => {
    // Fondo de vista previa (solo PC); en el celular no se usa para cuidar la batería.
    const saved = MOBILE_APP ? 0 : await db.getKV('recBg', 0);
    if (ok && !destroyed && saved > 0) applyBg(saved);
  });

  return async () => {
    destroyed = true;
    window.removeEventListener('resize', onResize);
    screen.orientation?.removeEventListener?.('change', onResize);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    countdown?.cancel();
    if (recording) {
      recording = false;
      const done = new Promise((r) => (stopDone = r));
      try {
        recorder.stop();
        await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
      } catch {
        /* ignorar */
      }
      window.AndroidBridge?.lockOrientation?.(false);
    }
    tp.running = false;
    cancelAnimationFrame(tp.raf);
    cancelAnimationFrame(fxRaf);
    clearInterval(lightTimer);
    stopSpeech();
    stopStream();
    wakeLock?.release?.().catch(() => {});
    // PC: nunca perder tomas; si se sale sin pasar al editor, se guardan en un proyecto.
    // Celular: las tomas ya quedaron en «Mis tomas».
    if (takes.length && !finished && !MOBILE_APP) await finishTakes();
  };
}
