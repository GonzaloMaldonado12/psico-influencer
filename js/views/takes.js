// «Mis tomas» (celular): todo lo que grabaste, listo para guardar en Fotos, corregir la mirada,
// compartir o enviar al PC para editar. La edición completa se hace en el programa de PC.
import { h, icon, toast, modal, confirmDialog, promptDialog } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, fmtBytes, IS_IOS } from '../lib/util.js';
import { getSettings, deleteMedia, updateMedia } from '../store.js';
import { captureThumb } from '../core/media.js';
import { saveBox, sendToPcHelp, takeFileName } from './take-actions.js';
import { shareFile } from './share.js';

const FILTERS = [['all', 'Todas'], ['new', 'Sin guardar'], ['fav', 'Favoritas'], ['done', 'Procesadas']];

function whenLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (same(d, today)) return `Hoy ${hm}`;
  if (same(d, y)) return `Ayer ${hm}`;
  return `${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${hm}`;
}

export default async function render(root, { go }) {
  const settings = await getSettings();
  let filter = (await db.getKV('takesFilter', 'all')) || 'all';
  let items = [];
  let destroyed = false;

  const load = async () => {
    items = (await db.all('media'))
      .filter((m) => (m.kind === 'video' && !m.library) || m.kind === 'export')
      .sort((a, b) => b.createdAt - a.createdAt);
  };
  await load();

  const usage = h('p', { class: 'muted small' });
  const refreshUsage = async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) usage.textContent = `${items.length} videos · ${fmtBytes(est.usage)} usados · quedan ${fmtBytes(est.quota - est.usage)}`;
    } catch {
      /* sin datos */
    }
  };

  const chips = h('div', { class: 'chips', role: 'tablist' });
  const grid = h('div', { class: 'take-grid' });
  const visible = () =>
    items.filter((m) =>
      filter === 'new' ? m.kind !== 'export' && !m.saved : filter === 'fav' ? m.fav : filter === 'done' ? m.kind === 'export' : true
    );

  const renderChips = () =>
    chips.replaceChildren(...FILTERS.map(([k, l]) => h('button', { class: `chip${filter === k ? ' active' : ''}`, role: 'tab', onclick: () => { filter = k; db.setKV('takesFilter', k); renderChips(); renderGrid(); } }, l)));

  const card = (m) =>
    h('button', { class: 'take-card', 'aria-label': `Abrir ${m.name || 'toma'}`, onclick: () => openTake(m) },
      h('div', { class: 'take-img', style: m.thumb ? { backgroundImage: `url("${m.thumb}")` } : {} },
        h('span', { class: 'badge' }, fmtTime(m.duration || 0)),
        m.fav ? h('span', { class: 'take-fav' }, icon('star', 14)) : null,
        m.kind === 'export' ? h('span', { class: 'take-tag' }, m.gaze ? 'Mirada' : 'MP4') : m.saved ? h('span', { class: 'take-tag ok' }, icon('check', 12), 'Guardada') : null
      ),
      h('div', { class: 'take-body' },
        h('div', { class: 'take-title' }, m.scriptTitle || m.name || 'Toma'),
        h('div', { class: 'take-meta' }, whenLabel(m.createdAt))
      )
    );

  function renderGrid() {
    const list = visible();
    grid.replaceChildren(...list.map(card));
    empty.classList.toggle('hidden', list.length > 0);
    refreshUsage();
  }

  const empty = h('div', { class: 'empty hidden' },
    icon('record', 36),
    h('h2', null, 'Aquí aparecerán tus tomas'),
    h('p', null, 'Graba con el teleprompter: cada toma se guarda sola, aunque se cierre la app.'),
    h('button', { class: 'btn btn-primary', onclick: () => go('record') }, icon('record'), 'Grabar ahora')
  );

  async function openTake(m) {
    const rec = (await db.get('media', m.id)) || m;
    const url = URL.createObjectURL(rec.blob);
    const v = h('video', { src: url, controls: true, playsinline: true, class: 'review-video' });
    v.setAttribute('playsinline', '');
    let closeFn = () => {};
    let open = true;
    const info = [
      rec.width && rec.height ? `${Math.min(rec.width, rec.height)}p` : '',
      rec.fps ? `${rec.fps} fps` : '',
      fmtTime(rec.duration || 0),
      fmtBytes(rec.size || rec.blob?.size || 0),
      whenLabel(rec.createdAt),
    ].filter(Boolean).join(' · ');
    const favBtn = h('button', { class: `btn btn-sm${rec.fav ? ' btn-primary' : ''}`, onclick: async () => {
      rec.fav = !rec.fav;
      await updateMedia(rec.id, { fav: rec.fav });
      favBtn.classList.toggle('btn-primary', rec.fav);
      Object.assign(m, { fav: rec.fav });
      renderGrid();
    } }, icon('star', 16), 'Favorita');
    const body = h('div', { class: 'take-detail' },
      v,
      h('p', { class: 'hint center' }, info),
      rec.kind === 'export'
        ? h('button', { class: 'btn btn-primary btn-block btn-lg', onclick: async () => { if (await shareFile(rec.blob, takeFileName(rec))) { await updateMedia(rec.id, { saved: true }); } } }, icon('photos', 20), IS_IOS ? 'Guardar en Fotos' : 'Guardar o compartir')
        : saveBox(rec, settings, { isAlive: () => open && !destroyed, onSaved: () => { Object.assign(m, { saved: true }); renderGrid(); } }),
      h('div', { class: 'take-actions' },
        IS_IOS ? null : h('button', { class: 'btn btn-sm', onclick: () => shareFile(rec.blob, takeFileName(rec)) }, icon('share', 16), 'Compartir'),
        h('button', { class: 'btn btn-sm', onclick: () => sendToPcHelp() }, icon('send', 16), 'Enviar al PC'),
        favBtn,
        h('button', { class: 'btn btn-sm', onclick: async () => {
          const t = await promptDialog('Nombre de la toma', rec.scriptTitle || rec.name || '');
          if (!t?.trim()) return;
          await updateMedia(rec.id, { scriptTitle: t.trim(), name: t.trim() });
          Object.assign(m, { scriptTitle: t.trim(), name: t.trim() });
          renderGrid();
        } }, icon('text', 16), 'Renombrar'),
        h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
          if (!(await confirmDialog('Se borrará esta toma del celular. Si ya la guardaste en Fotos, allí se mantiene.', { ok: 'Eliminar', danger: true }))) return;
          await deleteMedia(rec.id);
          items = items.filter((x) => x.id !== rec.id);
          closeFn();
          renderGrid();
          toast('Toma eliminada');
        } }, icon('trash', 16), 'Eliminar')
      )
    );
    await modal({ title: rec.scriptTitle || rec.name || 'Toma', body, wide: true, actions: [], onOpen: (_p, c) => (closeFn = c) });
    open = false;
    v.pause();
    URL.revokeObjectURL(url);
  }

  async function cleanSaved() {
    const saved = items.filter((m) => m.saved && m.kind !== 'export' && !m.fav);
    const done = items.filter((m) => m.kind === 'export');
    const list = [...saved, ...done];
    if (!list.length) return toast('No hay tomas guardadas para limpiar.');
    const bytes = list.reduce((n, m) => n + (m.size || 0), 0);
    if (!(await confirmDialog(`Se borrarán del celular ${list.length} videos que ya guardaste en ${IS_IOS ? 'Fotos' : 'la galería'} (se liberan ${fmtBytes(bytes)}). Las favoritas se conservan.`, { title: 'Liberar espacio', ok: 'Borrar', danger: true }))) return;
    for (const m of list) await deleteMedia(m.id);
    await load();
    renderGrid();
    toast('Espacio liberado', 'ok');
  }

  root.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Mis tomas'), usage),
      h('div', { class: 'actions' },
        window.psicoDesktop?.takes ? h('button', { class: 'btn btn-sm', onclick: () => window.psicoDesktop.takes.open() }, icon('photos', 16), 'Grabaciones de video') : null,
        window.psicoDesktop ? null : h('button', { class: 'btn btn-sm', onclick: () => sendToPcHelp() }, icon('send', 16), 'Al PC'),
        h('button', { class: 'btn btn-sm', onclick: cleanSaved }, icon('trash', 16), 'Liberar espacio')
      )
    ),
    chips,
    grid,
    empty
  );
  renderChips();
  renderGrid();

  // Miniaturas que faltan (tomas antiguas): se crean de a una, sin bloquear.
  (async () => {
    for (const m of items.filter((x) => !x.thumb).slice(0, 24)) {
      if (destroyed) return;
      try {
        const rec = await db.get('media', m.id);
        if (!rec?.blob) continue;
        const u = URL.createObjectURL(rec.blob);
        const thumb = await captureThumb(u, 0.8, 240);
        URL.revokeObjectURL(u);
        if (thumb) {
          m.thumb = thumb;
          await updateMedia(m.id, { thumb });
          renderGrid();
        }
      } catch {
        /* sin miniatura */
      }
    }
  })();

  return () => {
    destroyed = true;
  };
}
