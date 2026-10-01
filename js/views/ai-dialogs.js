// Diálogos de IA de texto (guiones, ganchos, mejorar) reutilizables.
import { h, icon, modal, select, segmented, textInput, toast } from '../lib/dom.js';
import { FORMATS, TONES, CTAS, generateScript } from '../core/script-tools.js';
import { copyText } from './script-dialogs.js';

/** Ejecuta la IA mostrando el texto en vivo en `out` y el estado en `status`. */
export async function runAI({ prompt, out, status, maxTokens = 700, temperature = 0.7 }) {
  const { generate } = await import('../ai/llm.js');
  out.value = '';
  status.textContent = 'Preparando la IA…';
  try {
    const text = await generate({
      prompt, maxTokens, temperature,
      onToken: (t) => {
        out.value = t;
        out.scrollTop = out.scrollHeight;
      },
      onStatus: (s) => (status.textContent = s),
      onProgress: (_p, s) => (status.textContent = s),
    });
    out.value = text;
    status.textContent = 'Listo. Revisa y ajusta a tu estilo.';
    return text;
  } catch (e) {
    status.textContent = `La IA local no pudo responder: ${e.message}. Puedes usar el generador rápido.`;
    throw e;
  }
}

/** Formulario de guion con IA. Devuelve { text, title } o null. */
export async function aiScriptDialog(initial = {}) {
  const st = { tema: '', audiencia: '', beneficio: '', formato: 'psicoeducacion', tono: 'cercano', duracion: 45, cta: CTAS[0], ...initial };
  const out = h('textarea', { class: 'input ai-out', rows: 12, placeholder: 'Aquí aparecerá tu guion…' });
  const status = h('p', { class: 'hint' });
  const go = async () => {
    const { promptScript } = await import('../ai/llm.js');
    try {
      await runAI({ prompt: promptScript({ ...st, formato: FORMATS[st.formato], tono: TONES[st.tono]?.label }), out, status, maxTokens: Math.round(st.duracion * 4.5) + 120 });
    } catch {
      /* mensaje ya mostrado */
    }
  };
  return modal({
    title: 'Guion con IA',
    wide: true,
    body: h('div', null,
      textInput({ label: 'Tema', value: st.tema, placeholder: 'p. ej. cómo manejar la ansiedad antes de una entrevista', onInput: (v) => (st.tema = v) }),
      h('div', { class: 'two' },
        textInput({ label: 'Público', value: st.audiencia, placeholder: 'p. ej. jóvenes universitarios', onInput: (v) => (st.audiencia = v) }),
        textInput({ label: 'Qué ganan al verlo', value: st.beneficio, placeholder: 'p. ej. una técnica para calmarse', onInput: (v) => (st.beneficio = v) })
      ),
      select({ label: 'Formato', value: st.formato, options: Object.entries(FORMATS), onChange: (v) => (st.formato = v) }),
      segmented({ label: 'Tono', value: st.tono, options: Object.entries(TONES).map(([k, t]) => [k, t.label]), onChange: (v) => (st.tono = v) }),
      segmented({ label: 'Duración', value: st.duracion, options: [[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '60 s'], [90, '90 s']], onChange: (v) => (st.duracion = v) }),
      select({ label: 'Llamada a la acción', value: st.cta, options: CTAS.map((c) => [c, c]), onChange: (v) => (st.cta = v) }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', onclick: go }, icon('magic', 18), 'Escribir con IA'),
        h('button', { class: 'btn', onclick: () => { out.value = generateScript(st); status.textContent = 'Estructura rápida (sin IA): completa lo que está entre [corchetes].'; } }, 'Generador rápido')
      ),
      status,
      out
    ),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Copiar', value: () => (copyText(out.value), null) },
      { label: 'Usar este guion', kind: 'primary', validate: () => !!out.value.trim() || (toast('Primero genera un guion'), false), value: () => ({ text: out.value.trim(), title: st.tema || 'Guion con IA' }) },
    ],
  });
}

export async function aiHooksDialog(tema = '') {
  const out = h('textarea', { class: 'input ai-out', rows: 12 });
  const status = h('p', { class: 'hint' });
  let t = tema;
  let closeFn;
  const list = h('div', { class: 'hook-list' });
  const go = async () => {
    const { promptHooks } = await import('../ai/llm.js');
    try {
      const text = await runAI({ prompt: promptHooks(t || 'salud mental'), out, status, maxTokens: 400, temperature: 0.9 });
      list.replaceChildren(
        ...text.split('\n').map((l) => l.replace(/^[\s\-*\d.)]+/, '').replace(/^["«]|["»]$/g, '').trim()).filter((l) => l.length > 8).map((l) => h('button', { class: 'list-item', onclick: () => closeFn(l) }, h('span', { class: 'grow' }, l)))
      );
      out.classList.add('hidden');
    } catch {
      /* mensaje ya mostrado */
    }
  };
  return modal({
    title: 'Ganchos con IA',
    wide: true,
    body: h('div', null,
      textInput({ label: 'Tema', value: t, onInput: (v) => (t = v) }),
      h('button', { class: 'btn btn-primary', onclick: go }, icon('magic', 18), 'Crear 10 ganchos'),
      status,
      out,
      list
    ),
    actions: [{ label: 'Cerrar', value: null }],
    onOpen: (_p, close) => (closeFn = close),
  });
}

export async function aiImproveDialog(text) {
  const out = h('textarea', { class: 'input ai-out', rows: 12 });
  const status = h('p', { class: 'hint' });
  const go = async () => {
    const { promptImprove } = await import('../ai/llm.js');
    try {
      await runAI({ prompt: promptImprove(text), out, status, maxTokens: Math.min(1400, Math.round(text.length / 2.5) + 200), temperature: 0.6 });
    } catch {
      /* mensaje ya mostrado */
    }
  };
  setTimeout(go, 50);
  return modal({
    title: 'Mejorar guion con IA',
    wide: true,
    body: h('div', null, status, out),
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Reemplazar mi guion', kind: 'primary', validate: () => !!out.value.trim(), value: () => out.value.trim() },
    ],
  });
}
