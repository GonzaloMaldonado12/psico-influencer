// Ideas y calendario de contenido: tablero por estado + próximas publicaciones.
import { h, icon, toast, modal, textInput, select, confirmDialog } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { uid } from '../lib/util.js';
import { PLATFORMS } from '../core/script-tools.js';
import { createScript } from './projects.js';

const STATUSES = [
  ['idea', 'Ideas'],
  ['guion', 'Con guion'],
  ['grabado', 'Grabado'],
  ['editado', 'Editado'],
  ['publicado', 'Publicado'],
];

const today = () => new Date().toISOString().slice(0, 10);

function fmtDay(d) {
  if (!d) return '';
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return d;
  }
}

export default async function render(root, { go }) {
  const ideas = await db.all('ideas');
  const board = h('div', { class: 'kanban' });
  const upcoming = h('div', { class: 'list' });

  const refresh = () => {
    board.replaceChildren(
      ...STATUSES.map(([st, label]) => {
        const items = ideas.filter((i) => i.status === st).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
        return h('section', { class: 'kcol', 'aria-label': label },
          h('h3', null, label, h('span', { class: 'badge' }, items.length)),
          items.map((i) =>
            h('button', { class: 'idea', onclick: () => edit(i) },
              h('div', { class: 'title' }, i.title || 'Sin título'),
              h('div', { class: 'sub' }, [i.date ? fmtDay(i.date) : 'Sin fecha', ...(i.platforms || []).map((p) => PLATFORMS[p]?.label)].filter(Boolean).join(' · '))
            )
          ),
          st === 'idea' ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => edit(null) }, icon('plus', 16), 'Añadir idea') : null
        );
      })
    );
    const soon = ideas.filter((i) => i.date && i.date >= today() && i.status !== 'publicado').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    upcoming.replaceChildren(
      ...(soon.length
        ? soon.map((i) => h('button', { class: 'list-item', onclick: () => edit(i) }, icon('calendar'), h('div', { class: 'grow' }, h('div', { class: 'title' }, i.title), h('div', { class: 'sub' }, `${fmtDay(i.date)} · ${STATUSES.find(([s]) => s === i.status)?.[1] || ''}`))))
        : [h('p', { class: 'muted small' }, 'Pon fecha a tus ideas para verlas aquí.')])
    );
  };

  async function edit(idea) {
    const isNew = !idea;
    const it = idea ? structuredClone(idea) : { id: uid('i_'), title: '', notes: '', status: 'idea', date: '', platforms: ['instagram', 'tiktok'], createdAt: Date.now() };
    const date = h('input', { class: 'input', type: 'date', 'aria-label': 'Fecha de publicación' });
    date.value = it.date || '';
    const plats = h('div', { class: 'chips' });
    const renderPlats = () =>
      plats.replaceChildren(
        ...Object.entries(PLATFORMS).map(([k, p]) =>
          h('button', {
            type: 'button',
            class: `chip${it.platforms.includes(k) ? ' active' : ''}`,
            onclick: () => {
              it.platforms = it.platforms.includes(k) ? it.platforms.filter((x) => x !== k) : [...it.platforms, k];
              renderPlats();
            },
          }, p.label)
        )
      );
    renderPlats();
    const v = await modal({
      title: isNew ? 'Nueva idea' : 'Editar idea',
      body: h('div', null,
        textInput({ label: 'Idea', value: it.title, placeholder: 'p. ej. 3 errores al pedir un aumento', onInput: (x) => (it.title = x) }),
        textInput({ label: 'Notas', value: it.notes, multiline: true, rows: 4, onInput: (x) => (it.notes = x) }),
        select({ label: 'Estado', value: it.status, options: STATUSES, onChange: (x) => (it.status = x) }),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fecha de publicación'), date),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Redes'), plats),
        it.scriptId ? h('p', { class: 'hint' }, 'Tiene un guion vinculado.') : null
      ),
      actions: [
        !isNew ? { label: 'Eliminar', value: 'delete', kind: 'danger' } : null,
        { label: it.scriptId ? 'Abrir guion' : 'Crear guion', value: 'script' },
        { label: 'Guardar', value: 'save', kind: 'primary' },
      ].filter(Boolean),
    });
    if (!v) return;
    it.date = date.value;
    if (v === 'delete') {
      if (!(await confirmDialog('¿Eliminar esta idea?', { ok: 'Eliminar', danger: true }))) return;
      await db.del('ideas', it.id);
      ideas.splice(ideas.findIndex((x) => x.id === it.id), 1);
      return refresh();
    }
    if (!it.title.trim()) return toast('Escribe la idea');
    if (v === 'script') {
      if (!it.scriptId || !(await db.get('scripts', it.scriptId))) {
        const s = await createScript({ title: it.title, text: it.notes ? `${it.notes}\n\n` : '' });
        it.scriptId = s.id;
        if (it.status === 'idea') it.status = 'guion';
      }
    }
    await db.put('ideas', it);
    const idx = ideas.findIndex((x) => x.id === it.id);
    if (idx >= 0) ideas[idx] = it;
    else ideas.push(it);
    refresh();
    if (v === 'script') go(`script/${it.scriptId}`);
  }

  root.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Ideas y calendario'), h('p', { class: 'muted small' }, 'Planifica qué publicar y en qué fase está cada video.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => edit(null) }, icon('plus', 18), 'Nueva idea'))
    ),
    h('div', { class: 'card', style: { marginBottom: '16px' } }, h('div', { class: 'card-title' }, h('h2', null, 'Próximas publicaciones')), upcoming),
    board
  );
  refresh();
}
