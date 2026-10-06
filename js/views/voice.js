// Pestaña «Voz» del editor (PC): locución con voces de IA locales (Piper). El motor y cada voz se descargan
// una sola vez y después funcionan sin internet. El audio entra como pista en la línea de tiempo.
import { h, toast, slider } from '../lib/dom.js';
import { addMedia } from '../store.js';
import { decodeAudio } from '../core/media.js';
import { placeMedia } from './editor-studio.js';

export function panelVoice(E) {
  const P = E.project;
  const D = window.psicoDesktop;
  const st = (E.state.voice ||= { voice: 'es_MX-claude-high', speed: 1, text: '', info: null, busy: false, prog: null, last: null });
  if (!st.text) st.text = (P.scriptText || '').trim();
  const root = h('div', { class: 'panel-body' });

  if (!D?.tts) {
    return h('div', { class: 'panel-body' }, h('p', { class: 'muted' }, 'Las voces de IA están disponibles en el programa de PC.'));
  }

  async function refresh() {
    st.info = await D.tts.status().catch(() => null);
    render();
  }

  async function generate(place) {
    if (st.busy) return;
    const text = st.text.trim();
    if (!text) return toast('Escribe o pega el texto que quieres que diga.');
    st.busy = true;
    st.prog = { p: 0, text: 'Preparando…' };
    render();
    const off = D.tts.onProgress((d) => { st.prog = d; render(); });
    try {
      await D.tts.ensure(st.voice); // solo descarga la primera vez
      st.prog = { p: 1, text: 'Generando la voz…' };
      render();
      const bytes = await D.tts.synth(text, { voice: st.voice, speed: st.speed });
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const v = (st.info?.voices || []).find((x) => x.id === st.voice);
      const name = `Voz ${v?.name || 'IA'} · ${text.slice(0, 24)}`;
      const duration = (await decodeAudio(blob)).duration;
      const m = await addMedia({ blob, name: `${name}.wav`, kind: 'audio', duration, extra: { library: true, tts: st.voice } });
      st.last = { url: URL.createObjectURL(blob), duration, m };
      if (place) await placeMedia(E, m, E.player.t);
      toast(place ? `Voz agregada a la línea de tiempo (${duration.toFixed(1)} s)` : 'Voz lista. Escúchala abajo.');
    } catch (e) {
      toast(`No se pudo generar la voz: ${e.message}`);
    } finally {
      off();
      st.busy = false;
      st.prog = null;
      refresh();
    }
  }

  function render() {
    const voices = st.info?.voices || [];
    const cur = voices.find((v) => v.id === st.voice);
    const ta = h('textarea', { class: 'input', rows: 6, placeholder: 'Escribe lo que quieres que diga la voz…', oninput: (e) => (st.text = e.target.value) }, st.text);
    root.replaceChildren(
      h('div', { class: 'field' },
        h('label', {}, 'Texto'),
        ta,
        h('div', { class: 'row', style: 'gap:8px;margin-top:6px;flex-wrap:wrap' },
          h('button', { class: 'btn btn-sm', onclick: () => { st.text = (P.scriptText || '').trim(); if (!st.text) toast('Este proyecto no tiene guion.'); render(); } }, 'Usar el guion'),
          h('button', { class: 'btn btn-sm', onclick: async () => { try { st.text = (await navigator.clipboard.readText()).trim(); render(); } catch { toast('No pude leer el portapapeles.'); } } }, 'Pegar'))),
      h('div', { class: 'field' },
        h('label', {}, 'Voz'),
        h('div', { class: 'voice-list' }, ...voices.map((v) =>
          h('button', { class: `voice-item${v.id === st.voice ? ' on' : ''}`, onclick: () => { st.voice = v.id; render(); } },
            h('b', {}, v.name), h('span', {}, v.desc), h('small', {}, v.ready ? 'Lista' : `Se descarga la 1.ª vez (~${v.mb} MB)`))))),
      slider({ label: `Velocidad · ${st.speed.toFixed(2)}×`, min: 0.7, max: 1.4, step: 0.05, value: st.speed, onInput: (v) => (st.speed = v) }),
      st.prog
        ? h('div', { class: 'progress-wrap' }, h('div', { class: 'muted' }, st.prog.text), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((st.prog.p || 0) * 100)}%` })))
        : h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            h('button', { class: 'btn btn-primary', disabled: st.busy, onclick: () => generate(true) }, 'Generar y poner en el video'),
            h('button', { class: 'btn', disabled: st.busy, onclick: () => generate(false) }, 'Solo escuchar')),
      st.last ? h('audio', { src: st.last.url, controls: true, style: 'width:100%;margin-top:10px' }) : null,
      h('p', { class: 'muted', style: 'font-size:12px;margin-top:10px' }, `Voces locales de código abierto (Piper): sin internet y sin costo después de la primera descarga.${cur?.ready ? '' : ' La primera vez baja el motor y la voz elegida.'}`));
  }

  render();
  refresh();
  return root;
}
