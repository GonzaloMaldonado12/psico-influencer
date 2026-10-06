import { h, icon, toast } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, fmtDate, MOBILE_APP, splitWords } from '../lib/util.js';
import { scriptStats } from '../core/script-tools.js';
import { getSettings } from '../store.js';
import { createScript } from './projects.js';
import { generatorDialog, templatesDialog } from './script-dialogs.js';

export default async function render(root, { go }) {
  const [scripts, settings] = await Promise.all([db.all('scripts'), getSettings()]);
  scripts.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  const newFrom = async (data) => {
    const s = await createScript(data);
    go(`script/${s.id}`);
  };

  // Celular: pegar un guion copiado (por ejemplo, escrito con Claude en el PC) y grabarlo.
  const paste = async () => {
    let t = '';
    try {
      t = (await navigator.clipboard.readText()).trim();
    } catch {
      /* sin permiso */
    }
    if (!t) return toast('No encontré texto copiado. Crea un guion nuevo y pégalo dentro.', 'info', 4000);
    newFrom({ title: splitWords(t).slice(0, 6).join(' ').replace(/[.,;:!?¡¿]+$/, '') || 'Guion pegado', text: t });
  };

  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('div', null, h('h1', null, 'Guiones'), h('p', { class: 'muted small' }, MOBILE_APP ? 'Elige qué vas a decir y grábalo con el teleprompter.' : 'Escribe, genera y graba con el teleprompter.')),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn',
          onclick: async () => {
            const t = await templatesDialog();
            if (t) newFrom({ title: t.name, text: t.text });
          },
        }, icon('layout', 18), 'Plantillas'),
        MOBILE_APP
          ? h('button', { class: 'btn', onclick: paste }, icon('paste', 18), 'Pegar')
          : h('button', {
              class: 'btn',
              onclick: async () => {
                const r = await generatorDialog();
                if (r) newFrom({ title: r.title || 'Guion generado', text: r.text });
              },
            }, icon('magic', 18), 'Generar'),
        h('button', { class: 'btn btn-primary', onclick: () => newFrom() }, icon('plus', 18), 'Nuevo')
      )
    ),
    scripts.length
      ? h(
          'div',
          { class: 'list' },
          scripts.map((s) => {
            const st = scriptStats(s.text, settings.wpm);
            return h(
              'div',
              { class: 'list-item' },
              h('button', { style: { all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }, onclick: () => go(`script/${s.id}`) },
                h('div', { class: 'title' }, s.title || 'Sin título'),
                h('div', { class: 'sub' }, [`${st.words} palabras`, `~${fmtTime(st.seconds)}`, fmtDate(s.updatedAt || s.createdAt)].filter(Boolean).join(' · '))
              ),
              h('button', { class: 'btn btn-sm btn-rec', 'aria-label': `Grabar ${s.title}`, onclick: () => (s.text.trim() ? go(`record?script=${s.id}`) : toast('El guion está vacío')) }, icon('record', 16), 'Grabar')
            );
          })
        )
      : h('div', { class: 'empty' }, icon('script', 36), h('h2', null, 'Sin guiones todavía'), h('p', null, MOBILE_APP ? 'Empieza con una plantilla o pega el guion que escribiste en el PC.' : 'Empieza con una plantilla o con el generador: te da la estructura y tú pones tu experiencia.'))
  );
}
