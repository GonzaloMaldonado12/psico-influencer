// Pestaña «Músico» del editor (PC): edición pensada para videos de música al estilo de Paul Davids,
// Rick Beato, Jon Dretto o Matteo Mancuso: audio del instrumento sin procesar, segunda cámara
// (manos/diapasón) sincronizada por el audio, cortes y zooms al ritmo, carteles de acordes, escalas,
// tempo y equipo, y capítulos para YouTube.
import { h, icon, toast, promptDialog, segmented } from '../lib/dom.js';
import { uid, clamp, fmtTime } from '../lib/util.js';
import { analyzeMedia } from '../core/media.js';
import { buildSegments, srcToTl } from '../core/timeline.js';
import { detectBeats, syncOffset, chaptersText, MUSIC_CARDS } from '../core/music-tools.js';
import { pickMedia } from './editor-pro.js';
import { copyText } from './script-dialogs.js';

const PIP = {
  recuadro: { layout: 'pip', w: 0.42, x: 0.74, y: 0.78, label: 'Recuadro' },
  inferior: { layout: 'pip', w: 1, x: 0.5, y: 0.75, label: 'Mitad inferior' },
  completa: { layout: 'full', label: 'Pantalla completa' },
};

export function panelMusician(E) {
  const P = E.project;
  const st = (E.state.music ||= { beats: null });
  const isMusic = P.audioMode === 'music';
  const hands = (P.overlays || []).find((o) => o.role === 'hands');
  const chapters = (P.markers || []).filter((m) => m.label).sort((a, b) => a.t - b.t);

  const setMusicAudio = (on) => {
    P.audioMode = on ? 'music' : 'voice';
    // Instrumento: sin ecualizador ni compresor de voz y sin bajar la música bajo la voz.
    Object.assign(P.audio, on ? { enhance: false, duck: false } : { enhance: true, duck: true });
    E.changed({ audio: true, panelRefresh: true });
    toast(on ? 'Audio de instrumento: sonido natural, solo nivelado a -14 LUFS al exportar.' : 'Audio de voz', 'ok');
  };

  async function addHandsCam() {
    const m = await pickMedia('video', 'Video de la cámara de manos o diapasón');
    if (!m) return;
    const done = toast('Sincronizando por el audio…', 'info', 4000);
    let offset = 0;
    try {
      const [a, b] = await Promise.all([analyzeMedia(P.clips[0].mediaId), analyzeMedia(m.id)]);
      if (a?.env?.length && b?.env?.length) offset = syncOffset(a.env, b.env, a.hop || 0.02, 30).offset;
    } catch {
      /* sin audio: se pone al inicio */
    }
    const total = E.player.total;
    const tl = buildSegments(P);
    P.overlays ||= [];
    P.overlays = P.overlays.filter((o) => o.role !== 'hands');
    const start = offset < 0 ? clamp(srcToTl(tl, 0, -offset) ?? -offset, 0, total) : 0;
    P.overlays.push({ id: uid('o_'), role: 'hands', kind: 'broll', mediaId: m.id, mediaKind: 'video', name: m.name, start, end: total, srcStart: Math.max(0, offset), anim: 'none', ...PIP.recuadro });
    await E.player.loadOverlays();
    E.changed({ panelRefresh: true });
    toast(`Cámara de manos sincronizada (${offset >= 0 ? '+' : ''}${offset.toFixed(2)} s)`, 'ok');
    return done;
  }

  async function analyzeBeat() {
    const c = P.clips[0];
    if (!c) return;
    const a = await analyzeMedia(c.mediaId);
    if (!a?.env?.length) return toast('No pude leer el audio del video.', 'error');
    const r = detectBeats(a.env, a.hop || 0.02);
    if (!r.bpm) return toast('No encontré un pulso claro (¿hay solo voz?).');
    const tl = buildSegments(P);
    st.beats = { bpm: r.bpm, confidence: r.confidence, beats: r.beats.map((t) => srcToTl(tl, 0, t)).filter((t) => t != null) };
    E.renderPanel();
  }

  const beatMarkers = () => {
    P.markers = (P.markers || []).filter((m) => !m.beat);
    st.beats.beats.forEach((t, i) => i % 4 === 0 && P.markers.push({ id: uid('k_'), t: +t.toFixed(3), beat: true }));
    E.changed({ panelRefresh: true });
    E.redrawTimeline();
    toast('Marcadores en cada compás: corta sobre ellos (S) para editar a tiempo.', 'ok', 4500);
  };
  const beatZooms = () => {
    P.effects = (P.effects || []).filter((f) => !f.beat);
    const down = st.beats.beats.filter((_, i) => i % 8 === 0).slice(0, 40);
    for (const t of down) P.effects.push({ id: uid('f_'), kind: 'punch', start: t, end: t + 0.18, amount: 0.35, beat: true });
    E.changed({ panelRefresh: true });
    E.redrawTimeline();
    toast(`${down.length} zooms suaves cada 2 compases`, 'ok');
  };

  async function addCard(key) {
    const c = MUSIC_CARDS[key];
    const text = await promptDialog(c.label, '', { placeholder: c.example });
    if (!text?.trim()) return;
    const start = clamp(E.player.t, 0, Math.max(0, E.player.total - 0.5));
    P.overlays ||= [];
    P.overlays.push({
      id: uid('o_'), kind: 'text', text: text.trim(), start, end: Math.min(E.player.total, start + (key === 'equipo' ? 5 : 3)),
      x: 0.5, y: c.y, size: c.size, color: '#FFFFFF', box: true, boxColor: key === 'acorde' ? '#111111' : E.brand.primary || '#111111',
      boxOpacity: 0.82, font: key === 'acorde' ? 'condensed' : 'sans', upper: false, anim: key === 'equipo' ? 'slide' : 'pop',
    });
    E.changed({ panelRefresh: true });
  }

  async function addChapter() {
    const label = await promptDialog(`Capítulo en ${fmtTime(E.player.t)}`, '', { placeholder: 'Ej.: El solo de guitarra' });
    if (!label?.trim()) return;
    (P.markers ||= []).push({ id: uid('k_'), t: +E.player.t.toFixed(2), label: label.trim() });
    E.changed({ panelRefresh: true });
    E.redrawTimeline();
  }

  async function chaptersWithClaude() {
    const { askClaude, claudeReason } = await import('../ai/claude.js');
    const { transcriptText } = await import('../ai/agent-ops.js');
    const done = toast('Claude está armando los capítulos…', 'info', 6000);
    try {
      const r = await askClaude({
        task: 'short',
        system: 'Divides videos de música (lecciones, análisis, reacciones) en capítulos de YouTube: 3 a 10, títulos cortos y atractivos en español, el primero en 0. Solo JSON.',
        prompt: `Duración ${fmtTime(E.player.total)}.\n${transcriptText(P, { maxWords: 1200 })}`,
        schema: { type: 'object', properties: { capitulos: { type: 'array', items: { type: 'object', properties: { t: { type: 'number' }, titulo: { type: 'string' } }, required: ['t', 'titulo'] } } }, required: ['capitulos'], additionalProperties: false },
      });
      P.markers = (P.markers || []).filter((m) => !m.label);
      for (const c of r.data?.capitulos || []) P.markers.push({ id: uid('k_'), t: clamp(Number(c.t) || 0, 0, E.player.total), label: String(c.titulo).slice(0, 60) });
      E.changed({ panelRefresh: true });
      E.redrawTimeline();
    } catch (e) {
      toast(claudeReason(e), 'error', 5000);
    }
    return done;
  }

  return [
    h('div', { class: 'card ai-hero' },
      h('h2', null, '🎸 Modo músico'),
      h('p', { class: 'muted small' }, 'Para clases, análisis y covers: el instrumento suena natural, la cámara de manos va sincronizada y los carteles de acordes y escalas se ven claros.'),
      segmented({ label: 'Audio', value: isMusic ? 'music' : 'voice', options: [['voice', 'Voz (charla)'], ['music', 'Instrumento']], onChange: (v) => setMusicAudio(v === 'music') }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => { P.layout.aspect = '16:9'; E.changed({ size: true, panelRefresh: true }); } }, 'YouTube 16:9'),
        h('button', { class: 'btn btn-sm', onclick: () => { P.layout.aspect = '9:16'; E.changed({ size: true, panelRefresh: true }); } }, 'Reel 9:16')
      )
    ),
    h('h3', null, 'Cámara de manos / diapasón'),
    h('p', { class: 'hint' }, 'Graba con dos cámaras a la vez (el celular apuntando a tus manos). Se sincroniza sola por el sonido.'),
    hands
      ? h('div', null,
          segmented({ label: 'Ubicación', value: hands.layout === 'full' ? 'completa' : hands.w >= 0.99 ? 'inferior' : 'recuadro', options: Object.entries(PIP).map(([k, v]) => [k, v.label]), onChange: (k) => { const { label, ...rest } = PIP[k]; Object.assign(hands, rest); E.changed({ panelRefresh: true }); } }),
          h('div', { class: 'row' },
            h('button', { class: 'btn btn-sm', onclick: addHandsCam }, 'Cambiar video'),
            h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { P.overlays = P.overlays.filter((o) => o !== hands); await E.player.loadOverlays(); E.changed({ panelRefresh: true }); } }, 'Quitar')
          ))
      : h('button', { class: 'btn btn-sm btn-primary', onclick: addHandsCam }, icon('plus', 16), 'Agregar cámara de manos'),
    h('h3', null, 'Ritmo'),
    st.beats
      ? h('div', null,
          h('p', null, h('b', null, `${st.beats.bpm} BPM`), h('span', { class: 'muted small' }, ` · confianza ${Math.round(st.beats.confidence * 100)}%`)),
          h('div', { class: 'row' }, h('button', { class: 'btn btn-sm', onclick: beatMarkers }, 'Marcadores por compás'), h('button', { class: 'btn btn-sm', onclick: beatZooms }, 'Zoom suave al ritmo')))
      : h('button', { class: 'btn btn-sm', onclick: analyzeBeat }, icon('wave', 16), 'Detectar tempo'),
    h('h3', null, 'Carteles musicales'),
    h('p', { class: 'hint' }, `Se agregan en el cursor (${fmtTime(E.player.t)}).`),
    h('div', { class: 'lb-grid' }, Object.entries(MUSIC_CARDS).map(([k, c]) => h('button', { class: 'lib-chip', onclick: () => addCard(k) }, c.label))),
    h('h3', null, 'Capítulos de YouTube'),
    chapters.length ? h('div', { class: 'list' }, chapters.map((m) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, `${fmtTime(m.t)} · ${m.label}`), h('button', { class: 'icon-btn', 'aria-label': 'Quitar capítulo', onclick: () => { P.markers = P.markers.filter((x) => x !== m); E.changed({ panelRefresh: true }); E.redrawTimeline(); } }, icon('trash', 16))))) : '',
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', onclick: addChapter }, icon('plus', 16), 'Capítulo en el cursor'),
      window.psicoDesktop?.claude ? h('button', { class: 'btn btn-sm', onclick: chaptersWithClaude }, icon('sparkle', 16), 'Capítulos con Claude') : null,
      chapters.length ? h('button', { class: 'btn btn-sm', onclick: () => copyText(chaptersText(P.markers)) }, icon('copy', 16), 'Copiar para la descripción') : null
    ),
  ];
}
