// Diálogos de guion: generador, ganchos, plantillas y texto de publicación.
import { h, icon, modal, toast, field, segmented, select, textInput } from '../lib/dom.js';
import { HOOKS, CTAS, TONES, FORMATS, TEMPLATES, PLATFORMS, fillHook, generateScript, generatePost } from '../core/script-tools.js';
import { shareText } from './share.js';

export async function generatorDialog(initial = {}) {
  const st = { tema: '', audiencia: '', beneficio: '', cta: CTAS[0], tono: 'cercano', formato: 'consejos', duracion: 45, variant: 0, ...initial };
  const out = h('textarea', { class: 'input', rows: 10 });
  const regen = () => (out.value = generateScript(st));
  const upd = (k) => (v) => {
    st[k] = v;
    regen();
  };
  const body = h(
    'div',
    null,
    h('p', { class: 'muted small' }, 'Genera la estructura del guion. Rellena lo que va entre [corchetes] con tu experiencia antes de grabar.'),
    textInput({ label: 'Tema', value: st.tema, placeholder: 'p. ej. ahorro, fitness, recetas rápidas', onInput: upd('tema') }),
    h('div', { class: 'two' },
      textInput({ label: 'Audiencia', value: st.audiencia, placeholder: 'p. ej. personas con ansiedad', onInput: upd('audiencia') }),
      textInput({ label: 'Resultado que obtienen', value: st.beneficio, placeholder: 'p. ej. dormir mejor en 7 días', onInput: upd('beneficio') })
    ),
    select({ label: 'Formato', value: st.formato, options: Object.entries(FORMATS), onChange: upd('formato') }),
    segmented({ label: 'Tono', value: st.tono, options: Object.entries(TONES).map(([k, v]) => [k, v.label]), onChange: upd('tono') }),
    segmented({ label: 'Duración', value: st.duracion, options: [[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '60 s'], [90, '90 s']], onChange: upd('duracion') }),
    select({ label: 'Llamada a la acción', value: st.cta, options: CTAS.map((c) => [c, c]), onChange: upd('cta') }),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Resultado', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { st.variant++; regen(); } }, icon('magic', 16), 'Otra variante')),
      out
    )
  );
  regen();
  return modal({
    title: 'Generador de guiones',
    body,
    wide: true,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Usar este guion', kind: 'primary', value: () => ({ text: out.value, title: st.tema ? `${FORMATS[st.formato]}: ${st.tema}` : null }) },
    ],
  });
}

export async function hooksDialog(tema = '') {
  const st = { tema, audiencia: '' };
  const list = h('div', { class: 'hook-list' });
  let closeFn;
  const renderList = () =>
    list.replaceChildren(
      ...HOOKS.map((hk) => {
        const text = fillHook(hk, { tema: st.tema || 'tu tema', audiencia: st.audiencia || 'emprendedor' });
        return h('button', { class: 'list-item', onclick: () => closeFn(text) }, h('span', { class: 'grow' }, text));
      })
    );
  renderList();
  return modal({
    title: 'Ganchos para los 3 primeros segundos',
    wide: true,
    body: h(
      'div',
      null,
      h('div', { class: 'two' },
        textInput({ label: 'Tema', value: st.tema, placeholder: 'tu tema', onInput: (v) => { st.tema = v; renderList(); } }),
        textInput({ label: 'Audiencia', value: '', placeholder: 'emprendedor', onInput: (v) => { st.audiencia = v; renderList(); } })
      ),
      h('p', { class: 'muted small' }, 'Toca un gancho para insertarlo al principio del guion.'),
      list
    ),
    actions: [{ label: 'Cerrar', value: null }],
    onOpen: (_p, close) => (closeFn = close),
  });
}

export async function templatesDialog() {
  let closeFn;
  return modal({
    title: 'Plantillas de guion',
    wide: true,
    body: h(
      'div',
      { class: 'list' },
      TEMPLATES.map((t) =>
        h('button', { class: 'list-item', onclick: () => closeFn(t) }, icon('script'), h('div', { class: 'grow' }, h('div', { class: 'title' }, t.name), h('div', { class: 'sub' }, t.text.split('\n')[0])))
      )
    ),
    actions: [{ label: 'Cerrar', value: null }],
    onOpen: (_p, close) => (closeFn = close),
  });
}

export async function postDialog({ tema = '', texto = '' } = {}) {
  const st = { tema, texto, plataforma: 'instagram', cta: '' };
  const out = h('textarea', { class: 'input', rows: 10 });
  const counter = h('small', { class: 'hint' });
  const count = () => {
    const lim = PLATFORMS[st.plataforma].limit;
    counter.textContent = `${out.value.length} / ${lim} caracteres`;
    counter.style.color = out.value.length > lim ? 'var(--danger)' : '';
  };
  const regen = () => {
    out.value = generatePost(st);
    count();
  };
  out.addEventListener('input', count);
  regen();
  return modal({
    title: 'Texto para publicar',
    wide: true,
    body: h(
      'div',
      null,
      segmented({ label: 'Red social', value: st.plataforma, options: Object.entries(PLATFORMS).map(([k, v]) => [k, v.label]), onChange: (v) => { st.plataforma = v; regen(); } }),
      textInput({ label: 'Tema (para hashtags)', value: st.tema, onInput: (v) => { st.tema = v; regen(); } }),
      select({ label: 'Llamada a la acción', value: '', options: [['', 'Automática'], ...CTAS.map((c) => [c, c])], onChange: (v) => { st.cta = v; regen(); } }),
      field('Descripción (editable)', out, null),
      counter
    ),
    actions: [
      { label: 'Cerrar', value: null },
      { label: 'Compartir', value: () => (shareText(out.value), null) },
      {
        label: 'Copiar',
        kind: 'primary',
        value: () => {
          copyText(out.value);
          return null;
        },
      },
    ],
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', 'ok');
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copiado', 'ok');
  }
}
