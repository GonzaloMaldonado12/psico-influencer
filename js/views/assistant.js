// Panel «Claude» del editor (PC): pides en lenguaje natural, Claude propone un plan de edición,
// tú eliges qué aplicar y la app lo ejecuta con sus propias herramientas (cortes, subtítulos,
// música, sonidos, efectos, imágenes con el motor local…). Sin internet: IA local (Ollama) o la
// edición automática por análisis. Todo se puede deshacer.
import { h, icon, toast, segmented } from '../lib/dom.js';
import { fmtTime } from '../lib/util.js';
import { addMedia, mediaUrl } from '../store.js';
import { buildSegments } from '../core/timeline.js';
import { findSilences, silenceCuts } from '../core/audio-analysis.js';
import { autoGrade } from '../core/lighting.js';
import { validateOps, applyOps, describeOp, planPrompt, PLAN_SCHEMA, EDITOR_SYSTEM } from '../ai/agent-ops.js';
import { copyText } from './script-dialogs.js';

const SUGGESTIONS = [
  ['Listo para Reels', 'Déjalo listo para Reels y TikTok: quita silencios y muletillas, subtítulos dinámicos con palabras clave, zoom leve en los cortes y música tranquila baja.'],
  ['Más dinámico', 'Hazlo más dinámico sin exagerar: transiciones suaves en los cortes, 2 o 3 sonidos sutiles y un efecto de énfasis en la frase más importante.'],
  ['Gancho inicial', 'Refuerza los primeros 3 segundos: un titular que enganche y un texto en pantalla con la idea principal.'],
  ['Imagen de apoyo', 'Crea 1 imagen de apoyo (b-roll) para la idea central y ponla 3 segundos donde se menciona.'],
  ['Video de música', 'Edítalo como un video de música al estilo de Paul Davids o Rick Beato: sin música de fondo ni sonidos encima del instrumento, cortes limpios, carteles con acordes, escalas o técnica cuando los nombro, un titular que enganche y título/descripción para YouTube.'],
  ['Publicación', 'Escribe título, descripción y hashtags para publicar este video.'],
];

/** Plan con Ollama (IA local con salida JSON) cuando Claude no está disponible. */
async function planLocal(system, prompt) {
  const { ollamaModels, pickOllamaModel, getAISettings } = await import('../ai/llm.js');
  const models = await ollamaModels(true);
  if (!models.length) return null;
  const s = await getAISettings();
  const model = pickOllamaModel(models, s.ollamaModel);
  const r = await fetch('/api/ollama/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, format: PLAN_SCHEMA, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], options: { temperature: 0.2, num_ctx: 8192 } }),
  });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(j.message?.content || '{}'), engine: `IA local (${model})` };
}

/** Herramientas reales de la app que usan las operaciones. */
export function opsContext(E) {
  return {
    project: E.project,
    brand: E.brand,
    get analysis() {
      return E.analysis;
    },
    ensureAnalysis: () => E.ensureAnalysis(),
    captionsFromText: (t, src) => E.captionsFromText(t, src),
    captionsFromAI: () => E.captionsFromAI(),
    makeMusic: async (...a) => (await import('./editor-pro.js')).makeMusic(...a),
    autoGrade,
    lightMetrics: async () => {
      const { analyzeClip } = await import('../ai/face-track.js');
      const c = E.project.clips[0];
      if (!c) return null;
      const res = await Promise.race([
        analyzeClip(await mediaUrl(c.mediaId), c.duration, { step: Math.max(0.5, c.duration / 10) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado midiendo la luz')), 30000)),
      ]);
      if (res?.track?.length) c.faceTrack = res.track;
      return res?.light?.metrics || null;
    },
    stockImage: async (q) => (await import('../ai/stock.js')).stockImage(q),
    generateImage: async (prompt, aspect) => {
      const { ensureEngine, generateLocal } = await import('../ai/local-img.js');
      const usage = await import('../ai/ai-usage.js');
      await ensureEngine((t) => toast(t, 'info', 4000));
      const [cfg, sum] = await Promise.all([usage.getConfig(), usage.summary()]);
      const r = await generateLocal(prompt, { aspect, checkpoint: cfg.checkpoint, expectedMs: sum.localAvgMs || 60000 });
      usage.recordLocal(r.ms).catch(() => {});
      return addMedia({ blob: r.blob, name: `IA · ${prompt.slice(0, 40)}`, kind: 'image', extra: { library: true, ai: true, prompt } });
    },
  };
}

/** Aplica operaciones en el editor abierto y refresca la vista. */
export async function applyInEditor(E, ops, onStep) {
  const res = await applyOps(opsContext(E), ops, { onStep });
  await E.player.load();
  E.changed({ structure: true, captions: true, music: true });
  return res;
}

function silenceLine(E) {
  let n = 0;
  let sec = 0;
  for (const c of E.project.clips) {
    const a = E.analysis?.[c.mediaId];
    if (!a?.regions) continue;
    const cuts = silenceCuts(findSilences(a.regions, c.duration, 0.55), c.duration, 0.12);
    n += cuts.length;
    sec += cuts.reduce((s, x) => s + (x.end - x.start), 0);
  }
  return n ? `Pausas largas detectadas: ${n} (${sec.toFixed(1)} s en total).` : '';
}

export function panelAssistant(E) {
  const st = (E.state.assistant ||= { thread: [], busy: false, draft: '', engine: 'claude' });
  const wrap = h('div', { class: 'assistant' });
  const status = h('div', { class: 'as-status' }, h('span', { class: 'dot' }), 'Revisando la conexión con Claude…');
  const input = h('textarea', { class: 'input as-input', rows: 3, placeholder: 'Ej.: Déjalo listo para Reels con subtítulos dinámicos, música suave y un título que enganche.', 'aria-label': 'Pedido para Claude' });
  input.value = st.draft;
  input.addEventListener('input', () => (st.draft = input.value));
  const send = h('button', { class: 'btn btn-primary', onclick: () => ask(input.value) }, icon('sparkle', 18), 'Pedir a Claude');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask(input.value);
    }
  });
  const thread = h('div', { class: 'as-thread' });
  const engineBox = h('div', { class: 'as-engine' });
  function renderEngine() {
    engineBox.replaceChildren(segmented({
      label: 'Con qué editar',
      value: st.engine,
      options: [['claude', 'Claude'], ['local', 'IA local'], ['tools', 'Herramientas']],
      onChange: (v) => { st.engine = v; renderEngine(); },
    }), h('p', { class: 'hint' }, st.engine === 'claude' ? 'Mejor calidad. Usa tu plan de Claude (necesita internet).' : st.engine === 'local' ? 'Modelo en tu PC (Ollama): sin internet y sin costo. Más simple que Claude.' : 'Sin IA de texto: edición automática por análisis (silencios, luz, subtítulos). Sin internet.'));
  }
  renderEngine();

  (async () => {
    const { claudeStatus, claudeSettings, MODEL_LABEL, pickModel } = await import('../ai/claude.js');
    const [s, cfg] = await Promise.all([claudeStatus(), claudeSettings()]);
    const model = MODEL_LABEL[pickModel('plan', cfg.claudeModel)];
    if (s.ok && cfg.claudeOn) status.replaceChildren(h('span', { class: 'dot ok' }), `Claude ${model} · tu plan ${String(s.plan || '').toUpperCase() || 'Claude'}`);
    else status.replaceChildren(h('span', { class: 'dot warn' }), cfg.claudeOn ? `${s.reason || 'Claude no disponible'} · usaré la IA local` : 'Claude desactivado · usaré la IA local', h('button', { class: 'btn btn-sm btn-ghost', onclick: () => E.go('settings') }, 'Ajustes'));
  })().catch(() => status.replaceChildren(h('span', { class: 'dot warn' }), 'Usaré la IA local'));

  function renderThread() {
    thread.replaceChildren(...st.thread.map(renderItem).reverse());
  }

  function renderItem(it) {
    const head = h('div', { class: 'as-q' }, icon('chat', 16), h('span', null, it.request));
    if (it.state === 'thinking') return h('div', { class: 'as-item' }, head, h('div', { class: 'as-a' }, h('span', { class: 'spinner' }), it.note || 'Pensando el plan…'));
    if (it.state === 'error') return h('div', { class: 'as-item' }, head, h('div', { class: 'as-a error' }, it.error));
    const card = h('div', { class: 'as-a' });
    card.append(h('p', { class: 'as-sum' }, it.resumen || 'Plan listo.'));
    if (it.state === 'plan') {
      const checks = it.ops.map(() => true);
      const list = h('div', { class: 'as-ops' },
        it.ops.map((o, i) => {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = true;
          cb.addEventListener('change', () => (checks[i] = cb.checked));
          return h('label', { class: 'as-op' }, cb, h('span', null, describeOp(o)));
        })
      );
      if (it.ops.length) card.append(list);
      if (it.dropped?.length) card.append(h('p', { class: 'hint' }, `Omití: ${it.dropped.join(' · ')}`));
      card.append(h('div', { class: 'row' },
        it.ops.length ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => applyPlan(it, it.ops.filter((_, i) => checks[i])) }, icon('check', 16), 'Aplicar') : null,
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { st.thread = st.thread.filter((x) => x !== it); renderThread(); } }, 'Descartar')
      ));
    } else if (it.state === 'applying') {
      card.append(h('p', { class: 'hint' }, h('span', { class: 'spinner' }), it.step || 'Aplicando…'));
    } else if (it.state === 'done') {
      if (it.done.length) card.append(h('ul', { class: 'as-done' }, it.done.map((x) => h('li', null, '✔ ', x))));
      if (it.failed.length) card.append(h('ul', { class: 'as-done bad' }, it.failed.map((x) => h('li', null, '✖ ', x))));
      if (it.post) {
        const text = `${it.post.titulo}\n\n${it.post.descripcion}\n\n${it.post.hashtags}`;
        card.append(h('div', { class: 'as-post' }, h('b', null, it.post.titulo), h('p', null, it.post.descripcion), h('p', { class: 'hint' }, it.post.hashtags), h('button', { class: 'btn btn-sm', onclick: () => copyText(text) }, icon('copy', 16), 'Copiar')));
      }
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onclick: () => { E.undo?.(); toast('Deshecho'); } }, icon('undo', 16), 'Deshacer'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => E.player.seek(0).then(() => E.player.toggle?.()) }, icon('play', 16), 'Ver')));
    }
    if (it.engine) card.append(h('p', { class: 'as-meta' }, it.engine));
    return h('div', { class: 'as-item' }, head, card);
  }

  async function ask(text) {
    const request = String(text || '').trim();
    if (!request || st.busy) return;
    st.busy = true;
    send.disabled = true;
    const it = { request, state: 'thinking' };
    st.thread.push(it);
    st.draft = '';
    input.value = '';
    renderThread();
    try {
      const P = E.project;
      await Promise.race([E.ensureAnalysis(), new Promise((r) => setTimeout(r, 8000))]).catch(() => {});
      const prev = st.thread.filter((x) => x.state === 'done').slice(-1)[0];
      const prompt = planPrompt(P, request, { extra: silenceLine(E), previous: prev ? `${prev.request} → ${prev.resumen || ''}`.slice(0, 300) : '' });
      let data = null;
      let engine = '';
      const { askClaude, claudeReason, MODEL_LABEL, tokensOf } = await import('../ai/claude.js');
      if (st.engine === 'tools') {
        const { magicEdit } = await import('./editor-pro.js');
        st.thread = st.thread.filter((x) => x !== it);
        await magicEdit(E);
        return;
      }
      try {
        if (st.engine === 'local') throw Object.assign(new Error('local'), { kind: 'off' });
        it.note = 'Claude está armando el plan…';
        renderThread();
        const r = await askClaude({ task: 'plan', system: EDITOR_SYSTEM, prompt, schema: PLAN_SCHEMA });
        data = r.data || JSON.parse(r.text || '{}');
        engine = `Claude ${MODEL_LABEL[r.modelKey] || ''} · ${tokensOf(r).toLocaleString('es')} tokens de tu plan · ${(r.ms / 1000).toFixed(1)} s`;
      } catch (e) {
        it.note = st.engine === 'local' ? 'Armando el plan con la IA local…' : `${claudeReason(e)} Probando con la IA local…`;
        renderThread();
        const loc = await planLocal(EDITOR_SYSTEM, prompt).catch(() => null);
        if (loc) {
          data = loc.data;
          engine = `${loc.engine} · sin costo, en tu PC`;
          import('../ai/ai-usage.js').then((u) => u.recordLocalText()).catch(() => {});
        } else {
          // Sin Claude ni Ollama: la edición automática por análisis (sin IA de texto).
          Object.assign(it, { state: 'error', error: `${claudeReason(e)} Y no encontré Ollama abierto. Usa «Edición automática» (pestaña IA), que funciona sin internet.` });
          renderThread();
          return;
        }
      }
      const total = buildSegments(P).total;
      const { ops, dropped } = validateOps(data?.ops, total);
      Object.assign(it, { state: 'plan', resumen: data?.resumen || '', ops, dropped, engine });
    } catch (e) {
      Object.assign(it, { state: 'error', error: `No se pudo: ${e.message}` });
    } finally {
      st.busy = false;
      send.disabled = false;
      renderThread();
    }
  }

  async function applyPlan(it, ops) {
    if (!ops.length) return toast('No marcaste nada para aplicar.');
    it.state = 'applying';
    renderThread();
    try {
      const res = await applyInEditor(E, ops, (s) => {
        it.step = s;
        renderThread();
      });
      Object.assign(it, { state: 'done', done: res.done, failed: res.failed, post: res.post });
      toast(res.failed.length ? 'Plan aplicado con avisos' : 'Plan aplicado', res.failed.length ? 'info' : 'ok');
    } catch (e) {
      Object.assign(it, { state: 'done', done: [], failed: [e.message] });
    }
    renderThread();
  }

  renderThread();
  wrap.append(
    h('div', { class: 'card ai-hero' },
      h('div', { class: 'card-title' }, h('h2', null, '✨ Claude edita contigo'), status),
      engineBox,
      input,
      h('div', { class: 'chips as-chips' }, SUGGESTIONS.map(([l, t]) => h('button', { class: 'chip', onclick: () => { input.value = t; st.draft = t; input.focus(); } }, l))),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'hint' }, `Video de ${fmtTime(E.player.total)} · Ctrl+Enter para enviar`), send)
    ),
    thread,
    h('p', { class: 'hint' }, 'Cada pedido usa unos 2.000 a 4.000 tokens de tu plan (Sonnet). Las imágenes, la música y los sonidos se crean en tu PC, sin gastar tokens. Sin internet se usa la IA local.')
  );
  return wrap;
}
