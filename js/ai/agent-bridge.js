// Puente MCP (programa de PC): Claude Desktop o Claude Code llaman a las herramientas de
// Psico Influencer; el programa recibe la llamada y la ejecuta aquí, en la app abierta, para que
// veas cada cambio en vivo y puedas deshacerlo. Respuestas en texto breve (pocos tokens).
import { db } from '../lib/db.js';
import { migrateProject } from '../store.js';
import { buildSegments } from '../core/timeline.js';
import { fmtTime, fmtDate, uid, APP_VERSION } from '../lib/util.js';
import { validateOps, opsCatalog, projectSummary, transcriptText } from './agent-ops.js';

const jobs = []; // trabajos largos: { id, what, state: 'run'|'ok'|'error', text, t0, t1 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function job(what, promise) {
  const j = { id: uid('j_'), what, state: 'run', text: '', t0: Date.now(), t1: 0 };
  jobs.push(j);
  if (jobs.length > 20) jobs.shift();
  promise.then(
    (text) => Object.assign(j, { state: 'ok', text: text || 'listo', t1: Date.now() }),
    (e) => Object.assign(j, { state: 'error', text: e?.message || String(e), t1: Date.now() })
  );
  return j;
}

/** Espera hasta `ms` a que termine; si no, sigue en segundo plano. */
async function within(j, ms) {
  const end = Date.now() + ms;
  while (j.state === 'run' && Date.now() < end) await sleep(250);
  return j.state !== 'run';
}

async function latestProject() {
  const all = (await db.all('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  return all[0] ? migrateProject(all[0]) : null;
}

/** Proyecto pedido (o el abierto, o el más reciente) sin abrirlo. */
async function readProject(id) {
  const open = window.__editor?.project;
  if (!id && open) return open;
  if (id && open?.id === id) return open;
  const p = id ? await db.get('projects', id) : await latestProject();
  if (!p) throw new Error(id ? `No existe el proyecto ${id}.` : 'Aún no hay proyectos.');
  return migrateProject(p);
}

/** Abre el proyecto en el editor y espera a que esté listo. */
async function openEditor(id, go) {
  const target = id || window.__editor?.project?.id || (await latestProject())?.id;
  if (!target) throw new Error('Aún no hay proyectos. Graba o importa un video primero.');
  if (window.__editor?.project?.id !== target) {
    if (!(await db.get('projects', target))) throw new Error(`No existe el proyecto ${target}.`);
    go(`editor/${target}`);
    const end = Date.now() + 25000;
    while (window.__editor?.project?.id !== target) {
      if (Date.now() > end) throw new Error('El editor tardó demasiado en abrir.');
      await sleep(200);
    }
    await sleep(400);
  }
  return window.__editor.E;
}

const TOOLS = {
  async estado() {
    const { probeLocal } = await import('./local-img.js');
    const { ollamaModels } = await import('./llm.js');
    const [img, olla] = await Promise.all([probeLocal(), ollamaModels(true)]);
    const P = window.__editor?.project;
    const route = location.hash.replace(/^#\/?/, '').split('/')[0] || 'proyectos';
    const lines = [
      `Psico Influencer ${APP_VERSION} · pantalla: ${route}${P ? ` («${P.title}», id ${P.id})` : ''}`,
      `Imágenes: ${img.ok ? `ComfyUI listo (${img.checkpoints[0] || 'sin modelo'})` : 'ComfyUI apagado (se enciende solo al pedir una imagen)'} · IA local: ${olla.length ? `Ollama ${olla[0]}` : 'no'}`,
    ];
    for (const j of jobs.slice(-6)) {
      const secs = Math.round(((j.t1 || Date.now()) - j.t0) / 1000);
      lines.push(`Trabajo ${j.id} · ${j.what}: ${j.state === 'run' ? `en curso (${secs} s)` : j.state === 'ok' ? `listo · ${j.text}` : `error · ${j.text}`}`);
    }
    return lines.join('\n');
  },

  async proyectos({ limite = 15 } = {}) {
    const all = (await db.all('projects')).map(migrateProject).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.min(50, Number(limite) || 15));
    if (!all.length) return 'Aún no hay proyectos.';
    return all.map((p) => `${p.id} · «${p.title}» · ${fmtTime(buildSegments(p).total)} · ${p.layout.aspect} · ${fmtDate(p.updatedAt)}`).join('\n');
  },

  async proyecto({ id } = {}) {
    const P = await readProject(id);
    return `id ${P.id}\n${projectSummary(P)}`;
  },

  async transcripcion({ id, desde, hasta } = {}) {
    const P = await readProject(id);
    return transcriptText(P, { from: Number(desde) || 0, to: Number.isFinite(Number(hasta)) ? Number(hasta) : Infinity, maxWords: 1500 });
  },

  async operaciones() {
    return opsCatalog();
  },

  async editar({ id, ops, resumen } = {}, go) {
    const E = await openEditor(id, go);
    const total = buildSegments(E.project).total;
    const { ops: valid, dropped } = validateOps(typeof ops === 'string' ? JSON.parse(ops) : ops, total);
    if (!valid.length) throw new Error(`Ninguna operación válida.${dropped.length ? ` ${dropped.join('; ')}` : ''} Llama «operaciones» para ver el catálogo.`);
    const { applyInEditor } = await import('../views/assistant.js');
    const { toast } = await import('../lib/dom.js');
    toast(`Claude está editando: ${resumen || `${valid.length} cambios`}`, 'info', 4000);
    const j = job(`edición (${valid.length} cambios)`, applyInEditor(E, valid).then((r) => {
      const parts = [];
      if (r.done.length) parts.push(`Hecho: ${r.done.join('; ')}`);
      if (r.failed.length) parts.push(`Falló: ${r.failed.join('; ')}`);
      if (r.post) parts.push(`Publicación guardada: ${r.post.titulo}`);
      return parts.join('\n') || 'Sin cambios';
    }));
    const finished = await within(j, 50000);
    const note = dropped.length ? `\nOmitidas: ${dropped.join('; ')}` : '';
    if (!finished) return `Aplicando en la app (trabajo ${j.id}). Algunas tareas tardan (transcripción, imágenes). Consulta «estado» en un minuto.${note}`;
    if (j.state === 'error') throw new Error(j.text);
    return `${j.text}\nDuración ahora: ${fmtTime(buildSegments(E.project).total)}. El usuario puede deshacer con Ctrl+Z.${note}`;
  },

  async guiones({ accion = 'listar', id, titulo, texto } = {}) {
    if (accion === 'listar') {
      const all = (await db.all('scripts')).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
      return all.length ? all.map((s) => `${s.id} · «${s.title}» · ${String(s.text || '').split(/\s+/).filter(Boolean).length} palabras`).join('\n') : 'No hay guiones.';
    }
    if (accion === 'leer') {
      const s = await db.get('scripts', id);
      if (!s) throw new Error('No existe ese guion.');
      return `«${s.title}»\n${s.text}`;
    }
    if (accion === 'crear') {
      if (!String(texto || '').trim()) throw new Error('Falta el texto del guion.');
      const s = { id: uid('s_'), title: String(titulo || 'Guion de Claude').slice(0, 80), text: String(texto), createdAt: Date.now(), updatedAt: Date.now(), by: 'claude' };
      await db.put('scripts', s);
      return `Guion creado: ${s.id} («${s.title}»). Está en Guiones; para el celular: Conectar celular › Guiones › Copiar, y en la app del celular «Pegar».`;
    }
    if (accion === 'actualizar') {
      const s = await db.get('scripts', id);
      if (!s) throw new Error('No existe ese guion.');
      if (titulo) s.title = String(titulo).slice(0, 80);
      if (texto !== undefined) s.text = String(texto);
      s.updatedAt = Date.now();
      await db.put('scripts', s);
      return `Guion ${s.id} actualizado.`;
    }
    if (accion === 'borrar') {
      await db.del('scripts', id);
      return `Guion ${id} borrado.`;
    }
    throw new Error('accion debe ser listar, leer, crear, actualizar o borrar.');
  },

  async imagen({ prompt, uso = 'biblioteca', proyecto, desde, hasta, formato } = {}, go) {
    if (!String(prompt || '').trim()) throw new Error('Falta la descripción (prompt) de la imagen.');
    let j;
    if (uso === 'broll' || uso === 'fondo') {
      const E = await openEditor(proyecto, go);
      const { applyInEditor } = await import('../views/assistant.js');
      const { ops } = validateOps([{ op: 'imagen', prompt, uso, desde, hasta }], buildSegments(E.project).total);
      j = job(`imagen (${uso})`, applyInEditor(E, ops).then((r) => (r.failed.length ? Promise.reject(new Error(r.failed.join('; '))) : `imagen puesta como ${uso}`)));
    } else {
      const { ensureEngine, generateLocal } = await import('./local-img.js');
      const { addMedia } = await import('../store.js');
      j = job('imagen (biblioteca)', (async () => {
        await ensureEngine();
        const r = await generateLocal(String(prompt), { aspect: formato || '9:16' });
        const m = await addMedia({ blob: r.blob, name: `IA · ${String(prompt).slice(0, 40)}`, kind: 'image', extra: { library: true, ai: true, prompt } });
        return `guardada en la biblioteca (${m.id})`;
      })());
    }
    const finished = await within(j, 45000);
    if (!finished) return `Generando en el PC con ComfyUI (trabajo ${j.id}, ~1 min; la primera vez se enciende el motor). Consulta «estado».`;
    if (j.state === 'error') throw new Error(j.text);
    return `Imagen lista: ${j.text}.`;
  },

  async abrir({ vista = 'proyectos', id } = {}, go) {
    const map = { proyectos: '', guiones: 'scripts', grabar: 'record', estudio: 'ia', ajustes: 'settings' };
    if (vista === 'editor') {
      await openEditor(id, go);
      return 'Editor abierto.';
    }
    if (vista === 'guion' && id) {
      go(`script/${id}`);
      return 'Guion abierto.';
    }
    if (!(vista in map)) throw new Error(`vista debe ser: ${Object.keys(map).join(', ')}, editor o guion.`);
    go(map[vista]);
    return `Pantalla «${vista}» abierta.`;
  },

  async deshacer() {
    const E = window.__editor?.E;
    if (!E?.undo) throw new Error('No hay un proyecto abierto en el editor.');
    E.undo();
    return 'Último cambio deshecho.';
  },

  async exportar({ id } = {}, go) {
    const E = await openEditor(id, go);
    if (!E.doExport) throw new Error('No pude abrir la exportación.');
    E.doExport();
    return 'Abrí la exportación en la app: el usuario elige las redes y confirma.';
  },
};

async function callTool(name, args, go) {
  const fn = TOOLS[name];
  if (!fn) throw new Error(`Herramienta desconocida: ${name}`);
  return fn(args, go);
}

export function installAgentBridge({ go }) {
  window.__psicoAgent = {
    call: (name, args) =>
      callTool(name, args || {}, go).then(
        (text) => ({ text: String(text) }),
        (e) => ({ text: e?.message || String(e), isError: true })
      ),
    /** Guiones para el portal del celular (Conectar celular). */
    scripts: async () => (await db.all('scripts')).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40).map((s) => ({ id: s.id, title: s.title, text: s.text })),
  };
}
