// Ajustes: idioma de voz, calidad, almacenamiento, copia de seguridad, diagnóstico e instalación.
import { h, icon, toast, select, slider, segmented, toggle, confirmDialog, pickFile } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtBytes, IS_MOBILE, IS_IOS, MOBILE_APP, APP_VERSION } from '../lib/util.js';
import { getSettings, saveSettings } from '../store.js';
import { pickMime, speechRecognitionCtor, hasCamera, hasScreenCapture } from '../core/media.js';
import { supportsCanvasFilter } from '../core/render.js';
import { downloadBlob } from './share.js';

export const LANGS = [
  ['es-ES', 'Español (España)'],
  ['es-MX', 'Español (México)'],
  ['es-AR', 'Español (Argentina)'],
  ['es-CO', 'Español (Colombia)'],
  ['es-CL', 'Español (Chile)'],
  ['es-US', 'Español (EE. UU.)'],
  ['en-US', 'English (US)'],
  ['pt-BR', 'Português (Brasil)'],
  ['fr-FR', 'Français'],
  ['it-IT', 'Italiano'],
  ['de-DE', 'Deutsch'],
  ['ca-ES', 'Català'],
];

export function installHelp() {
  return h('div', null,
    h('h3', null, 'iPhone (Safari)'),
    h('ol', { class: 'install-steps' },
      h('li', null, 'Abre la dirección de la app en Safari.'),
      h('li', null, 'Pulsa el botón Compartir (cuadrado con flecha).'),
      h('li', null, 'Elige «Añadir a pantalla de inicio» y confirma.'),
      h('li', null, 'Abre Psico Influencer desde el icono: se ve a pantalla completa y funciona sin conexión.')
    ),
    h('h3', null, 'PC (Chrome o Edge)'),
    h('ol', { class: 'install-steps' },
      h('li', null, 'Ejecuta «Iniciar Psico Influencer.bat» (abre la app en el navegador).'),
      h('li', null, 'En la barra de direcciones pulsa el icono «Instalar» (o menú ⋮ › Instalar Psico Influencer).'),
      h('li', null, 'Se abrirá en su propia ventana y aparecerá en el menú Inicio.')
    )
  );
}

async function diagnostics() {
  const rows = [];
  const add = (k, ok, extra = '') => rows.push([k, ok, extra]);
  add('Conexión segura (cámara)', window.isSecureContext, location.protocol + '//' + location.host);
  add('Cámara y micrófono', hasCamera());
  const mime = pickMime();
  add('Grabar/exportar video', mime !== null, mime || (mime === '' ? 'formato por defecto' : 'no disponible'));
  add('Reconocimiento de voz', !!speechRecognitionCtor());
  add('Audio (Web Audio)', !!(window.AudioContext || window.webkitAudioContext));
  add('Filtros de color exactos', supportsCanvasFilter(), supportsCanvasFilter() ? '' : 'se usan aproximados');
  add('Compartir archivos', !!navigator.canShare);
  add('Pantalla siempre encendida', 'wakeLock' in navigator);
  add('Grabar pantalla', hasScreenCapture());
  add('Funciona sin conexión', !!navigator.serviceWorker?.controller, navigator.serviceWorker?.controller ? '' : 'se activa tras la primera carga');
  add('IA con GPU (WebGPU)', !!navigator.gpu, navigator.gpu ? '' : 'usará la CPU (más lento)');
  let persisted = false;
  try {
    persisted = await navigator.storage?.persisted?.();
  } catch {
    /* sin datos */
  }
  add('Almacenamiento persistente', !!persisted);
  return h('dl', { class: 'kv' }, rows.flatMap(([k, ok, extra]) => [h('dt', null, k), h('dd', { class: ok ? 'ok' : 'bad' }, ok ? '✔ Sí' : '✖ No', extra ? h('span', { class: 'muted' }, ` · ${extra}`) : null)]));
}

/** Cámara, micrófono (entrada) y salida de audio, con pruebas rápidas. */
async function devicesCard(settings, save) {
  const card = h('div', { class: 'card' });
  const canSink = 'setSinkId' in HTMLMediaElement.prototype || (window.AudioContext && 'setSinkId' in AudioContext.prototype);
  const draw = async () => {
    let devs = [];
    try {
      devs = await navigator.mediaDevices.enumerateDevices();
    } catch {
      /* sin permiso */
    }
    const named = devs.some((d) => d.label);
    const list = (kind) => devs.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const opt = (kind, empty) => [['', empty], ...list(kind).map((d, i) => [d.deviceId, d.label || `Dispositivo ${i + 1}`])];
    const meter = h('div', { style: { height: '8px', borderRadius: '4px', background: 'var(--surface-2, #2a2a35)', overflow: 'hidden', margin: '6px 0' } }, h('div', { style: { height: '100%', width: '0%', background: 'var(--ok, #3ecf8e)' } }));
    const testMic = async () => {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: settings.micId ? { deviceId: { exact: settings.micId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true });
      } catch (e) {
        return toast(`No se pudo abrir el micrófono (${e.name})`, 'error');
      }
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const t0 = performance.now();
      const bar = meter.firstChild;
      await new Promise((res) => {
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let q = 0;
          for (const v of buf) q += v * v;
          const db = 20 * Math.log10(Math.sqrt(q / buf.length) + 1e-6);
          bar.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
          if (performance.now() - t0 < 5000) requestAnimationFrame(tick);
          else res();
        };
        tick();
      });
      s.getTracks().forEach((t) => t.stop());
      ac.close();
      bar.style.width = '0%';
    };
    const testOut = async () => {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      try {
        if (settings.spkId && ac.setSinkId) await ac.setSinkId(settings.spkId);
      } catch {
        toast('No se pudo usar esa salida; se usa la predeterminada');
      }
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.9);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 1);
      setTimeout(() => ac.close(), 1300);
    };
    card.replaceChildren(
      h('h2', null, 'Cámaras y audio'),
      named ? '' : h('button', { class: 'btn btn-sm btn-primary', onclick: async () => {
        try {
          (await navigator.mediaDevices.getUserMedia({ audio: true, video: true })).getTracks().forEach((t) => t.stop());
        } catch {
          try {
            (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
          } catch {
            toast('Permite el acceso a la cámara y al micrófono para ver sus nombres', 'error');
          }
        }
        draw();
      } }, 'Detectar dispositivos'),
      select({ label: 'Cámara', value: settings.camId || '', options: opt('videoinput', 'Automática'), onChange: (v) => { settings.camId = v || null; save(); } }),
      select({ label: 'Micrófono (entrada)', value: settings.micId || '', options: opt('audioinput', 'Predeterminado del sistema'), onChange: (v) => { settings.micId = v || null; if (v && !/cam/i.test(list('audioinput').find((d) => d.deviceId === v)?.label || '')) settings.studioAudio = true; save(); draw(); } }),
      toggle({ label: 'Audio de estudio', hint: 'Micrófono de condensador o interfaz de audio (AT2020 + Behringer UM2): voz limpia, sin procesado automático y centrada.', checked: !!settings.studioAudio, onChange: (v) => { settings.studioAudio = v; save(); } }),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onclick: testMic }, 'Probar micrófono (5 s)')),
      meter,
      canSink
        ? select({ label: 'Salida de audio (altavoces o audífonos)', value: settings.spkId || '', options: opt('audiooutput', 'Predeterminada del sistema'), onChange: (v) => { settings.spkId = v || null; save(); } })
        : h('p', { class: 'hint' }, 'Este dispositivo usa la salida de audio del sistema (el iPhone no permite elegirla).'),
      canSink ? h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onclick: testOut }, 'Probar salida')) : '',
      h('p', { class: 'hint' }, 'También puedes cambiar cámara y micrófono mientras grabas, en ⚙ del teleprompter. Los cambios se recuerdan.')
    );
  };
  await draw();
  navigator.mediaDevices?.addEventListener?.('devicechange', draw);
  return card;
}

/** Claude con tu plan: estado, modelo, consumo del mes y conexión MCP (Claude Desktop / Claude Code). */
async function claudeCard() {
  const { claudeStatus, CLAUDE_MODELS, CLAUDE_EFFORTS } = await import('../ai/claude.js');
  const { getAISettings, saveAISettings } = await import('../ai/llm.js');
  const usage = await import('../ai/ai-usage.js');
  const ai = await getAISettings();
  const card = h('div', { class: 'card claude-card' });
  const draw = async (force = false) => {
    card.replaceChildren(h('h2', null, '✨ Claude'), h('p', { class: 'muted small' }, 'Revisando…'));
    const [s, sum] = await Promise.all([claudeStatus(force), usage.summary()]);
    const c = sum.claude || {};
    const row = (ok, text) => h('div', { class: `chk ${ok ? 'ok' : 'bad'}` }, ok ? '✔ ' : '✖ ', text);
    const connect = async (target, btn) => {
      btn.disabled = true;
      const r = await window.psicoDesktop.claude.connect(target);
      toast(r.ok ? r.message : r.error, r.ok ? 'ok' : 'error', 7000);
      draw(true);
    };
    const b1 = h('button', { class: 'btn btn-sm', onclick: () => connect('desktop', b1) }, s.desktopMcp ? 'Reconectar Claude Desktop' : 'Conectar a Claude Desktop');
    const b2 = h('button', { class: 'btn btn-sm', onclick: () => connect('code', b2) }, s.codeMcp ? 'Reconectar Claude Code' : 'Conectar a Claude Code');
    const { DEFAULT_EDIT_STYLE } = await import('../ai/estilo-edicion.js');
    const styleBox = h('textarea', { class: 'input', rows: 10, style: 'width:100%;font-size:12px' }, ai.editStyle || DEFAULT_EDIT_STYLE);
    styleBox.addEventListener('change', () => { ai.editStyle = styleBox.value.trim() === DEFAULT_EDIT_STYLE ? '' : styleBox.value; saveAISettings(ai); toast('Estilo guardado', 'ok'); });
    const b0 = h('button', { class: 'btn btn-sm', onclick: () => connect('login', b0) }, 'Iniciar sesión en Claude');
    card.replaceChildren(
      h('h2', null, '✨ Claude'),
      h('p', { class: 'muted small' }, 'Claude edita contigo (pestaña Claude del editor), escribe guiones y mejora las descripciones de imágenes usando tu plan de Claude, sin API de pago. Sin internet o al llegar al límite se usa la IA local.'),
      row(s.installed, s.installed ? 'Claude Code instalado' : 'Claude Code no está instalado (claude.ai/code)'),
      s.installed ? row(s.loggedIn, s.loggedIn ? `Sesión iniciada${s.plan ? ` · plan ${String(s.plan).toUpperCase()}` : ''}` : 'Claude Code está instalado, pero sin sesión iniciada (la app de Claude no la comparte)') : '',
      s.installed && !s.loggedIn ? h('div', { class: 'row' }, b0) : '',
      row(s.online, s.online ? 'Con internet' : 'Sin internet (se usa la IA local)'),
      toggle({ label: 'Usar Claude', checked: ai.claudeOn !== false, onChange: (v) => { ai.claudeOn = v; saveAISettings(ai); } }),
      select({ label: 'Modelo', value: ai.claudeModel || 'auto', options: CLAUDE_MODELS, onChange: (v) => { ai.claudeModel = v; saveAISettings(ai); } }),
      select({ label: 'Nivel de esfuerzo', value: ai.claudeEffort || 'auto', options: CLAUDE_EFFORTS, onChange: (v) => { ai.claudeEffort = v; saveAISettings(ai); } }),
      h('p', { class: 'hint' }, 'Automático = Haiku para textos cortos y Sonnet para editar y escribir guiones: la mejor calidad por cada token de tu plan. Opus gasta varias veces más.'),
      h('p', { class: 'small' }, `Este mes: ${c.requests || 0} consultas a Claude · ${((c.input || 0) + (c.output || 0)).toLocaleString('es')} tokens (+${(c.cached || 0).toLocaleString('es')} en caché) · ${c.local || 0} resueltas con IA local.`),
      h('h3', null, 'Estilo de edición'),
      h('p', { class: 'hint' }, 'Claude y la IA local siguen esta guía en cada edición (gancho, cortes, ritmo, tarjetas, subtítulos, sonido). Edítala a tu gusto.'),
      styleBox,
      h('h3', null, 'Conexión MCP (Claude controla la app)'),
      h('p', { class: 'hint' }, 'Desde el chat de Claude Desktop o Claude Code puedes pedir «edita mi último video para Reels», «crea 3 guiones sobre ansiedad» o «hazme una portada». Claude usa las herramientas de Psico Influencer y ves cada cambio aquí.'),
      row(s.desktopMcp, s.desktopMcp ? 'Conectado a Claude Desktop' : 'Claude Desktop sin conectar'),
      row(!!s.codeMcp, s.codeMcp ? 'Conectado a Claude Code' : 'Claude Code sin conectar'),
      h('div', { class: 'row' }, b1, b2, h('button', { class: 'btn btn-sm btn-ghost', onclick: () => draw(true) }, 'Actualizar'))
    );
  };
  if (window.psicoDesktop?.claude) draw();
  else card.replaceChildren(h('h2', null, '✨ Claude'), h('p', { class: 'muted small' }, 'Disponible en el programa de PC.'));
  return card;
}

/** Material de edición (carpeta «Material») y transcriptor de alta calidad (whisper.cpp con GPU). Solo PC. */
async function materialCard() {
  const D = window.psicoDesktop;
  if (!D?.material) return '';
  const [st, { DEFAULT_VOCAB }, { getAISettings, saveAISettings }] = await Promise.all([D.material.status(), import('../core/transcribe.js'), import('../ai/llm.js')]);
  const ai = await getAISettings();
  const w = st.whisper || {};
  const row = (ok, text) => h('div', { class: `chk ${ok ? 'ok' : 'bad'}` }, ok ? '✔ ' : '✖ ', text);
  const vocab = h('textarea', { class: 'input', rows: 3, style: 'width:100%;font-size:13px' }, ai.vocab || DEFAULT_VOCAB);
  vocab.addEventListener('change', () => { ai.vocab = vocab.value.trim() === DEFAULT_VOCAB ? '' : vocab.value; saveAISettings(ai); toast('Vocabulario guardado', 'ok'); });
  return h('div', { class: 'card' },
    h('h2', null, '🎛️ Material y transcripción'),
    row(!!st.dir, st.dir ? `Material: ${st.count.toLocaleString('es')} archivos con licencia verificada` : 'No encuentro la carpeta «Material»'),
    h('div', { class: 'row' },
      st.dir ? h('button', { class: 'btn btn-sm', onclick: () => D.material.open() }, 'Abrir carpeta') : '',
      h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { const d = await D.material.choose(); toast(d ? 'Carpeta del Material lista' : 'Esa carpeta no tiene manifest.json', d ? 'ok' : 'error'); } }, 'Elegir otra carpeta…')),
    row(!!w.ok, w.ok ? `Transcriptor de alta calidad (Whisper con GPU): ${w.models.map((m) => m.label).join(' · ')}` : 'Transcriptor de alta calidad no instalado (se usa el del navegador)'),
    w.ok ? segmented({ label: 'Calidad de la transcripción', value: ai.whisperQuality || 'maximo', options: w.models.map((m) => [m.id, m.id === 'maximo' ? 'Máxima' : 'Rápida']), onChange: (v) => { ai.whisperQuality = v; saveAISettings(ai); } }) : '',
    h('p', { class: 'hint' }, 'Vocabulario para el transcriptor (nombres propios y términos que debe escribir bien):'),
    vocab);
}

async function aiCard() {
  const { getAISettings, saveAISettings, ollamaModels, LLM_MODELS, pickOllamaModel } = await import('../ai/llm.js');
  const [ai, olla] = await Promise.all([getAISettings(), ollamaModels(true)]);
  if (ai.provider === 'gemini') ai.provider = 'auto';
  const save = () => saveAISettings(ai);
  return h('div', { class: 'card' },
    h('h2', null, 'IA local (sin internet)'),
    segmented({
      label: 'Motor para escribir guiones y textos', value: ai.provider,
      options: [['auto', 'Automático (Claude → local)'], ['claude', 'Solo Claude'], ['ollama', 'Ollama (PC)'], ['browser', 'En este dispositivo']],
      onChange: (v) => { ai.provider = v; save(); },
    }),
    IS_MOBILE
      ? h('p', { class: 'hint' }, 'Modo ligero del iPhone: usa el modelo de IA liviano del celular (Qwen3 0,6B) para cuidar la batería. Si tu PC está encendido y en la misma Wi-Fi, usa automáticamente la IA potente del PC.')
      : select({ label: 'Modelo en el dispositivo', value: ai.model, options: Object.entries(LLM_MODELS).map(([k, m]) => [k, m.label]), onChange: (v) => { ai.model = v; save(); } }),
    olla.length
      ? select({ label: 'Modelo de Ollama', value: ai.ollamaModel || pickOllamaModel(olla), options: olla.map((m) => [m, m]), onChange: (v) => { ai.ollamaModel = v; save(); } })
      : h('p', { class: 'hint' }, 'Ollama no está instalado o abierto en este PC. Para guiones de mayor calidad usando tu tarjeta gráfica (RTX): instala Ollama (ollama.com) y descarga un modelo, por ejemplo «gemma3:4b» o «qwen3:8b». Sin Ollama, la IA funciona igual dentro del programa.'),
    h('a', { class: 'btn btn-sm', href: '#/ia?tab=imagenes' }, 'Fondos y portadas con IA')
  );
}

/** Ajustes del celular: solo lo que importa para grabar y guardar. */
async function renderMobile(root, settings, save) {
  let storage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) storage = `${fmtBytes(est.usage)} usados · quedan ${fmtBytes(est.quota - est.usage)}`;
  } catch {
    /* sin datos */
  }
  settings.naturalAudio ??= true;
  const P = settings.prompter;
  const diag = h('div', null, h('p', { class: 'muted small' }, 'Comprobando…'));
  diagnostics().then((d) => diag.replaceChildren(d));
  const checkUpdate = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
      toast(reg?.waiting || reg?.installing ? 'Descargando la versión nueva… la app se recargará sola.' : 'Ya tienes la última versión.', 'ok', 4000);
    } catch {
      toast('No se pudo buscar (¿sin internet?)', 'error');
    }
  };
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Ajustes'), h('p', { class: 'muted small' }, `Psico Influencer ${APP_VERSION} · estudio de grabación`))),
    h('div', { class: 'card' },
      h('h2', null, 'Grabación'),
      segmented({ label: 'Calidad', value: settings.recordQuality, options: [['720', '720p'], ['1080', '1080p'], ['4k', '4K']], onChange: (v) => { settings.recordQuality = v; save(); } }),
      segmented({ label: 'Cuadros por segundo', value: settings.recordFps || 30, options: [[30, '30 fps'], [60, '60 fps']], onChange: (v) => { settings.recordFps = v; save(); } }),
      toggle({ label: 'Voz natural', hint: 'Sin el procesado de llamada: tu voz suena más real. Apágalo solo con mucho ruido alrededor.', checked: settings.naturalAudio !== false, onChange: (v) => { settings.naturalAudio = v; save(); } }),
      toggle({ label: 'Corregir mirada con IA al guardar', hint: 'Lleva tus ojos al lente de forma natural al guardar cada toma.', checked: !!settings.saveGaze, onChange: (v) => { settings.saveGaze = v; save(); } })
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Teleprompter'),
      segmented({ label: 'Cómo baja el texto', value: P.mode || 'voz', options: [['fijo', 'Fijo'], ['voz', 'Sigue tu voz']], onChange: (v) => { P.mode = v; save(); } }),
      slider({ label: 'Velocidad (palabras por minuto)', value: settings.wpm, min: 30, max: 300, step: 5, onChange: (v) => { settings.wpm = v; save(); } }),
      slider({ label: 'Tamaño del texto', value: P.fontSize, min: 18, max: 80, step: 1, format: (v) => `${v}px`, onChange: (v) => { P.fontSize = v; save(); } }),
      segmented({ label: 'Cuenta atrás', value: P.countdown, options: [[0, 'No'], [3, '3 s'], [5, '5 s'], [10, '10 s']], onChange: (v) => { P.countdown = v; save(); } }),
      toggle({ label: 'Modo mirada', hint: 'Columna angosta junto al lente para mirar a la cámara.', checked: !!P.eyeMode, onChange: (v) => { P.eyeMode = v; save(); } }),
      toggle({ label: 'Texto en espejo', hint: 'Para teleprompters con cristal.', checked: !!P.mirror, onChange: (v) => { P.mirror = v; save(); } })
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Editar en el PC'),
      h('p', { class: 'muted small' }, 'La edición (cortes, subtítulos, música, Claude) se hace en el programa de PC. Para pasar tus tomas: guárdalas en ', IS_IOS ? 'Fotos' : 'la galería', ', abre en el PC «Conectar celular» y escanea el código.'),
      h('button', { class: 'btn btn-sm', onclick: () => import('./take-actions.js').then((m) => m.sendToPcHelp()) }, icon('send', 16), 'Cómo enviar al PC')
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Espacio'),
      h('p', { class: 'muted small' }, storage || 'Tus tomas se guardan en este celular.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-sm', href: '#/takes' }, icon('photos', 16), 'Mis tomas'),
        h('button', { class: 'btn btn-sm', onclick: async () => toast((await navigator.storage?.persist?.()) ? 'Almacenamiento protegido' : 'El sistema no lo concedió (instala la app en la pantalla de inicio)') }, 'Proteger datos')
      )
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Actualización'),
      h('p', { class: 'muted small' }, `Versión ${APP_VERSION}. La app se actualiza sola al abrirla con internet (si no estás grabando).`),
      h('button', { class: 'btn btn-sm', onclick: checkUpdate }, icon('restart', 16), 'Buscar actualización'),
      IS_IOS ? h('p', { class: 'hint' }, 'Para instalarla: en Safari toca Compartir › «Agregar a pantalla de inicio».') : ''
    ),
    h('details', { class: 'card' }, h('summary', null, h('b', null, 'Diagnóstico de este celular')), diag)
  );
}

export default async function render(root) {
  const settings = await getSettings();
  const save = () => saveSettings(settings);
  if (MOBILE_APP) return renderMobile(root, settings, save);
  let storage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) storage = `${fmtBytes(est.usage)} usados de ${fmtBytes(est.quota)}`;
  } catch {
    /* sin datos */
  }

  const backup = async () => {
    const [scripts, ideas, projects] = await Promise.all([db.all('scripts'), db.all('ideas'), db.all('projects')]);
    const data = {
      app: 'psicoinfluencer', version: 1, exportedAt: new Date().toISOString(),
      scripts, ideas, settings: await db.getKV('settings', {}), brand: await db.getKV('brand', {}),
      projects: projects.map((p) => ({ ...p, thumb: null })),
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `psico-influencer-copia-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Copia descargada (guiones, ideas, marca y ajustes; los videos no se incluyen).', 'ok', 5000);
  };
  const restore = async () => {
    const [file] = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'psicoinfluencer') throw new Error('No es una copia de Psico Influencer');
      if (!(await confirmDialog(`Se importarán ${data.scripts?.length || 0} guiones y ${data.ideas?.length || 0} ideas (los existentes con el mismo id se sustituyen).`, { ok: 'Importar' }))) return;
      for (const s of data.scripts || []) await db.put('scripts', s);
      for (const i of data.ideas || []) await db.put('ideas', i);
      if (data.brand && Object.keys(data.brand).length) await db.setKV('brand', { ...data.brand, logoMediaId: (await db.getKV('brand', {})).logoMediaId || null });
      if (data.settings) await db.setKV('settings', data.settings);
      toast('Copia importada', 'ok');
    } catch (e) {
      toast(`No se pudo importar: ${e.message}`, 'error');
    }
  };
  const wipe = async () => {
    if (!(await confirmDialog('Se borrarán TODOS los proyectos, videos, guiones, ideas y ajustes de este dispositivo.', { title: 'Borrar todo', ok: 'Continuar', danger: true }))) return;
    if (!(await confirmDialog('Esta acción no se puede deshacer. ¿Borrar todo definitivamente?', { title: 'Confirmación final', ok: 'Borrar todo', danger: true }))) return;
    for (const s of db.stores) await db.clear(s);
    toast('Datos borrados');
    location.hash = '#/';
    location.reload();
  };

  const diag = h('div', null, h('p', { class: 'muted small' }, 'Comprobando…'));
  diagnostics().then((d) => diag.replaceChildren(d));

  root.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Ajustes')),
    h('div', { class: 'card' },
      h('h2', null, 'Voz y lectura'),
      select({ label: 'Idioma (teleprompter por voz y transcripción)', value: settings.lang, options: LANGS, onChange: (v) => { settings.lang = v; save(); } }),
      slider({ label: 'Velocidad de bajada del texto (palabras por minuto)', value: settings.wpm, min: 30, max: 300, step: 5, onChange: (v) => { settings.wpm = v; save(); } })
    ),
    await devicesCard(settings, save),
    await claudeCard(),
    await materialCard(),
    await aiCard(),
    h('div', { class: 'card' },
      h('h2', null, 'Calidad'),
      segmented({ label: 'Grabación', value: settings.recordQuality, options: IS_MOBILE ? [['720', '720p'], ['1080', '1080p']] : [['720', '720p'], ['1080', '1080p'], ['4k', '4K']], onChange: (v) => { settings.recordQuality = v; save(); } }),
      segmented({ label: 'Cuadros por segundo', value: settings.recordFps || 30, options: [[30, '30 fps (ahorra batería)'], [60, '60 fps (más fluido)']], onChange: (v) => { settings.recordFps = v; save(); } }),
      segmented({ label: 'Exportación', value: settings.exportQuality, options: [['720', '720p'], ['1080', '1080p']], onChange: (v) => { settings.exportQuality = v; save(); } })
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Almacenamiento'),
      h('p', { class: 'muted small' }, storage || 'Todo se guarda en este dispositivo.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: async () => toast((await navigator.storage?.persist?.()) ? 'Almacenamiento protegido' : 'El navegador no lo concedió (instala la app para mejorarlo)') }, 'Proteger datos'),
        h('button', { class: 'btn btn-sm', onclick: backup }, icon('download', 16), 'Copia de seguridad'),
        h('button', { class: 'btn btn-sm', onclick: restore }, icon('upload', 16), 'Restaurar copia'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: wipe }, icon('trash', 16), 'Borrar todo')
      ),
      h('p', { class: 'hint' }, 'Consejo: descarga tus videos terminados (Compartir › Guardar video) para no depender del almacenamiento del navegador.')
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Celular'),
      h('p', { class: 'muted small' }, 'El celular es tu cámara con teleprompter; aquí editas. Recibe sus videos por Wi-Fi e instala la app de grabación.'),
      h('button', { class: 'btn btn-primary', onclick: () => import('./iphone.js').then((m) => m.showPhoneConnect()) }, icon('phone', 18), 'Conectar celular')
    ),
    h('div', { class: 'card' }, h('h2', null, 'Diagnóstico de este dispositivo'), diag),
    h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '16px' } }, `Psico Influencer ${APP_VERSION} · Tus videos se guardan y procesan en tu PC. Solo usan internet: Claude (con tu plan) y la primera descarga de modelos de IA.`)
  );
}
