import { h, icon, toast, confirmDialog, promptDialog, pickFile, modal } from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, fmtDate, fmtBytes, uid } from '../lib/util.js';
import { newProject, addMedia, mediaUrl, saveProject, deleteProject, duplicateProject, getBrand, migrateProject, clipFrom } from '../store.js';
import { probeVideo, captureThumb, hasScreenCapture } from '../core/media.js';
import { buildSegments } from '../core/timeline.js';

/** Importa archivos de video del dispositivo y crea un proyecto con ellos. */
export async function importVideos(files, { projectId } = {}) {
  const recs = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    let meta;
    try {
      meta = await probeVideo(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (!meta.duration) throw new Error(`No se pudo leer «${file.name}». Prueba con MP4 o MOV.`);
    recs.push(await addMedia({ blob: file, name: file.name, kind: 'video', ...meta }));
  }
  const brand = await getBrand();
  let p;
  if (projectId) {
    p = migrateProject(await db.get('projects', projectId));
    p.clips.push(...recs.map(clipFrom));
  } else {
    p = newProject({ title: files[0].name.replace(/\.[^.]+$/, ''), clips: recs, brand });
    const first = recs[0];
    if (first.width > first.height) p.layout.aspect = '16:9';
  }
  p.thumb ||= await captureThumb(await mediaUrl(recs[0].id));
  await saveProject(p);
  return p;
}

/** Menú de opciones: items = [[valor, icono, texto]]. Devuelve el valor elegido o null. */
export function menuDialog(title, items) {
  let closeFn = () => {};
  return modal({
    title,
    body: h('div', { class: 'list' }, items.map(([v, ic, label]) => h('button', { class: 'list-item', onclick: () => closeFn(v) }, icon(ic), h('span', { class: 'grow' }, label)))),
    actions: [],
    onOpen: (_panel, close) => (closeFn = close),
  });
}

export async function createScript(data = {}) {
  const s = { id: uid('s_'), title: 'Nuevo guion', text: '', createdAt: Date.now(), updatedAt: Date.now(), ...data };
  await db.put('scripts', s);
  return s;
}

export default async function render(root, { go }) {
  const projects = (await db.all('projects')).map(migrateProject).sort((a, b) => b.updatedAt - a.updatedAt);
  let usage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) usage = `${fmtBytes(est.usage)} usados de ${fmtBytes(est.quota)} disponibles`;
  } catch {
    /* sin datos */
  }

  const onImport = async () => {
    const files = await pickFile('video/*', true);
    if (!files.length) return;
    toast('Importando video…');
    try {
      const p = await importVideos(files);
      go(`editor/${p.id}`);
    } catch (e) {
      toast(e.message, 'error', 5000);
    }
  };

  const quick = h(
    'div',
    { class: 'quick' },
    h('button', { class: 'quick-btn rec', onclick: () => go('record') }, icon('record', 22), h('span', null, 'Grabar', h('br'), h('small', null, 'con teleprompter'))),
    h('button', { class: 'quick-btn', onclick: onImport }, icon('upload', 22), h('span', null, 'Importar', h('br'), h('small', null, 'video de la galería'))),
    h('button', {
      class: 'quick-btn',
      onclick: async () => {
        const s = await createScript();
        go(`script/${s.id}`);
      },
    }, icon('script', 22), h('span', null, 'Nuevo guion', h('br'), h('small', null, 'plantillas e ideas'))),
    h('button', { class: 'quick-btn', onclick: () => go('ia') }, icon('magic', 22), h('span', null, 'Estudio IA', h('br'), h('small', null, 'guiones, fondos y portadas'))),
    h('button', { class: 'quick-btn', onclick: () => go('luz') }, icon('bulb', 22), h('span', null, 'Iluminación', h('br'), h('small', null, 'luz profesional en casa'))),
    hasScreenCapture()
      ? h('button', { class: 'quick-btn', onclick: () => go('screen') }, icon('screen', 22), h('span', null, 'Pantalla', h('br'), h('small', null, 'grabar pantalla + cámara')))
      : '',
    h('button', { class: 'quick-btn', onclick: () => go('brand') }, icon('brand', 22), h('span', null, 'Mi marca', h('br'), h('small', null, 'logo, colores, estilo')))
  );

  const grid = h('div', { class: 'grid' });
  const renderGrid = () => {
    grid.replaceChildren(
      ...projects.map((p) => {
        const dur = buildSegments(p).total;
        return h(
          'div',
          { class: 'proj' },
          h(
            'button',
            { class: 'proj-open', style: { all: 'unset', cursor: 'pointer', display: 'block' }, 'aria-label': `Abrir ${p.title}`, onclick: () => go(`editor/${p.id}`) },
            h('div', { class: 'proj-thumb', style: p.thumb ? { backgroundImage: `url("${p.thumb}")` } : {} }, h('span', { class: 'badge' }, fmtTime(dur))),
            h(
              'div',
              { class: 'proj-body' },
              h('div', { class: 'proj-title' }, p.title),
              h('div', { class: 'proj-meta' }, `${p.layout.aspect} · ${fmtDate(p.updatedAt)}${p.exports?.length ? ` · ${p.exports.length} export.` : ''}`)
            )
          ),
          h('button', { class: 'icon-btn round proj-menu', 'aria-label': 'Opciones del proyecto', onclick: () => projectMenu(p) }, icon('more'))
        );
      })
    );
  };

  const projectMenu = async (p) => {
    const choice = await menuDialog(p.title, [
      ['open', 'edit', 'Abrir en el editor'],
      ...(p.exports?.length ? [['exports', 'download', `Videos exportados (${p.exports.length})`]] : []),
      ['rename', 'text', 'Renombrar'],
      ['dup', 'copy', 'Duplicar (para otra versión)'],
      ['takes', 'record', 'Añadir tomas grabando'],
      ['del', 'trash', 'Eliminar'],
    ]);
    if (choice === 'open') go(`editor/${p.id}`);
    if (choice === 'exports') {
      const results = [];
      for (const e of p.exports) {
        const m = await db.get('media', e.mediaId);
        if (m?.blob) results.push({ blob: m.blob, aspect: e.aspect, width: e.width, height: e.height, ext: e.ext || (/webm/.test(m.type) ? 'webm' : 'mp4') });
      }
      if (!results.length) return toast('No se encontraron los archivos exportados.');
      const { showResults } = await import('./export.js');
      showResults(p, results);
    }
    if (choice === 'takes') go(`record?project=${p.id}`);
    if (choice === 'rename') {
      const t = await promptDialog('Nuevo nombre', p.title);
      if (t?.trim()) {
        p.title = t.trim();
        await saveProject(p);
        renderGrid();
      }
    }
    if (choice === 'dup') {
      const c = await duplicateProject(p);
      projects.unshift(migrateProject(c));
      renderGrid();
      toast('Proyecto duplicado', 'ok');
    }
    if (choice === 'del') {
      if (await confirmDialog(`Se borrará «${p.title}» y sus videos de este dispositivo. No se puede deshacer.`, { ok: 'Eliminar', danger: true })) {
        await deleteProject(p);
        projects.splice(projects.indexOf(p), 1);
        renderGrid();
        toast('Proyecto eliminado');
      }
    }
  };

  renderGrid();
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Tus videos'), usage ? h('p', { class: 'muted small' }, usage) : null)),
    quick,
    h('div', { class: 'section' }, h('h2', null, `Proyectos (${projects.length})`)),
    projects.length
      ? grid
      : h(
          'div',
          { class: 'empty' },
          icon('film', 36),
          h('h2', null, 'Aún no hay videos'),
          h('p', null, 'Escribe un guion y grábalo con el teleprompter, o importa un video para añadirle subtítulos y tu marca.'),
          h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } }, h('button', { class: 'btn btn-primary', onclick: () => go('record') }, icon('record'), 'Grabar ahora'), h('button', { class: 'btn', onclick: onImport }, icon('upload'), 'Importar'))
        )
  );
}
