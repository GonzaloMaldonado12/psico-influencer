// Editor: vista previa en vivo + línea de tiempo + herramientas por pestañas.
import {
  h, icon, toast, modal, slider, toggle, segmented, select, colorPick, textInput, pickFile, confirmDialog, promptDialog, progressModal,
} from '../lib/dom.js';
import { db } from '../lib/db.js';
import { fmtTime, debounce, clamp, splitWords, sanitizeFilename, IS_MOBILE } from '../lib/util.js';
import {
  migrateProject, saveProject, getBrand, getSettings, mediaUrl, addMedia, deleteMedia, previewSize, exportSize, ASPECTS, applyBrandDefaults,
} from '../store.js';
import { Player } from '../core/player.js';
import { analyzeMedia, loadImage, captureThumb } from '../core/media.js';
import {
  buildSegments, keptRanges, cutRange, trimBefore, trimAfter, listCuts, removeCut, clearCuts, cutSource, srcToTl, mergeCuts,
  splitAt, removeSplit, rippleShift, locate,
} from '../core/timeline.js';
import { drawLanes, timelineHeight, SHORTCUTS } from '../core/timeline-pro.js';
import { segKey } from '../core/render.js';
import { loadProjectFonts } from '../core/fonts.js';
import { panelLibrary, importAndPlace } from './editor-studio.js';
import {
  alignWords, retimeText, distributeWords, wordsFromHints, CAPTION_PRESETS, presetStyle, FONTS, captionCues, toSRT, toVTT,
} from '../core/captions.js';
import { findSilences, silenceCuts, speechSeconds } from '../core/audio-analysis.js';
import { COLOR_PRESETS, supportsCanvasFilter } from '../core/render.js';
import { renderStill } from '../core/exporter.js';
import { importVideos } from './projects.js';
import { openExport } from './export.js';
import { downloadBlob, shareFile } from './share.js';
import { panelBackground, panelLight, panelAI, panelLayers, musicLibrary } from './editor-pro.js';
import { panelAssistant } from './assistant.js';
import { panelMusician } from './musician.js';
import { panelVoice } from './voice.js';
import { uid } from '../lib/util.js';
import { PLATFORMS, platformsForAspect } from '../core/platforms.js';

const TABS = [
  ['claude', 'sparkle', 'Claude'],
  ['ai', 'magic', 'IA'],
  ['music', 'music', 'Músico'],
  ['voice', 'mic', 'Voz'],
  ['captions', 'cc', 'Subtítulos'],
  ['cut', 'cut', 'Recortar'],
  ['format', 'aspect', 'Formato'],
  ['bg', 'layout', 'Fondo'],
  ['light', 'color', 'Luz y color'],
  ['layers', 'image', 'Capas'],
  ['lib', 'grid', 'Biblioteca'],
  ['text', 'text', 'Título'],
  ['brand', 'brand', 'Marca'],
  ['audio', 'music', 'Audio'],
  ['cover', 'image', 'Portada'],
];

/** Regiones con voz que siguen en el montaje (descontando cortes). */
export function keptSpeech(clip, a) {
  const kept = keptRanges(clip);
  const regions = a?.regions;
  if (!regions || !regions.length) return kept.map(([s, e]) => ({ start: s, end: e }));
  const out = [];
  for (const r of regions) {
    for (const [s, e] of kept) {
      const a0 = Math.max(r.start, s);
      const b0 = Math.min(r.end, e);
      if (b0 - a0 > 0.05) out.push({ start: a0, end: b0 });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

export default async function render(root, { id, go }) {
  const raw = await db.get('projects', id);
  if (!raw) {
    root.append(h('div', { class: 'empty', style: { margin: '24px' } }, h('h2', null, 'Proyecto no encontrado'), h('a', { class: 'btn', href: '#/' }, 'Volver')));
    return;
  }
  const project = migrateProject(raw);
  const [brand, settings] = await Promise.all([getBrand(), getSettings()]);
  const assets = { logo: brand.logoMediaId ? await loadImage(await mediaUrl(brand.logoMediaId)) : null };
  const analysis = {};
  for (const c of project.clips) {
    const m = await db.get('media', c.mediaId);
    if (m?.analysis) analysis[c.mediaId] = m.analysis;
  }
  let tab = project.captions.words.length || project.captions.pending ? 'captions' : 'ai';
  let markA = null;
  let markB = null;
  let tlZoom = 1;
  const PRO = !IS_MOBILE; // línea de tiempo multipista y Biblioteca: solo en el PC
  const tlSel = { cur: null, seg: null };
  let tlRegions = [];
  let snapOn = true;
  let libSeg = -1;
  let scrubbing = false;
  let capItems = [];
  let destroyed = false;

  // ---------- Estructura ----------
  const canvas = h('canvas', { 'aria-label': 'Vista previa del video', role: 'img' });
  const playIcon = h('span', null, icon('play', 22));
  const playBtn = h('button', { class: 'icon-btn', 'aria-label': 'Reproducir o pausar', onclick: () => player.toggle() }, playIcon);
  const timeLabel = h('span', { class: 'ed-time' });
  const tlCanvas = h('canvas', { 'aria-label': 'Línea de tiempo (arrastra para moverte)' });
  const tlWrap = h('div', { class: 'ed-timeline' }, tlCanvas);
  const tabsEl = h('div', { class: 'ed-tabs', role: 'tablist' });
  const panel = h('div', { class: 'ed-panel', role: 'tabpanel' });
  const titleInput = h('input', { class: 'ed-title', type: 'text', 'aria-label': 'Nombre del proyecto' });
  titleInput.value = project.title;
  titleInput.addEventListener('change', () => {
    project.title = titleInput.value.trim() || 'Sin título';
    changed();
  });
  const undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Deshacer', onclick: () => undo() }, icon('undo'));
  const redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Rehacer', onclick: () => redo() }, icon('redo'));
  const exportBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => doExport() }, icon('download', 16), 'Exportar');

  // Ajusta el lienzo al espacio disponible conservando su proporción.
  const fitStage = () => {
    const box = canvas.parentElement;
    const wrap = box?.parentElement;
    if (!wrap) return;
    const aw = Math.max(40, wrap.clientWidth - 16);
    const ah = Math.max(40, wrap.clientHeight - 16);
    const r = canvas.width / canvas.height;
    let w = aw;
    let hh = w / r;
    if (hh > ah) {
      hh = ah;
      w = hh * r;
    }
    box.style.width = `${Math.floor(w)}px`;
    box.style.height = `${Math.floor(hh)}px`;
  };
  const stageObserver = new ResizeObserver(() => fitStage());

  // Zonas seguras: muestra qué parte tapa la interfaz de cada red (solo en la vista previa).
  const safeOverlay = h('div', { class: 'safe-overlay hidden', 'aria-hidden': 'true' });
  let safeKey = null;
  const drawSafe = () => {
    const p = safeKey && PLATFORMS[safeKey];
    safeOverlay.classList.toggle('hidden', !p || p.aspect !== project.layout.aspect);
    if (!p) return;
    const s = p.safe;
    safeOverlay.replaceChildren(
      h('i', { style: { left: 0, right: 0, top: 0, height: `${s.top * 100}%` } }),
      h('i', { style: { left: 0, right: 0, bottom: 0, height: `${s.bottom * 100}%` } }),
      h('i', { style: { left: 0, top: `${s.top * 100}%`, bottom: `${s.bottom * 100}%`, width: `${s.left * 100}%` } }),
      h('i', { style: { right: 0, top: `${s.top * 100}%`, bottom: `${s.bottom * 100}%`, width: `${s.right * 100}%` } }),
      h('span', null, `Zona tapada por ${p.label}`)
    );
  };
  const safeBtn = h('button', {
    class: 'btn btn-sm btn-ghost', title: 'Mostrar las zonas que tapa la interfaz de cada red',
    onclick: () => {
      const opts = platformsForAspect(project.layout.aspect);
      const i = safeKey ? opts.indexOf(safeKey) : -1;
      safeKey = i + 1 < opts.length ? opts[i + 1] : null;
      safeBtn.textContent = safeKey ? `Zonas: ${PLATFORMS[safeKey].label}` : 'Zonas seguras';
      drawSafe();
    },
  }, 'Zonas seguras');

  root.append(
    h('div', { class: 'ed' },
      h('div', { class: 'ed-head' },
        h('button', { class: 'icon-btn', 'aria-label': 'Volver a proyectos', onclick: () => go('') }, icon('back')),
        titleInput, undoBtn, redoBtn, exportBtn
      ),
      h('div', { class: 'ed-main' },
        h('div', { class: 'ed-stage' },
          h('div', { class: 'ed-canvas-wrap', onclick: (e) => (e.target === canvas || e.target.closest?.('.safe-overlay')) && player.toggle() }, h('div', { class: 'ed-canvas-box' }, canvas, safeOverlay)),
          h('div', { class: 'ed-transport' },
            playBtn,
            timeLabel,
            h('span', { style: { flex: 1 } }),
            safeBtn,
            h('button', { class: 'icon-btn', 'aria-label': 'Retroceder 2 segundos', onclick: () => player.seek(player.t - 2) }, '−2s'),
            h('button', { class: 'icon-btn', 'aria-label': 'Avanzar 2 segundos', onclick: () => player.seek(player.t + 2) }, '+2s'),
            PRO ? h('button', { class: 'icon-btn', 'aria-label': 'Atajos del editor', title: 'Atajos (?)', onclick: () => showShortcuts() }, '⌨') : null,
            h('button', { class: 'icon-btn', 'aria-label': 'Alejar línea de tiempo', onclick: () => setZoom(tlZoom / 2) }, '−'),
            h('button', { class: 'icon-btn', 'aria-label': 'Acercar línea de tiempo', onclick: () => setZoom(tlZoom * 2) }, '+')
          ),
          tlWrap
        ),
        h('div', { class: 'ed-side' }, tabsEl, panel)
      )
    )
  );

  // ---------- Reproductor ----------
  const player = new Player({ project, brand, canvas, urlFor: mediaUrl, assets, analysis });
  stageObserver.observe(canvas.parentElement.parentElement);
  const resizeCanvas = () => {
    const [w, hh] = previewSize(project.layout.aspect);
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
    }
    fitStage();
    player.draw();
    drawSafe();
  };
  resizeCanvas();
  await player.load();
  await player.seek(0);

  const setPlayIcon = () => playIcon.replaceChildren(icon(player.playing ? 'pause' : 'play', 22));
  player.addEventListener('play', setPlayIcon);
  player.addEventListener('pause', setPlayIcon);
  player.addEventListener('ended', setPlayIcon);
  player.addEventListener('blocked', () => {
    setPlayIcon();
    toast('Toca «reproducir» de nuevo para oír el video.');
  });
  player.addEventListener('time', () => {
    updateTime();
    drawPlayhead();
    if (tab === 'captions') highlightCaption();
    if (PRO && tab === 'lib' && !player.playing && E.state.lib?.sub === 'trans') {
      const i = locate(player.tl, player.t).i;
      if (i !== libSeg) {
        libSeg = i;
        renderPanel();
      }
    }
  });

  function updateTime() {
    timeLabel.textContent = `${fmtTime(player.t, true)} / ${fmtTime(player.total, true)}`;
  }

  // ---------- Guardado e historial ----------
  const persist = debounce(() => saveProject(project).catch((e) => toast(`No se pudo guardar: ${e.message}`, 'error')), 500);
  const hist = { stack: [JSON.stringify(project)], index: 0 };
  const recordHistory = debounce(() => {
    const snap = JSON.stringify(project);
    if (snap === hist.stack[hist.index]) return;
    hist.stack.splice(hist.index + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 40) hist.stack.shift();
    hist.index = hist.stack.length - 1;
    updateUndo();
  }, 450);
  function updateUndo() {
    undoBtn.disabled = hist.index <= 0;
    redoBtn.disabled = hist.index >= hist.stack.length - 1;
  }
  function restore(snap) {
    const data = JSON.parse(snap);
    for (const k of Object.keys(project)) delete project[k];
    Object.assign(project, data);
    titleInput.value = project.title;
    player.rebuild();
    player.applyAudio();
    player.setMusic();
    resizeCanvas();
    player.seek(Math.min(player.t, player.total));
    drawTimelineStatic();
    renderPanel();
    persist();
    updateUndo();
  }
  function undo() {
    recordHistory.flush();
    if (hist.index <= 0) return;
    hist.index--;
    restore(hist.stack[hist.index]);
  }
  function redo() {
    recordHistory.flush();
    if (hist.index >= hist.stack.length - 1) return;
    hist.index++;
    restore(hist.stack[hist.index]);
  }
  updateUndo();

  /** Aplica un cambio del proyecto a la vista previa, lo guarda y lo registra para deshacer. */
  function changed({ structure = false, captions = false, audio = false, music = false, size = false, panelRefresh = false } = {}) {
    if (structure) {
      player.rebuild();
      player.seek(Math.min(player.t, player.total));
    } else if (captions) {
      player.refreshCaptions();
      player.draw();
    } else player.draw();
    if (audio) player.applyAudio();
    if (music) player.setMusic();
    if (size) resizeCanvas();
    if (structure || captions || PRO) drawTimelineStatic();
    updateTime();
    persist();
    recordHistory();
    if (panelRefresh) renderPanel();
  }

  // ---------- Línea de tiempo ----------
  const tlStatic = document.createElement('canvas');
  let TL_H = 62;
  function tlWidth() {
    return Math.max(tlWrap.clientWidth - 2, Math.round((tlWrap.clientWidth - 2) * tlZoom));
  }
  function capGroupsTl() {
    const out = [];
    const tl = player.tl;
    for (const seg of tl.segs) {
      if (seg.type !== 'video') continue;
      const entry = player.capIndex.get(seg.clip);
      if (!entry) continue;
      for (const g of entry.groups) {
        const a0 = Math.max(g.t0, seg.src0);
        const b0 = Math.min(g.t1, seg.src1);
        if (b0 <= a0) continue;
        out.push({ t0: seg.tlStart + (a0 - seg.src0) / tl.speed, t1: seg.tlStart + (b0 - seg.src0) / tl.speed });
      }
    }
    return out;
  }
  function drawTimelineStatic() {
    const W = tlWidth();
    const dpr = window.devicePixelRatio || 1;
    const info = PRO ? { project, tl: player.tl, total: player.tl.total || 1, analysis, capGroups: project.captions.enabled ? capGroupsTl() : [], sel: tlSel.cur, selSeg: tlSel.seg } : null;
    if (PRO) {
      TL_H = timelineHeight(info, W);
      tlWrap.style.height = `${Math.min(TL_H, 236) + 4}px`;
      tlWrap.style.overflowY = TL_H > 236 ? 'auto' : 'hidden';
      tlCanvas.style.height = `${TL_H}px`;
    }
    tlStatic.width = W * dpr;
    tlStatic.height = TL_H * dpr;
    tlCanvas.width = W * dpr;
    tlCanvas.height = TL_H * dpr;
    tlCanvas.style.width = `${W}px`;
    const c = tlStatic.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, TL_H);
    if (PRO) {
      tlRegions = drawLanes(c, W, info).regions;
      drawPlayhead();
      return;
    }
    const tl = player.tl;
    const total = tl.total || 1;
    const x = (t) => (t / total) * W;
    c.font = '600 10px -apple-system, Segoe UI, sans-serif';
    for (const seg of tl.segs) {
      const x0 = x(seg.tlStart);
      const x1 = x(seg.tlStart + seg.dur);
      if (seg.type === 'card') {
        c.fillStyle = 'rgba(124,92,255,0.45)';
        c.fillRect(x0, 4, x1 - x0, TL_H - 8);
        c.fillStyle = '#fff';
        c.fillText(seg.card === 'intro' ? 'Intro' : 'Cierre', x0 + 4, 16);
        continue;
      }
      c.fillStyle = seg.clip % 2 ? '#23324d' : '#2d2747';
      c.fillRect(x0, 4, x1 - x0, TL_H - 8);
      const a = analysis[project.clips[seg.clip]?.mediaId];
      if (a?.env?.length) {
        c.fillStyle = 'rgba(255,255,255,0.4)';
        for (let px = Math.floor(x0); px < x1; px += 2) {
          const t = (px / W) * total;
          const s = seg.src0 + (t - seg.tlStart) * tl.speed;
          const v = a.env[Math.floor(s / a.hop)] || 0;
          const hh = Math.max(1, v * (TL_H - 22));
          c.fillRect(px, TL_H / 2 - hh / 2, 1.3, hh);
        }
      }
      c.fillStyle = 'rgba(0,0,0,0.7)';
      c.fillRect(x0, 4, 1.5, TL_H - 8);
    }
    if (project.captions.enabled) {
      c.fillStyle = 'rgba(0,210,211,0.85)';
      for (const seg of tl.segs) {
        if (seg.type !== 'video') continue;
        const entry = player.capIndex.get(seg.clip);
        if (!entry) continue;
        for (const g of entry.groups) {
          const a0 = Math.max(g.t0, seg.src0);
          const b0 = Math.min(g.t1, seg.src1);
          if (b0 <= a0) continue;
          const t0 = seg.tlStart + (a0 - seg.src0) / tl.speed;
          const t1 = seg.tlStart + (b0 - seg.src0) / tl.speed;
          c.fillRect(x(t0) + 0.5, TL_H - 9, Math.max(1, x(t1) - x(t0) - 1), 4);
        }
      }
    }
    drawPlayhead();
  }
  function drawPlayhead() {
    const W = tlStatic.width / (window.devicePixelRatio || 1);
    const dpr = window.devicePixelRatio || 1;
    const c = tlCanvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, tlCanvas.width, tlCanvas.height);
    c.drawImage(tlStatic, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const total = player.total || 1;
    const x = (t) => (t / total) * W;
    if (markA != null || markB != null) {
      const a = markA ?? markB;
      const b = markB ?? markA;
      c.fillStyle = 'rgba(255,77,94,0.3)';
      c.fillRect(x(Math.min(a, b)), 0, Math.max(2, Math.abs(x(b) - x(a))), TL_H);
      c.fillStyle = '#ff4d5e';
      if (markA != null) c.fillRect(x(markA) - 1, 0, 2, TL_H);
      if (markB != null) c.fillRect(x(markB) - 1, 0, 2, TL_H);
    }
    const px = x(player.t);
    c.fillStyle = '#ffffff';
    c.fillRect(px - 1, 0, 2, TL_H);
    c.beginPath();
    c.moveTo(px - 6, 0);
    c.lineTo(px + 6, 0);
    c.lineTo(px, 7);
    c.fill();
    if (tlZoom > 1 && !scrubbing) {
      const view = tlWrap.clientWidth;
      if (px < tlWrap.scrollLeft + 20 || px > tlWrap.scrollLeft + view - 20) tlWrap.scrollLeft = px - view / 2;
    }
  }
  function setZoom(z) {
    tlZoom = clamp(z, 1, 32);
    drawTimelineStatic();
  }
  const scrubAt = (e) => {
    const r = tlCanvas.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 1) * player.total;
    if (player.playing) player.pause();
    player.t = t;
    player.scrub(t);
    updateTime();
    drawPlayhead();
  };
  // ---- Arrastre de elementos en las pistas (PC) ----
  let drag = null;
  const snapPoints = () => {
    const pts = [0, player.total, player.t];
    for (const sg of player.tl.segs) pts.push(sg.tlStart);
    for (const m of project.markers || []) pts.push(m.t);
    return pts;
  };
  const snapT = (t, r) => {
    if (!snapOn) return t;
    const th = (8 / r.width) * player.total;
    let best = t;
    let bd = th;
    for (const p of snapPoints()) if (Math.abs(p - t) < bd) { bd = Math.abs(p - t); best = p; }
    return best;
  };
  function proDown(e) {
    const r = tlCanvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const hit = [...tlRegions].reverse().find((z) => px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1 && z.kind !== 'seg');
    const segHit = tlRegions.find((z) => z.kind === 'seg' && px >= z.x0 && px <= z.x1 && py >= z.y0 && py <= z.y1);
    if (!hit) {
      const had = tlSel.cur || tlSel.seg != null;
      tlSel.cur = null;
      tlSel.seg = segHit ? segHit.index : null;
      if (segHit && e.altKey && project.transitions?.[segKey(segHit.item)]) {
        delete project.transitions[segKey(segHit.item)];
        changed();
        toast('Transición quitada');
        return false;
      }
      if (had || segHit) drawTimelineStatic();
      if (tab === 'lib' && (segHit || had)) renderPanel();
      return false;
    }
    tlSel.seg = null;
    const it = hit.item;
    tlSel.cur = { kind: hit.kind, id: hit.kind === 'sfx' ? it : it.id };
    if (hit.kind === 'ov') E.state.selOverlay = it.id;
    if (hit.kind === 'fx') E.state.selFx = it.id;
    if (hit.kind === 'aud') E.state.selAud = it.id;
    if (hit.kind === 'marker') {
      player.seek(it.t);
      drawTimelineStatic();
      return true;
    }
    const mode = hit.kind === 'sfx' ? 'move' : px - hit.x0 < 7 ? 'l' : hit.x1 - px < 7 ? 'r' : 'move';
    tlCanvas.setPointerCapture?.(e.pointerId);
    drag = { kind: hit.kind, it, mode, x: e.clientX, a: hit.kind === 'sfx' ? it.t : it.start, b: it.end, in0: it.in || 0, moved: false };
    drawTimelineStatic();
    if ((tab === 'layers' && hit.kind === 'ov') || tab === 'lib') renderPanel();
    return true;
  }
  function proMove(e) {
    if (!drag) return false;
    const r = tlCanvas.getBoundingClientRect();
    const total = player.total;
    const dt = ((e.clientX - drag.x) / r.width) * total;
    if (Math.abs(e.clientX - drag.x) > 2) drag.moved = true;
    const it = drag.it;
    if (drag.kind === 'sfx') it.t = clamp(snapT(drag.a + dt, r), 0, Math.max(0, total - 0.1));
    else if (drag.mode === 'move') {
      const len = drag.b - drag.a;
      let na = clamp(drag.a + dt, 0, Math.max(0, total - len));
      const s1 = snapT(na, r);
      const s2 = snapT(na + len, r) - len;
      na = Math.abs(s1 - na) <= Math.abs(s2 - na) ? s1 : s2;
      na = clamp(na, 0, Math.max(0, total - len));
      it.start = na;
      it.end = na + len;
    } else if (drag.mode === 'l') {
      it.start = clamp(snapT(drag.a + dt, r), 0, drag.b - 0.1);
      if (drag.kind === 'aud') it.in = Math.max(0, drag.in0 + (it.start - drag.a)); // recortar el inicio del audio
    }
    else it.end = clamp(snapT(drag.b + dt, r), drag.a + 0.1, total);
    drawTimelineStatic();
    player.draw();
    return true;
  }
  function proUp() {
    if (!drag) return false;
    const d = drag;
    drag = null;
    if (d.moved) changed({ panelRefresh: tab === 'layers' || tab === 'lib' });
    return true;
  }

  tlCanvas.addEventListener('pointerdown', (e) => {
    if (PRO && proDown(e)) return;
    scrubbing = true;
    tlCanvas.setPointerCapture?.(e.pointerId);
    scrubAt(e);
  });
  tlCanvas.addEventListener('pointermove', (e) => {
    if (PRO && proMove(e)) return;
    if (scrubbing) scrubAt(e);
  });
  const endScrub = () => {
    if (PRO && proUp()) return;
    scrubbing = false;
  };
  tlCanvas.addEventListener('pointerup', endScrub);
  tlCanvas.addEventListener('pointercancel', endScrub);
  tlCanvas.style.touchAction = 'none';
  if (PRO) {
    tlWrap.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(e.deltaY < 0 ? tlZoom * 1.5 : tlZoom / 1.5);
    }, { passive: false });
    // Soltar imágenes, videos o audios del Explorador directamente sobre la línea de tiempo.
    tlWrap.addEventListener('dragover', (e) => e.dataTransfer?.types?.includes('Files') && e.preventDefault());
    tlWrap.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const r = tlCanvas.getBoundingClientRect();
      importAndPlace(E, [...e.dataTransfer.files], clamp((e.clientX - r.left) / r.width, 0, 1) * player.total);
    });
  }

  // ---------- Análisis de audio ----------
  async function ensureAnalysis() {
    const missing = project.clips.filter((c) => !analysis[c.mediaId]);
    if (!missing.length) return;
    const t = toastLoading('Analizando audio…');
    try {
      for (const c of missing) analysis[c.mediaId] = await analyzeMedia(c.mediaId);
    } finally {
      t();
    }
    if (!destroyed) drawTimelineStatic();
  }
  function toastLoading(text) {
    const el = h('div', { class: 'toast show' }, text);
    document.getElementById('toasts').append(el);
    return () => el.remove();
  }

  // ---------- Subtítulos ----------
  async function captionsFromText(text, source = 'text') {
    const words = splitWords(String(text).replace(/[[\]]/g, ''));
    if (!words.length) return toast('No hay texto para los subtítulos.');
    await ensureAnalysis();
    const perClip = project.clips.map((c) => keptSpeech(c, analysis[c.mediaId]));
    const parts = distributeWords(words, perClip.map(speechSeconds));
    project.captions.words = parts.flatMap((ws, ci) =>
      alignWords(ws, perClip[ci], project.clips[ci].duration).map((w) => ({ ...w, clip: ci }))
    );
    project.captions.source = source;
    project.captions.enabled = true;
    changed({ captions: true, panelRefresh: true });
    toast(`Subtítulos creados: ${project.captions.words.length} palabras`, 'ok');
  }

  async function captionsFromHints() {
    await ensureAnalysis();
    const words = [];
    for (let ci = 0; ci < project.clips.length; ci++) {
      const c = project.clips[ci];
      const m = await db.get('media', c.mediaId);
      if (!m?.hints?.length) continue;
      words.push(...wordsFromHints(m.hints, analysis[c.mediaId]?.regions, c.duration).map((w) => ({ ...w, clip: ci })));
    }
    if (!words.length) return toast('No hay transcripción guardada en estas tomas.');
    project.captions.words = words;
    project.captions.source = 'voz';
    project.captions.enabled = true;
    changed({ captions: true, panelRefresh: true });
    toast('Subtítulos creados desde tu voz. Revisa el texto.', 'ok');
  }

  async function captionsFromAI() {
    const { transcribeProject, transcriptionSupport } = await import('../core/transcribe.js');
    const support = transcriptionSupport();
    if (!support.ok) return toast(support.reason, 'error', 6000);
    const ok = await confirmDialog(
      'La primera vez se descarga un modelo de reconocimiento de voz (entre 40 y 150 MB, mejor con Wi-Fi) y después funciona sin conexión. La transcripción se hace en este dispositivo: tu video no sale de él. En el iPhone puede tardar varios minutos.',
      { title: 'Transcripción con IA (Whisper)', ok: 'Transcribir' }
    );
    if (!ok) return;
    const prog = progressModal('Transcribiendo…');
    try {
      const words = await transcribeProject(project, {
        lang: settings.lang,
        onProgress: (p, text) => prog.set(p, text),
        isCancelled: () => prog.cancelled,
      });
      prog.close();
      if (!words) return;
      if (!words.length) return toast('No se detectó voz.', 'error');
      project.captions.words = words;
      project.captions.source = 'ia';
      project.captions.enabled = true;
      changed({ captions: true, panelRefresh: true });
      toast(`Transcripción lista: ${words.length} palabras`, 'ok');
    } catch (e) {
      prog.close();
      console.error(e);
      toast(`Error al transcribir: ${e.message}`, 'error', 7000);
    }
  }

  function visibleGroups() {
    const out = [];
    const tl = player.tl;
    const seen = new Set();
    for (const seg of tl.segs) {
      if (seg.type !== 'video') continue;
      const entry = player.capIndex.get(seg.clip);
      if (!entry) continue;
      entry.groups.forEach((g, gi) => {
        const key = `${seg.clip}:${gi}`;
        if (seen.has(key)) return;
        const mid = Math.max(g.t0, seg.src0);
        if (mid > seg.src1 || g.t1 < seg.src0) return;
        seen.add(key);
        out.push({ clip: seg.clip, g, words: g.idx.map((i) => entry.words[i]), tl: seg.tlStart + (mid - seg.src0) / tl.speed });
      });
    }
    return out.sort((a, b) => a.tl - b.tl);
  }

  function replaceGroupWords(item, newWords) {
    const set = new Set(item.words);
    project.captions.words = project.captions.words.filter((w) => !set.has(w)).concat(newWords.map((w) => ({ ...w, clip: item.clip })));
  }

  function highlightCaption() {
    const cur = player.currentSource();
    capItems.forEach(({ el, item }) => {
      const on = !!cur && cur.clip === item.clip && cur.src >= item.g.t0 && cur.src < item.g.end;
      el.classList.toggle('active', on);
    });
  }

  // ---------- Paneles ----------
  function renderTabs() {
    tabsEl.replaceChildren(
      ...TABS.filter(([k]) => !(IS_MOBILE && (k === 'bg' || k === 'lib' || k === 'claude' || k === 'music' || k === 'voice'))).map(([k, ic, label]) =>
        h('button', {
          class: `ed-tab${tab === k ? ' active' : ''}`, role: 'tab', 'aria-selected': String(tab === k),
          onclick: () => {
            tab = k;
            renderTabs();
            renderPanel();
          },
        }, icon(ic, 20), label)
      )
    );
  }

  function renderPanel() {
    const builders = {
      captions: panelCaptions, cut: panelCut, format: panelFormat, text: panelText, brand: panelBrand, audio: panelAudio, cover: panelCover,
      bg: () => panelBackground(E), light: () => panelLight(E), ai: () => panelAI(E), layers: () => panelLayers(E), lib: () => panelLibrary(E), claude: () => panelAssistant(E), music: () => panelMusician(E), voice: () => panelVoice(E),
    };
    capItems = [];
    panel.replaceChildren(...[builders[tab]()].flat(Infinity).filter(Boolean));
    panel.scrollTop = 0;
  }

  function panelCaptions() {
    const cap = project.captions;
    const st = cap.style;
    const upd = (patch, opts = { captions: true }) => {
      Object.assign(st, patch);
      changed(opts);
    };
    const hasScript = !!(project.scriptText || '').trim();
    const nodes = [
      toggle({ label: 'Mostrar subtítulos', checked: cap.enabled, onChange: (v) => { cap.enabled = v; changed({ captions: true }); } }),
      h('h3', null, 'Crear subtítulos'),
      h('div', { class: 'row' },
        hasScript ? h('button', { class: 'btn btn-sm', onclick: () => captionsFromText(project.scriptText, 'guion') }, icon('script', 16), 'Desde el guion') : null,
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const t = await promptDialog('Pega o escribe lo que dices en el video', cap.words.map((w) => w.text).join(' ') || project.scriptText, { multiline: true });
            if (t != null) captionsFromText(t, 'texto');
          },
        }, icon('text', 16), 'Escribir / pegar texto'),
        h('button', { class: 'btn btn-sm', onclick: () => captionsFromAI() }, icon('magic', 16), 'Transcribir con IA'),
        h('button', { class: 'btn btn-sm', onclick: () => captionsFromHints() }, icon('mic', 16), 'Desde mi voz grabada')
      ),
      h('p', { class: 'muted small' }, cap.words.length
        ? `${cap.words.length} palabras (origen: ${cap.source || 'manual'}). Toca una frase para ir a ese momento y edita el texto si hace falta.`
        : 'Aún no hay subtítulos. «Desde el guion» sincroniza tu texto con la voz; «Transcribir con IA» reconoce lo que dices.'),
      h('h3', null, 'Estilo'),
      h('div', { class: 'preset-grid' },
        Object.entries(CAPTION_PRESETS).map(([k, p]) => {
          const s = presetStyle(k);
          const f = FONTS[s.font];
          return h('button', {
            class: `preset${st.preset === k ? ' active' : ''}`,
            style: {
              fontFamily: f.family, fontWeight: f.weight, color: s.hlMode === 'color' ? s.hlColor : s.color,
              textTransform: s.upper ? 'uppercase' : 'none',
              background: s.box ? s.boxColor : '#1e1e2a',
              textShadow: s.strokeW > 0 ? `0 0 3px ${s.strokeColor}, 0 0 3px ${s.strokeColor}` : '0 2px 4px rgba(0,0,0,.6)',
            },
            onclick: () => {
              cap.style = presetStyle(k, { posY: project.layout.mode === 'titled' ? s.posY : st.posY });
              changed({ captions: true, panelRefresh: true });
            },
          }, p.label);
        })
      ),
      segmented({ label: 'Modo', value: st.mode, options: [['group', 'Frases'], ['word', 'Palabra a palabra']], onChange: (v) => upd({ mode: v }) }),
      slider({ label: 'Palabras por frase', value: st.maxWords, min: 1, max: 8, step: 1, onInput: (v) => upd({ maxWords: v }) }),
      select({ label: 'Fuente', value: st.font, options: Object.entries(FONTS).map(([k, f]) => [k, f.label]), onChange: (v) => upd({ font: v }) }),
      slider({ label: 'Tamaño', value: st.sizePct, min: 3, max: 14, step: 0.2, format: (v) => v.toFixed(1), onInput: (v) => upd({ sizePct: v }) }),
      project.layout.mode === 'titled'
        ? h('p', { class: 'hint' }, 'En el diseño «Con título» los subtítulos van en la franja inferior.')
        : slider({ label: 'Posición vertical', value: st.posY, min: 0.08, max: 0.95, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ posY: v }) }),
      segmented({ label: 'Resaltar palabra actual', value: st.hlMode, options: [['none', 'No'], ['color', 'Color'], ['box', 'Caja'], ['underline', 'Subrayado']], onChange: (v) => upd({ hlMode: v }) }),
      h('div', { class: 'two' },
        colorPick({ label: 'Texto', value: st.color, onChange: (v) => upd({ color: v }) }),
        colorPick({ label: 'Resaltado', value: st.hlColor, onChange: (v) => upd({ hlColor: v }) })
      ),
      slider({ label: 'Contorno', value: st.strokeW, min: 0, max: 0.3, step: 0.01, format: (v) => (v ? v.toFixed(2) : 'No'), onInput: (v) => upd({ strokeW: v }) }),
      colorPick({ label: 'Color del contorno', value: st.strokeColor, onChange: (v) => upd({ strokeColor: v }) }),
      toggle({ label: 'Sombra', checked: st.shadow, onChange: (v) => upd({ shadow: v }) }),
      toggle({ label: 'Caja de fondo', checked: st.box, onChange: (v) => upd({ box: v }) }),
      h('div', { class: 'two' },
        colorPick({ label: 'Color de la caja', value: st.boxColor, onChange: (v) => upd({ boxColor: v }) }),
        slider({ label: 'Opacidad', value: st.boxOpacity, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ boxOpacity: v }) })
      ),
      toggle({ label: 'MAYÚSCULAS', checked: st.upper, onChange: (v) => upd({ upper: v }) }),
      segmented({ label: 'Animación', value: st.anim, options: [['none', 'Ninguna'], ['pop', 'Pop'], ['fade', 'Fundido']], onChange: (v) => upd({ anim: v }) }),
    ];
    if (cap.words.length) {
      const nudge = (d) => {
        for (const w of cap.words) {
          const dur = project.clips[w.clip]?.duration ?? Infinity;
          w.t0 = clamp(w.t0 + d, 0, dur);
          w.t1 = clamp(w.t1 + d, 0, dur);
        }
        changed({ captions: true });
        toast(`Subtítulos ${d > 0 ? 'retrasados' : 'adelantados'} ${Math.abs(d).toFixed(1)} s`, 'info', 1200);
      };
      const list = h('div', { class: 'cap-list' });
      for (const item of visibleGroups()) {
        const ta = h('textarea', { rows: 1, 'aria-label': 'Texto de la frase' });
        ta.value = item.words.map((w) => w.text).join(' ');
        ta.addEventListener('change', () => {
          const text = ta.value.trim();
          replaceGroupWords(item, text ? retimeText(text, item.g.t0, item.g.t1) : []);
          changed({ captions: true, panelRefresh: !text });
        });
        const el = h('div', { class: 'cap-item' },
          h('button', { class: 't', onclick: () => player.seek(item.tl + 0.01), 'aria-label': 'Ir a esta frase' }, fmtTime(item.tl, true)),
          ta,
          h('div', { class: 'acts' },
            h('button', {
              class: 'icon-btn', title: 'Cortar esta frase del video', 'aria-label': 'Cortar esta frase del video',
              onclick: () => {
                cutSource(project, item.clip, Math.max(0, item.g.t0 - 0.04), item.g.t1 + 0.04);
                replaceGroupWords(item, []);
                changed({ structure: true, panelRefresh: true });
                toast('Frase cortada del video');
              },
            }, icon('cut', 18)),
            h('button', {
              class: 'icon-btn', title: 'Borrar subtítulo', 'aria-label': 'Borrar subtítulo',
              onclick: () => {
                replaceGroupWords(item, []);
                changed({ captions: true, panelRefresh: true });
              },
            }, icon('trash', 18))
          )
        );
        capItems.push({ el, item });
        list.append(el);
      }
      nodes.push(
        h('h3', null, 'Texto y sincronía'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', onclick: () => nudge(-0.1) }, '« Adelantar 0,1 s'),
          h('button', { class: 'btn btn-sm', onclick: () => nudge(0.1) }, 'Retrasar 0,1 s »')
        ),
        list,
        h('h3', null, 'Archivos de subtítulos'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', onclick: () => downloadCaptions('srt') }, icon('download', 16), '.SRT'),
          h('button', { class: 'btn btn-sm', onclick: () => downloadCaptions('vtt') }, icon('download', 16), '.VTT'),
          h('button', {
            class: 'btn btn-sm btn-danger',
            onclick: async () => {
              if (!(await confirmDialog('¿Borrar todos los subtítulos?', { ok: 'Borrar', danger: true }))) return;
              cap.words = [];
              changed({ captions: true, panelRefresh: true });
            },
          }, icon('trash', 16), 'Borrar todos')
        )
      );
      requestAnimationFrame(highlightCaption);
    }
    return nodes;
  }

  function downloadCaptions(kind) {
    const cues = captionCues(player.tl, player.capIndex, project.captions.style.upper);
    const text = kind === 'srt' ? toSRT(cues) : toVTT(cues);
    downloadBlob(new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }), `${sanitizeFilename(project.title)}.${kind}`);
  }

  function panelCut() {
    const silence = { min: 0.7, keep: 0.15 };
    const nodes = [
      h('h3', null, 'Recorte rápido'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => { if (trimBefore(project, player.t)) { changed({ structure: true }); player.seek(0); toast('Inicio recortado'); } } }, icon('cut', 16), 'Quitar todo lo anterior'),
        h('button', { class: 'btn btn-sm', onclick: () => { if (trimAfter(project, player.t)) { changed({ structure: true }); toast('Final recortado'); } } }, icon('cut', 16), 'Quitar todo lo posterior')
      ),
      h('p', { class: 'hint' }, 'Coloca el cursor (línea blanca) en la línea de tiempo y pulsa.'),
      h('h3', null, 'Eliminar un fragmento'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => { markA = player.t; drawPlayhead(); renderPanel(); } }, `Inicio (A)${markA != null ? `: ${fmtTime(markA, true)}` : ''}`),
        h('button', { class: 'btn btn-sm', onclick: () => { markB = player.t; drawPlayhead(); renderPanel(); } }, `Fin (B)${markB != null ? `: ${fmtTime(markB, true)}` : ''}`),
        h('button', {
          class: 'btn btn-sm btn-primary',
          disabled: markA == null || markB == null,
          onclick: () => {
            if (cutRange(project, markA, markB)) {
              const t = Math.min(markA, markB);
              markA = markB = null;
              changed({ structure: true, panelRefresh: true });
              player.seek(t);
              toast('Fragmento eliminado');
            }
          },
        }, icon('cut', 16), 'Eliminar A–B'),
        markA != null || markB != null ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { markA = markB = null; drawPlayhead(); renderPanel(); } }, 'Quitar marcas') : null
      ),
      h('h3', null, 'Quitar silencios automáticamente'),
      h('p', { class: 'hint' }, 'Crea cortes rápidos (jump cuts) donde no hablas. Muy útil para Reels y TikTok.'),
      slider({ label: 'Silencio mínimo a quitar', value: silence.min, min: 0.3, max: 2, step: 0.1, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => (silence.min = v) }),
      slider({ label: 'Margen alrededor de la voz', value: silence.keep, min: 0.05, max: 0.4, step: 0.05, format: (v) => `${v.toFixed(2)} s`, onInput: (v) => (silence.keep = v) }),
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          await ensureAnalysis();
          let n = 0;
          let secs = 0;
          project.clips.forEach((c) => {
            const a = analysis[c.mediaId];
            if (!a?.regions) return;
            const cuts = silenceCuts(findSilences(a.regions, c.duration, silence.min), c.duration, silence.keep);
            const before = keptRanges(c).reduce((s, [x, y]) => s + y - x, 0);
            c.cuts = mergeCuts([...(c.cuts || []), ...cuts]);
            secs += before - keptRanges(c).reduce((s, [x, y]) => s + y - x, 0);
            n += cuts.length;
          });
          if (!n) return toast('No se encontraron silencios con esa duración.');
          changed({ structure: true, panelRefresh: true });
          toast(`Silencios quitados: ${n} (${secs.toFixed(1)} s menos)`, 'ok');
        },
      }, icon('magic', 18), 'Quitar silencios'),
      h('h3', null, 'Transición entre cortes'),
      segmented({ value: project.layout.transition || 'none', options: [['none', 'Corte seco'], ['zoom', 'Zoom'], ['fade', 'Fundido'], ['flash', 'Destello']], onChange: (v) => { project.layout.transition = v; changed(); } }),
      h('h3', null, 'Velocidad'),
      segmented({ value: project.speed, options: [[0.75, '0,75×'], [1, '1×'], [1.1, '1,1×'], [1.25, '1,25×'], [1.5, '1,5×']], onChange: (v) => { project.speed = v; changed({ structure: true }); } }),
      h('h3', null, 'Tomas'),
    ];
    const clipList = h('div', { class: 'list' });
    project.clips.forEach((c, i) => {
      const kept = keptRanges(c).reduce((s, [x, y]) => s + y - x, 0);
      clipList.append(
        h('div', { class: 'list-item' },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name || `Toma ${i + 1}`), h('div', { class: 'sub' }, `${fmtTime(kept, true)} de ${fmtTime(c.duration, true)}${c.width ? ` · ${c.width}×${c.height}` : ''}`)),
          h('button', { class: 'icon-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => moveClip(i, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Bajar', disabled: i === project.clips.length - 1, onclick: () => moveClip(i, 1) }, '↓'),
          h('button', { class: 'icon-btn', 'aria-label': 'Quitar toma', disabled: project.clips.length === 1, onclick: () => removeClip(i) }, icon('trash', 18))
        )
      );
    });
    nodes.push(
      clipList,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn btn-sm', onclick: () => go(`record?project=${project.id}`) }, icon('record', 16), 'Grabar otra toma'),
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const files = await pickFile('video/*', true);
            if (!files.length) return;
            toast('Importando…');
            try {
              persist.cancel();
              await saveProject(project);
              await importVideos(files, { projectId: project.id });
              location.reload();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, icon('upload', 16), 'Añadir video')
      )
    );
    const cuts = listCuts(project);
    if (cuts.length) {
      nodes.push(
        h('h3', null, `Cortes (${cuts.length})`),
        h('div', { class: 'list' },
          cuts.map((c) =>
            h('div', { class: 'cut-item' },
              h('span', null, `Toma ${c.clip + 1}: ${fmtTime(c.start, true)} – ${fmtTime(c.end, true)}`),
              h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { removeCut(project, c.clip, c.index); changed({ structure: true, panelRefresh: true }); } }, 'Restaurar')
            )
          )
        ),
        h('button', { class: 'btn btn-sm btn-danger', style: { marginTop: '8px' }, onclick: () => { clearCuts(project); changed({ structure: true, panelRefresh: true }); } }, 'Restaurar todo')
      );
    }
    return nodes;
  }

  function moveClip(i, d) {
    const j = i + d;
    const clips = project.clips;
    [clips[i], clips[j]] = [clips[j], clips[i]];
    for (const w of project.captions.words) {
      if (w.clip === i) w.clip = j;
      else if (w.clip === j) w.clip = i;
    }
    changed({ structure: true, panelRefresh: true });
  }

  async function removeClip(i) {
    if (!(await confirmDialog('¿Quitar esta toma del proyecto?', { ok: 'Quitar', danger: true }))) return;
    const [clip] = project.clips.splice(i, 1);
    project.captions.words = project.captions.words.filter((w) => w.clip !== i).map((w) => (w.clip > i ? { ...w, clip: w.clip - 1 } : w));
    await player.load();
    changed({ structure: true, panelRefresh: true });
    const others = (await db.all('projects')).some((p) => p.id !== project.id && p.clips.some((c) => c.mediaId === clip.mediaId));
    if (!others) await deleteMedia(clip.mediaId);
  }

  function panelFormat() {
    const L = project.layout;
    const upd = (patch, opts = {}) => {
      Object.assign(L, patch);
      changed(opts);
    };
    return [
      h('h3', null, 'Formato de salida'),
      segmented({ value: L.aspect, options: Object.keys(ASPECTS).map((k) => [k, k]), onChange: (v) => { upd({ aspect: v }, { size: true }); renderPanel(); } }),
      h('p', { class: 'hint' }, `${ASPECTS[L.aspect].label} — ${ASPECTS[L.aspect].hint}. Al exportar puedes sacar varios formatos a la vez.`),
      h('h3', null, 'Diseño'),
      segmented({
        value: L.mode,
        options: [['full', 'Pantalla completa'], ['titled', 'Con título'], ['blur', 'Fondo desenfocado'], ['frame', 'Marco']],
        onChange: (v) => upd({ mode: v }, { panelRefresh: true }),
      }),
      h('p', { class: 'hint' }, {
        full: 'El video ocupa todo el cuadro (se recorta lo que sobra).',
        titled: 'Título arriba, video en el centro y subtítulos abajo, sobre tu color de fondo.',
        blur: 'Muestra el video completo, con un fondo desenfocado del propio video (ideal para pasar un video horizontal a vertical).',
        frame: 'Video con bordes redondeados sobre tu color de fondo.',
      }[L.mode]),
      segmented({ label: 'Plano (qué tan cerca se ve la cámara)', value: [1, 0.85, 0.72].find((z) => Math.abs(z - L.zoom) < 0.01) ?? 'x', options: [[1, 'Cerrado'], [0.85, 'Medio'], [0.72, 'Abierto']], onChange: (v) => upd({ zoom: v }, { panelRefresh: true }) }),
      slider({ label: 'Zoom', value: L.zoom, min: 0.6, max: 2.5, step: 0.01, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => upd({ zoom: v }) }),
      slider({ label: 'Encuadre horizontal', value: L.offsetX, min: -1, max: 1, step: 0.01, format: (v) => v.toFixed(2), onInput: (v) => upd({ offsetX: v }) }),
      slider({ label: 'Encuadre vertical', value: L.offsetY, min: -1, max: 1, step: 0.01, format: (v) => v.toFixed(2), onInput: (v) => upd({ offsetY: v }) }),
      h('button', { class: 'btn btn-sm', onclick: () => upd({ zoom: 1, offsetX: 0, offsetY: 0 }, { panelRefresh: true }) }, 'Centrar'),
      toggle({ label: 'Espejo (voltear horizontal)', checked: L.mirror, onChange: (v) => upd({ mirror: v }) }),
      toggle({ label: 'Zoom dinámico en los cortes', hint: 'Alterna un acercamiento en cada corte para dar ritmo.', checked: L.dynamicZoom, onChange: (v) => upd({ dynamicZoom: v }) }),
      colorPick({ label: 'Color de fondo', value: L.bg, onChange: (v) => upd({ bg: v }) }),
    ];
  }

  function panelText() {
    const Hd = project.headline;
    const upd = (patch) => {
      Object.assign(Hd, patch);
      changed();
    };
    const titled = project.layout.mode === 'titled';
    return [
      textInput({ label: 'Título / gancho en pantalla', value: Hd.text, multiline: true, rows: 2, placeholder: 'p. ej. 3 errores que te hacen perder clientes', onInput: (v) => upd({ text: v }) }),
      titled
        ? h('p', { class: 'hint' }, 'Con el diseño «Con título» se muestra siempre en la franja superior.')
        : segmented({ label: 'Mostrar', value: Hd.overlay, options: [['none', 'No'], ['start', 'Primeros 3 s'], ['always', 'Siempre']], onChange: (v) => upd({ overlay: v }) }),
      !titled
        ? h('button', { class: 'btn btn-sm', onclick: () => { project.layout.mode = 'titled'; changed({ panelRefresh: true }); } }, icon('layout', 16), 'Usar diseño con título')
        : null,
      select({ label: 'Fuente', value: Hd.font, options: Object.entries(FONTS).map(([k, f]) => [k, f.label]), onChange: (v) => upd({ font: v }) }),
      slider({ label: 'Tamaño', value: Hd.sizePct, min: 4, max: 13, step: 0.1, format: (v) => v.toFixed(1), onInput: (v) => upd({ sizePct: v }) }),
      h('div', { class: 'two' },
        colorPick({ label: 'Color del texto', value: Hd.color, onChange: (v) => upd({ color: v }) }),
        colorPick({ label: 'Color de la caja', value: Hd.boxColor, onChange: (v) => upd({ boxColor: v }) })
      ),
      slider({ label: 'Opacidad de la caja', value: Hd.boxOpacity, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ boxOpacity: v }) }),
      toggle({ label: 'MAYÚSCULAS', checked: Hd.upper, onChange: (v) => upd({ upper: v }) }),
    ];
  }

  function panelBrand() {
    const B = project.brand;
    const upd = (fn, opts = {}) => {
      fn();
      changed(opts);
    };
    const configured = brand.name || brand.handle || brand.logoMediaId;
    return [
      !configured ? h('p', { class: 'hint' }, 'Configura tu logo, colores y nombre en ', h('a', { href: '#/brand' }, 'Mi marca'), ' para usarlos en todos tus videos.') : null,
      h('button', { class: 'btn btn-sm', onclick: () => { applyBrandDefaults(project, brand); changed({ structure: true, captions: true, panelRefresh: true }); toast('Estilo de marca aplicado', 'ok'); } }, icon('brand', 16), 'Aplicar mi marca'),
      h('h3', null, 'Logo'),
      brand.logoMediaId
        ? [
            toggle({ label: 'Mostrar logo', checked: B.logo, onChange: (v) => upd(() => (B.logo = v)) }),
            segmented({ label: 'Posición', value: B.logoPos, options: [['tl', '↖ Arriba izq.'], ['tr', '↗ Arriba der.'], ['bl', '↙ Abajo izq.'], ['br', '↘ Abajo der.']], onChange: (v) => upd(() => (B.logoPos = v)) }),
            slider({ label: 'Tamaño', value: B.logoSize, min: 0.06, max: 0.4, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd(() => (B.logoSize = v)) }),
            slider({ label: 'Opacidad', value: B.logoOpacity, min: 0.2, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd(() => (B.logoOpacity = v)) }),
          ]
        : h('p', { class: 'hint' }, 'Sin logo. Súbelo en Mi marca.'),
      brand.handle ? toggle({ label: `Mostrar @${brand.handle.replace(/^@/, '')}`, checked: B.handle, onChange: (v) => upd(() => (B.handle = v)) }) : null,
      h('h3', null, 'Rótulo con tu nombre'),
      toggle({ label: 'Mostrar rótulo', checked: B.lowerThird.enabled, onChange: (v) => upd(() => (B.lowerThird.enabled = v)) }),
      textInput({ label: 'Nombre', value: B.lowerThird.name, placeholder: brand.name || 'Tu nombre', onInput: (v) => upd(() => (B.lowerThird.name = v)) }),
      textInput({ label: 'Cargo o descripción', value: B.lowerThird.role, placeholder: brand.role || 'p. ej. Coach de ventas', onInput: (v) => upd(() => (B.lowerThird.role = v)) }),
      slider({ label: 'Aparece en el segundo', value: B.lowerThird.start, min: 0, max: 30, step: 0.5, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => upd(() => (B.lowerThird.start = v)) }),
      slider({ label: 'Duración', value: B.lowerThird.dur, min: 2, max: 12, step: 0.5, format: (v) => `${v.toFixed(1)} s`, onInput: (v) => upd(() => (B.lowerThird.dur = v)) }),
      segmented({ label: 'Posición', value: B.lowerThird.pos, options: [['bottom', 'Abajo'], ['top', 'Arriba']], onChange: (v) => upd(() => (B.lowerThird.pos = v)) }),
      h('h3', null, 'Intro'),
      toggle({ label: 'Tarjeta de entrada', checked: project.intro.enabled, onChange: (v) => upd(() => (project.intro.enabled = v), { structure: true }) }),
      textInput({ label: 'Texto de la intro', value: project.intro.text, placeholder: 'Por defecto: el título', onInput: (v) => upd(() => (project.intro.text = v)) }),
      slider({ label: 'Duración', value: project.intro.duration, min: 1, max: 5, step: 0.5, format: (v) => `${v.toFixed(1)} s`, onChange: (v) => upd(() => (project.intro.duration = v), { structure: true }) }),
      h('h3', null, 'Cierre'),
      toggle({ label: 'Tarjeta de cierre', checked: project.outro.enabled, onChange: (v) => upd(() => (project.outro.enabled = v), { structure: true }) }),
      textInput({ label: 'Texto del cierre', value: project.outro.text, onInput: (v) => upd(() => (project.outro.text = v)) }),
      slider({ label: 'Duración', value: project.outro.duration, min: 1, max: 6, step: 0.5, format: (v) => `${v.toFixed(1)} s`, onChange: (v) => upd(() => (project.outro.duration = v), { structure: true }) }),
      h('h3', null, 'Barra de progreso'),
      toggle({ label: 'Mostrar barra de progreso', checked: B.progress.enabled, onChange: (v) => upd(() => (B.progress.enabled = v)) }),
      segmented({ label: 'Posición', value: B.progress.pos, options: [['bottom', 'Abajo'], ['top', 'Arriba']], onChange: (v) => upd(() => (B.progress.pos = v)) }),
    ];
  }

  function panelAudio() {
    const A = project.audio;
    const upd = (patch, opts = {}) => {
      Object.assign(A, patch);
      changed(opts);
    };
    const nodes = [
      slider({ label: 'Volumen de la voz', value: A.voiceVol, min: 0, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ voiceVol: v }, { audio: true }) }),
      toggle({ label: 'Mejorar voz', hint: 'Quita graves molestos, da presencia y nivela el volumen.', checked: A.enhance, onChange: (v) => upd({ enhance: v }, { audio: true }) }),
      h('h3', null, 'Música de fondo'),
      musicLibrary(E),
    ];
    if (A.musicId) {
      nodes.push(
        h('div', { class: 'list-item' }, icon('music'), h('div', { class: 'grow' }, h('div', { class: 'title' }, A.musicName || 'Música')),
          h('button', { class: 'btn btn-sm btn-danger', onclick: () => upd({ musicId: null, musicName: '' }, { music: true, panelRefresh: true }) }, 'Quitar')),
        slider({ label: 'Volumen de la música', value: A.musicVol, min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ musicVol: v }) }),
        toggle({ label: 'Bajar la música cuando hablas', checked: A.duck, onChange: (v) => upd({ duck: v }) }),
        toggle({ label: 'Fundido de entrada y salida', checked: A.fade, onChange: (v) => upd({ fade: v }) }),
        slider({ label: 'Empezar la canción en', value: A.musicOffset, min: 0, max: 180, step: 1, format: (v) => fmtTime(v), onChange: (v) => upd({ musicOffset: v }) })
      );
    }
    nodes.push(
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const [file] = await pickFile('audio/*,.mp3,.m4a,.wav,.aac');
          if (!file) return;
          const rec = await addMedia({ blob: file, name: file.name, kind: 'audio' });
          upd({ musicId: rec.id, musicName: file.name.replace(/\.[^.]+$/, '') }, { music: true, panelRefresh: true });
          toast('Música añadida', 'ok');
        },
      }, icon('upload', 16), A.musicId ? 'Cambiar música' : 'Añadir música del dispositivo'),
      h('p', { class: 'hint' }, 'Usa música libre de derechos o con licencia para evitar bloqueos en redes.')
    );
    return nodes;
  }

  function panelColor() {
    const C = project.color;
    const upd = (patch) => {
      Object.assign(C, patch);
      changed();
    };
    return [
      h('div', { class: 'chips' },
        Object.entries(COLOR_PRESETS).map(([k, p]) => h('button', { class: `chip${C.preset === k ? ' active' : ''}`, onclick: () => { upd({ preset: k }); renderPanel(); } }, p.label))
      ),
      slider({ label: 'Brillo', value: C.brightness, min: 0.5, max: 1.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ brightness: v }) }),
      slider({ label: 'Contraste', value: C.contrast, min: 0.5, max: 1.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ contrast: v }) }),
      slider({ label: 'Saturación', value: C.saturation, min: 0, max: 2, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => upd({ saturation: v }) }),
      h('button', { class: 'btn btn-sm', onclick: () => { Object.assign(C, { preset: 'none', brightness: 1, contrast: 1, saturation: 1 }); changed({ panelRefresh: true }); } }, 'Restablecer'),
      supportsCanvasFilter() ? null : h('p', { class: 'hint' }, 'En este navegador los filtros de color son aproximados (el contraste no se aplica).'),
    ];
  }

  function panelCover() {
    const Cv = project.cover;
    const size = exportSize(project.layout.aspect, '1080');
    const still = (coverText, w, hh, type) =>
      renderStill({ project, brand, assets, urlFor: mediaUrl, time: Cv.time, width: w, height: hh, coverText, type });
    return [
      h('p', { class: 'muted small' }, 'Crea la miniatura para YouTube, Reels o TikTok: elige un fotograma y un texto llamativo.'),
      h('button', { class: 'btn btn-sm', onclick: () => { Cv.time = player.t; changed({ panelRefresh: true }); } }, icon('image', 16), `Usar fotograma actual (${fmtTime(player.t, true)})`),
      h('p', { class: 'hint' }, `Fotograma elegido: ${fmtTime(Cv.time, true)}`),
      textInput({ label: 'Texto de la portada', value: Cv.text, placeholder: project.headline.text || 'Texto grande y corto', onInput: (v) => { Cv.text = v; persist(); recordHistory(); } }),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const [w, hh] = previewSize(project.layout.aspect);
            const blob = await still(Cv.text || project.headline.text, w, hh, 'image/jpeg');
            const url = URL.createObjectURL(blob);
            await modal({ title: 'Vista previa de la portada', body: h('img', { src: url, alt: 'Portada', style: { width: '100%', borderRadius: '12px' } }), actions: [{ label: 'Cerrar', value: null }] });
            URL.revokeObjectURL(url);
          },
        }, 'Vista previa'),
        h('button', {
          class: 'btn btn-sm btn-primary',
          onclick: async () => {
            const blob = await still(Cv.text || project.headline.text, size[0], size[1], 'image/png');
            const small = await still(Cv.text || project.headline.text, 360, Math.round((360 * size[1]) / size[0]), 'image/jpeg');
            project.thumb = await blobToDataURL(small);
            persist();
            await shareFile(blob, `${sanitizeFilename(project.title)}-portada.png`, project.title);
          },
        }, icon('download', 16), 'Guardar portada PNG')
      ),
    ];
  }

  // ---------- Exportar ----------
  function doExport() {
    player.pause();
    persist.flush();
    openExport({ project, brand, assets, analysis, settings, onSaved: () => persist() });
  }

  // ---------- Atajos y ciclo de vida ----------
  // ---- Edición tipo CapCut / Premiere (PC) ----
  const FRAME = 1 / 30;
  const editPoints = () => {
    const pts = [0, player.total];
    for (const sg of player.tl.segs) pts.push(sg.tlStart);
    for (const m of project.markers || []) pts.push(m.t);
    return [...new Set(pts.map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
  };
  const curSel = () => {
    const c = tlSel.cur;
    if (!c) return null;
    if (c.kind === 'ov') return { list: 'overlays', it: (project.overlays || []).find((o) => o.id === c.id) };
    if (c.kind === 'fx') return { list: 'effects', it: (project.effects || []).find((o) => o.id === c.id) };
    if (c.kind === 'aud') return { list: 'audioClips', it: (project.audioClips || []).find((o) => o.id === c.id) };
    if (c.kind === 'sfx') return { list: 'sfx', it: c.id };
    if (c.kind === 'marker') return { list: 'markers', it: (project.markers || []).find((o) => o.id === c.id) };
    return null;
  };
  async function deleteSelection() {
    const c = curSel();
    if (c?.it) {
      if (c.list === 'sfx') project.audio.sfx = project.audio.sfx.filter((x) => x !== c.it);
      else project[c.list] = project[c.list].filter((x) => x !== c.it);
      tlSel.cur = null;
      if (c.list === 'overlays') await player.loadOverlays();
      changed({ panelRefresh: true });
      return;
    }
    const { seg } = locate(player.tl, player.t);
    if (!seg || seg.type !== 'video') return;
    const t0 = seg.tlStart;
    const t1 = seg.tlStart + seg.dur;
    if (!cutRange(project, t0 + 0.001, t1 - 0.001)) return;
    rippleShift(project, t0, t1);
    tlSel.seg = null;
    changed({ structure: true, panelRefresh: true });
    player.seek(Math.min(t0, player.total));
    toast('Tramo borrado (ripple). Ctrl+Z lo recupera.');
  }
  function duplicateSelection() {
    const c = curSel();
    if (!c?.it) return;
    if (c.list === 'sfx') {
      const n = { ...c.it, t: Math.min(player.total, c.it.t + 0.6) };
      project.audio.sfx.push(n);
      tlSel.cur = { kind: 'sfx', id: n };
    } else if (c.list === 'overlays' || c.list === 'effects' || c.list === 'audioClips') {
      const d = c.it.end - c.it.start;
      const st = Math.min(Math.max(0, player.total - d), c.it.end);
      const n = { ...c.it, id: uid(c.list === 'overlays' ? 'o_' : c.list === 'audioClips' ? 'a_' : 'f_'), start: st, end: st + d };
      project[c.list].push(n);
      tlSel.cur = { kind: c.list === 'overlays' ? 'ov' : c.list === 'audioClips' ? 'aud' : 'fx', id: n.id };
      if (c.list === 'overlays') E.state.selOverlay = n.id;
      else if (c.list === 'audioClips') E.state.selAud = n.id;
      else E.state.selFx = n.id;
      if (c.list === 'overlays') player.loadOverlays();
    } else return;
    changed({ panelRefresh: true });
  }
  function jumpEdit(dir) {
    const pts = editPoints();
    const t = player.t;
    const to = dir < 0 ? [...pts].reverse().find((v) => v < t - 0.02) : pts.find((v) => v > t + 0.02);
    if (to != null) player.seek(to);
    return true;
  }
  let clipboard = null;
  function copySelection(cut) {
    const c = curSel();
    if (!c?.it || c.list === 'markers') return false;
    clipboard = { list: c.list, data: JSON.parse(JSON.stringify(c.it)) };
    if (cut) deleteSelection();
    else toast('Copiado');
    return true;
  }
  function pasteSelection() {
    if (!clipboard) return false;
    const { list, data } = clipboard;
    const n = JSON.parse(JSON.stringify(data));
    if (list === 'sfx') {
      n.t = player.t;
      project.audio.sfx.push(n);
      tlSel.cur = { kind: 'sfx', id: n };
    } else {
      const d = n.end - n.start;
      n.id = uid(list === 'overlays' ? 'o_' : list === 'audioClips' ? 'a_' : 'f_');
      n.start = Math.min(player.t, Math.max(0, player.total - 0.3));
      n.end = n.start + d;
      (project[list] ||= []).push(n);
      tlSel.cur = { kind: list === 'overlays' ? 'ov' : list === 'audioClips' ? 'aud' : 'fx', id: n.id };
      if (list === 'overlays') player.loadOverlays();
    }
    changed({ panelRefresh: true });
    return true;
  }
  function showShortcuts() {
    modal({
      title: 'Atajos del editor',
      body: h('div', { class: 'shortcuts' }, SHORTCUTS.map(([k, d]) => h('div', { class: 'sc-row' }, h('kbd', null, k), h('span', null, d)))),
      actions: [{ label: 'Listo', value: null, primary: true }],
    });
  }
  function doSplit() {
    if (!splitAt(project, player.t)) {
      toast('Ahí no se puede dividir (muy cerca de un borde).');
      return true;
    }
    changed({ structure: true });
    return true;
  }
  function proKey(e) {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'b' || k === 'k')) return doSplit();
    if (ctrl && k === 'd') {
      duplicateSelection();
      return true;
    }
    if (ctrl && k === 'c') return copySelection(false);
    if (ctrl && k === 'x') return copySelection(true);
    if (ctrl && k === 'v') return pasteSelection();
    if (ctrl && k === 's') {
      persist.flush();
      toast('Proyecto guardado', 'ok');
      return true;
    }
    if (ctrl && (k === 'e' || k === 'm')) {
      doExport();
      return true;
    }
    if (ctrl && (k === '=' || k === '+')) {
      setZoom(tlZoom * 2);
      return true;
    }
    if (ctrl && k === '-') {
      setZoom(tlZoom / 2);
      return true;
    }
    if (ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return jumpEdit(e.key === 'ArrowLeft' ? -1 : 1);
    if (ctrl || e.altKey) return false;
    if (e.key === 'Escape') {
      tlSel.cur = null;
      tlSel.seg = null;
      drawTimelineStatic();
      return true;
    }
    if (e.key === ',' || e.key === '.') {
      player.seek(player.t + (e.key === ',' ? -FRAME : FRAME));
      return true;
    }
    if (e.key === 'Enter') {
      player.toggle();
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      player.seek(player.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : FRAME));
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return jumpEdit(e.key === 'ArrowUp' ? -1 : 1);
    switch (k) {
      case 'k':
        player.pause();
        return true;
      case 'l':
        if (!player.playing) player.toggle();
        return true;
      case 'j':
        player.seek(player.t - 1);
        return true;
      case 's':
      case 'c':
        return doSplit();
      case 'd':
        tlSel.cur = null;
        tlSel.seg = null;
        drawTimelineStatic();
        return true;
      case 'delete':
      case 'backspace':
        deleteSelection();
        return true;
      case 'home':
        player.seek(0);
        return true;
      case 'end':
        player.seek(player.total);
        return true;
      case 'q': {
        const vs = buildSegments(project).videoStart;
        const t = player.t;
        if (trimBefore(project, t)) {
          rippleShift(project, vs, t);
          changed({ structure: true });
          player.seek(vs);
        }
        return true;
      }
      case 'w':
        if (trimAfter(project, player.t)) changed({ structure: true });
        return true;
      case 'i':
        markA = player.t;
        drawTimelineStatic();
        return true;
      case 'o':
        markB = player.t;
        drawTimelineStatic();
        return true;
      case 'x':
        if (markA != null && markB != null) {
          const a = Math.min(markA, markB);
          const b = Math.max(markA, markB);
          if (cutRange(project, a, b)) {
            rippleShift(project, a, b);
            markA = markB = null;
            changed({ structure: true, panelRefresh: true });
            player.seek(a);
          }
        }
        return true;
      case 'm': {
        project.markers ||= [];
        if (e.shiftKey) {
          const near = [...project.markers].sort((x, y) => Math.abs(x.t - player.t) - Math.abs(y.t - player.t))[0];
          if (near) project.markers = project.markers.filter((x) => x !== near);
        } else project.markers.push({ id: uid('m_'), t: +player.t.toFixed(2) });
        changed();
        return true;
      }
      case '+':
      case '=':
        setZoom(tlZoom * 2);
        return true;
      case '-':
      case '_':
        setZoom(tlZoom / 2);
        return true;
      case '\\':
        setZoom(1);
        return true;
      case 'n':
        snapOn = !snapOn;
        toast(snapOn ? 'Imán activado' : 'Imán desactivado');
        return true;
      case '?':
      case '/':
        showShortcuts();
        return true;
      default:
        return false;
    }
  }

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select, .overlay')) return;
    if (PRO && e.code !== 'Space' && proKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      player.toggle();
    } else if (e.key === 'ArrowLeft') player.seek(player.t - (e.shiftKey ? 5 : 1));
    else if (e.key === 'ArrowRight') player.seek(player.t + (e.shiftKey ? 5 : 1));
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  };
  document.addEventListener('keydown', onKey);
  const onHide = () => document.visibilityState === 'hidden' && player.pause();
  document.addEventListener('visibilitychange', onHide);
  const onResize = debounce(() => drawTimelineStatic(), 150);
  window.addEventListener('resize', onResize);

  // Contexto para los paneles profesionales (editor-pro.js).
  const E = {
    project, player, brand, settings, analysis, changed, renderPanel, ensureAnalysis, captionsFromAI, captionsFromText, go, undo, redo, doExport,
    state: { selOverlay: null, selFx: null, selAud: null },
    setTab: (k) => { tab = k; renderTabs(); renderPanel(); },
    tlSel, redrawTimeline: () => drawTimelineStatic(), showShortcuts,
  };
  player.addEventListener('fxerror', () => toast('La IA de imagen no está disponible en este navegador.', 'error'));

  renderTabs();
  renderPanel();
  updateTime();
  loadProjectFonts(project).then(() => player.draw());
  requestAnimationFrame(drawTimelineStatic);

  // Tareas pendientes al abrir: subtítulos automáticos y análisis para la forma de onda.
  (async () => {
    const pending = project.captions.pending;
    if (pending) {
      project.captions.pending = null;
      if (pending === 'script' && project.scriptText.trim()) await captionsFromText(project.scriptText, 'guion');
      else if (pending === 'hints') await captionsFromHints();
      persist();
    } else {
      await ensureAnalysis();
    }
    if (!project.thumb && project.clips[0]) {
      project.thumb = await captureThumb(await mediaUrl(project.clips[0].mediaId));
      persist();
    }
  })().catch((e) => console.warn(e));

  // Acceso para pruebas automatizadas.
  window.__editor = { project, player, changed, captionsFromText, renderPanel, E, setTab: (k) => { tab = k; renderTabs(); renderPanel(); } };

  return async () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('resize', onResize);
    stageObserver.disconnect();
    recordHistory.cancel();
    persist.flush();
    player.destroy();
    delete window.__editor;
  };
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}
