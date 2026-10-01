import { h, icon, toast, confirmDialog } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, debounce, MOBILE_APP } from '../lib/util.js';
import { scriptStats } from '../core/script-tools.js';
import { getSettings } from '../store.js';
import { generatorDialog, hooksDialog, templatesDialog, postDialog } from './script-dialogs.js';
import { createScript } from './projects.js';
import { aiScriptDialog, aiImproveDialog, aiHooksDialog } from './ai-dialogs.js';

export default async function render(root, { id, go }) {
  const [script, settings] = await Promise.all([db.get('scripts', id), getSettings()]);
  if (!script) {
    root.append(h('div', { class: 'empty' }, h('h2', null, 'Guion no encontrado'), h('a', { class: 'btn', href: '#/scripts' }, 'Volver')));
    return;
  }
  const title = h('input', { class: 'input', type: 'text', placeholder: 'Título del guion', 'aria-label': 'Título' });
  title.value = script.title;
  const text = h('textarea', { class: 'input', placeholder: 'Escribe aquí lo que vas a decir. Frases cortas, como hablas.\n\nConsejo: empieza con un gancho que detenga el scroll.', 'aria-label': 'Texto del guion' });
  text.value = script.text;
  const stats = h('div', { class: 'stats' });
  const wpmNote = `a ${settings.wpm} palabras/min`;

  const save = debounce(async () => {
    script.title = title.value.trim() || 'Sin título';
    script.text = text.value;
    script.updatedAt = Date.now();
    await db.put('scripts', script);
  }, 400);
  const updateStats = () => {
    const st = scriptStats(text.value, settings.wpm);
    stats.replaceChildren(
      h('span', null, h('b', null, st.words), ' palabras'),
      h('span', null, h('b', null, `~${fmtTime(st.seconds)}`), ` ${wpmNote}`),
      h('span', null, h('b', null, st.chars), ' caracteres'),
      st.seconds > 90 ? h('span', { style: { color: 'var(--warn)' } }, 'Largo para Reels/TikTok (ideal: 15–60 s)') : ''
    );
  };
  const onEdit = () => {
    updateStats();
    save();
  };
  title.addEventListener('input', onEdit);
  text.addEventListener('input', onEdit);
  updateStats();

  const insertAtTop = (s) => {
    text.value = `${s}\n\n${text.value}`.trimEnd();
    onEdit();
  };

  root.append(
    h('div', { class: 'page-head' },
      h('div', { class: 'row' }, h('a', { class: 'icon-btn', href: '#/scripts', 'aria-label': 'Volver' }, icon('back')), h('h1', null, 'Guion')),
      h('div', { class: 'actions' },
        h('button', {
          class: 'btn btn-rec',
          onclick: async () => {
            save.flush();
            if (!text.value.trim()) return toast('Escribe el guion primero');
            go(`record?script=${script.id}`);
          },
        }, icon('record', 18), 'Grabar con teleprompter')
      )
    ),
    h('div', { class: 'script-editor' },
      title,
      h('div', { class: 'toolbar' },
        // Celular: solo lo necesario para grabar (las herramientas de IA están en el PC).
        MOBILE_APP ? h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            let t = '';
            try {
              t = (await navigator.clipboard.readText()).trim();
            } catch {
              /* sin permiso */
            }
            if (!t) return toast('No encontré texto copiado');
            if (text.value.trim() && !(await confirmDialog('¿Reemplazar el texto actual por el que copiaste?', { ok: 'Reemplazar' }))) return;
            text.value = t;
            onEdit();
          },
        }, icon('paste', 16), 'Pegar') : null,
        MOBILE_APP ? null : h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: async () => {
            const r = await aiScriptDialog({ tema: title.value === 'Nuevo guion' ? '' : title.value });
            if (!r) return;
            if (text.value.trim() && !(await confirmDialog('¿Reemplazar el texto actual por el guion de la IA?', { ok: 'Reemplazar' }))) return;
            text.value = r.text;
            if (!title.value.trim() || title.value === 'Nuevo guion') title.value = r.title;
            onEdit();
          },
        }, icon('magic', 16), 'Escribir con IA'),
        MOBILE_APP ? null : h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            if (!text.value.trim()) return toast('Escribe o genera un guion primero');
            const v = await aiImproveDialog(text.value);
            if (v) {
              text.value = v;
              onEdit();
            }
          },
        }, icon('magic', 16), 'Mejorar con IA'),
        MOBILE_APP ? null : h('button', { class: 'btn btn-sm', onclick: async () => { const hk = await aiHooksDialog(title.value); if (hk) insertAtTop(hk); } }, icon('magic', 16), 'Ganchos IA'),
        h('button', { class: 'btn btn-sm', onclick: async () => { const hk = await hooksDialog(title.value); if (hk) insertAtTop(hk); } }, icon('bulb', 16), 'Ganchos rápidos'),
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const t = await templatesDialog();
            if (!t) return;
            if (text.value.trim() && !(await confirmDialog('¿Reemplazar el texto actual por la plantilla?', { ok: 'Reemplazar' }))) return;
            text.value = t.text;
            onEdit();
          },
        }, icon('layout', 16), 'Plantillas'),
        MOBILE_APP ? null : h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const r = await generatorDialog({ tema: title.value === 'Nuevo guion' ? '' : title.value });
            if (!r) return;
            if (text.value.trim() && !(await confirmDialog('¿Reemplazar el texto actual por el guion generado?', { ok: 'Reemplazar' }))) return;
            text.value = r.text;
            if (r.title && (!title.value.trim() || title.value === 'Nuevo guion')) title.value = r.title;
            onEdit();
          },
        }, icon('magic', 16), 'Generador'),
        MOBILE_APP ? null : h('button', { class: 'btn btn-sm', onclick: () => postDialog({ tema: title.value, texto: text.value }) }, icon('share', 16), 'Texto para publicar'),
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            save.flush();
            const c = await createScript({ title: `${script.title} (copia)`, text: text.value });
            go(`script/${c.id}`);
          },
        }, icon('copy', 16), 'Duplicar'),
        h('button', {
          class: 'btn btn-sm btn-danger',
          onclick: async () => {
            if (!(await confirmDialog('¿Eliminar este guion?', { ok: 'Eliminar', danger: true }))) return;
            save.cancel();
            await db.del('scripts', script.id);
            go('scripts');
          },
        }, icon('trash', 16), 'Eliminar')
      ),
      stats,
      text
    )
  );
  return () => save.flush();
}
