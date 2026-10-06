// Estudio IA: guiones con IA local y fondos / portadas con el motor local (ComfyUI en el PC). Sin servicios de pago.
// Todo lo que creas queda en tu biblioteca.
import { h, icon, toast, select, textInput, progressModal, segmented } from '../lib/dom.js';
import * as usage from '../ai/ai-usage.js';
import { probeLocal, generateLocal, enhancePrompt } from '../ai/local-img.js';
import { fmtTime } from '../lib/util.js';
import { addMedia } from '../store.js';
import { createScript } from './projects.js';
import { aiScriptDialog, aiHooksDialog } from './ai-dialogs.js';
import { libraryItems, pickMedia } from './editor-pro.js';

const BG_IDEAS = [
  'Consulta de psicología acogedora, sillón, plantas y luz cálida de tarde, fondo desenfocado, fotografía realista',
  'Estudio minimalista en tonos beige con estantería de libros y lámpara cálida, desenfocado, realista',
  'Sala luminosa estilo escandinavo con ventana grande y plantas, luz natural suave, desenfocado',
  'Fondo abstracto suave con degradado lavanda y turquesa, formas orgánicas, calma',
  'Oficina moderna con paredes de madera clara y plantas, luz de ventana, desenfocado, realista',
];

const COVER_IDEAS = [
  'Fondo para portada de video sobre ansiedad: tonos violeta y turquesa, formas suaves, espacio libre arriba para el título',
  'Fondo cálido y luminoso para portada de video de autoestima, degradado durazno y crema, minimalista',
  'Fondo oscuro elegante con luz turquesa para portada de video de psicología, mucho espacio vacío para texto',
];

async function saveResult(blob, name) {
  return addMedia({ blob, name, kind: 'image', extra: { library: true, ai: true } });
}

export default async function render(root, { query, go }) {
  const { getAISettings, ollamaModels, LLM_MODELS } = await import('../ai/llm.js');
  let [ai, olla, cfg, sum, local] = await Promise.all([getAISettings(), ollamaModels(), usage.getConfig(), usage.summary(), probeLocal()]);
  const refreshUsage = async () => { cfg = await usage.getConfig(); sum = await usage.summary(); };
  let tab = query.tab && query.tab !== 'broll' ? (query.tab === 'fondo' ? 'imagenes' : query.tab) : 'guion';
  const body = h('div');

  const tabs = h('div', { class: 'chips', role: 'tablist' });
  const renderTabs = () =>
    tabs.replaceChildren(
      ...[['guion', '✍️ Guiones'], ['imagenes', '🖼️ Fondos y portadas'], ['biblioteca', '📁 Biblioteca']].map(([k, l]) =>
        h('button', { class: `chip${tab === k ? ' active' : ''}`, role: 'tab', onclick: () => { tab = k; renderTabs(); renderBody(); } }, l)
      )
    );

  const fmtS = (ms) => (ms ? `${(ms / 1000).toFixed(1)} s` : '—');

  /** Estado del motor local de imágenes y sus tiempos. */
  const usageCard = () =>
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('h2', null, 'Motor de imágenes'), h('span', { class: `badge${local.ok ? ' badge-accent' : ''}` }, local.ok ? 'Conectado' : 'No detectado')),
      h('p', { class: 'muted small' }, local.ok
        ? `ComfyUI conectado ✔ (${local.checkpoints.length} modelo${local.checkpoints.length === 1 ? '' : 's'}). Gratis y sin internet.`
        : 'Para crear imágenes abre ComfyUI en este PC (run_nvidia_gpu.bat) y espera a que cargue. Solo disponible en el programa de PC.'),
      local.ok && local.checkpoints.length > 1
        ? select({ label: 'Modelo', value: cfg.checkpoint || local.checkpoints[0], options: local.checkpoints.map((c) => [c, c]), onChange: async (v) => { await usage.setConfig({ checkpoint: v }); await refreshUsage(); } })
        : null,
      h('p', { class: 'muted small' }, `Tiempo medio por imagen: ${fmtS(sum.localAvgMs)} · ${sum.localImages} imágenes creadas este mes.`)
    );

  async function makeImage(prompt, { aspect, onProgress }) {
    if (!local.ok && !window.psicoDesktop?.comfy) throw new Error('El motor de imágenes no está disponible. Abre ComfyUI en el PC y vuelve a intentarlo.');
    // Claude convierte tu descripción en un prompt profesional en inglés (mucho mejor para SDXL); sin Claude se usa tal cual.
    onProgress?.(0.02, 'Preparando la descripción…');
    const best = await enhancePrompt(prompt, aspect);
    const r = await generateLocal(best, { aspect, checkpoint: cfg.checkpoint, expectedMs: sum.localAvgMs || 60000, onProgress });
    await usage.recordLocal(r.ms);
    return r;
  }

  const resultCard = (media, url) =>
    h('div', { class: 'card' },
      h('img', { src: url, alt: media.name, class: 'ai-result' }),
      h('p', { class: 'hint' }, 'Guardado en tu biblioteca. Úsalo en el editor: Fondo › Imagen, Capas › Imagen o video, o como portada.')
    );

  async function runJob(title, fn) {
    const prog = progressModal(title);
    try {
      const res = await fn((t, f) => prog.set(f ?? 0.4, t));
      prog.close();
      return res;
    } catch (e) {
      prog.close();
      toast(e.message, 'error', 7000);
      return null;
    }
  }

  function tabGuion() {
    const provider = olla.length && ai.provider !== 'browser' ? `Ollama en tu PC (${olla[0]})` : `IA en el dispositivo: ${(LLM_MODELS[ai.model] || LLM_MODELS.rapido).label}`;
    return [
      h('div', { class: 'card ai-hero' },
        h('h2', null, 'Guiones con IA'),
        h('p', { class: 'muted small' }, `Escribe en español de Chile, con lenguaje responsable en salud mental. Motor: ${provider}. Con la IA del dispositivo, el modelo se descarga solo la primera vez y luego funciona sin internet.`),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              const r = await aiScriptDialog();
              if (!r) return;
              const s = await createScript({ title: r.title, text: r.text });
              go(`script/${s.id}`);
            },
          }, icon('magic', 18), 'Escribir un guion'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              const hk = await aiHooksDialog();
              if (hk) {
                const s = await createScript({ title: hk.slice(0, 50), text: `${hk}\n\n` });
                go(`script/${s.id}`);
              }
            },
          }, 'Ganchos'),
          h('a', { class: 'btn btn-ghost', href: '#/settings' }, 'Elegir motor de IA')
        )
      ),
    ];
  }

  function imageForm({ intro, ideas, defaultName, aspects }) {
    let prompt = ideas[0];
    let aspect = aspects[0][0];
    const out = h('div');
    const ta = textInput({ label: 'Describe lo que quieres', value: prompt, multiline: true, rows: 3, onInput: (v) => (prompt = v) });
    return [
      h('p', { class: 'muted small' }, intro),
      h('div', { class: 'chips' }, ideas.map((t) => h('button', { class: 'chip', onclick: () => { prompt = t; ta.querySelector('textarea').value = t; } }, t.split(',')[0].slice(0, 38)))),
      ta,
      select({ label: 'Formato', value: aspect, options: aspects, onChange: (v) => (aspect = v) }),
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const media = await runJob('Creando la imagen…', async (st) => {
            const r = await makeImage(prompt, { aspect, onProgress: (f, t) => st(t, f) });
            st('Guardando…', 1);
            await refreshUsage();
            return saveResult(r.blob, `${defaultName} · ${prompt.split(',')[0].slice(0, 36)}`);
          });
          if (media) renderBody();
          if (media) out.replaceChildren(resultCard(media, URL.createObjectURL(media.blob)));
        },
      }, icon('magic', 18), 'Crear imagen'),
      out,
      usageCard(),
    ];
  }

  const tabImagenes = () =>
    imageForm({
      intro: 'Crea fondos realistas para el cambio de fondo del editor, o fondos para portadas. Se guardan en tu biblioteca.',
      ideas: [...BG_IDEAS, ...COVER_IDEAS],
      defaultName: 'IA',
      aspects: [['9:16', 'Vertical 9:16'], ['1:1', 'Cuadrado 1:1'], ['16:9', 'Horizontal 16:9'], ['4:5', 'Retrato 4:5']],
    });

  async function tabBiblioteca() {
    const items = await libraryItems();
    const grid = h('div', { class: 'lib-grid' });
    for (const m of items) {
      const url = URL.createObjectURL(m.blob);
      grid.append(h('div', { class: 'lib-item', title: m.name },
        m.kind === 'video' ? h('video', { src: url, muted: true, playsinline: true, preload: 'metadata' }) : m.kind === 'audio' ? h('div', { style: { padding: '8px', fontSize: '0.8rem' } }, '🎵', h('br'), m.name) : h('img', { src: url, alt: m.name }),
        h('span', null, m.kind === 'video' ? `🎬 ${fmtTime(m.duration || 0)}` : m.kind === 'audio' ? '🎵' : '🖼️')
      ));
    }
    return [
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { await pickMedia(null, 'Subir a la biblioteca'); renderBody(); } }, icon('upload', 18), 'Subir imagen o video')),
      items.length ? grid : h('div', { class: 'empty' }, 'Tu biblioteca está vacía. Sube imágenes o crea fondos con IA.'),
    ];
  }

  async function renderBody() {
    const builders = { guion: tabGuion, imagenes: tabImagenes, biblioteca: tabBiblioteca };
    body.replaceChildren(...[await (builders[tab] || tabGuion)()].flat(Infinity).filter(Boolean));
  }

  renderTabs();
  await renderBody();
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Estudio IA'), h('p', { class: 'muted small' }, 'Guiones, fondos y portadas con inteligencia artificial en tu propio equipo.'))),
    tabs,
    h('div', { style: { marginTop: '14px' } }, body)
  );
}
