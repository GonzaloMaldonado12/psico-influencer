// Línea de tiempo multipista (solo PC): regla con marcadores, video con forma de onda, subtítulos, capas, efectos y sonidos.
// Dibuja sobre un canvas 2D y devuelve las zonas clicables para arrastrar/recortar elementos.
import { SFX_KINDS, sfxLabel } from './sfx.js';
import { TRANSITIONS, SHAPES } from './fx-lib.js';
import { segKey } from './render.js';

export const LANE_COLORS = {
  text: '#8b6cff',
  sticker: '#ffca3a',
  broll: '#4aa3ff',
  shape: '#2ec4a6',
  fx: '#ff8a3d',
  sfx: '#ff5d8f',
  aud: '#9bd83a',
};

const ROW = 15;
const GAP = 3;

/** Reparte elementos con rango [start,end] en filas sin solaparse. */
export function packRows(items, getRange) {
  const rows = [];
  const placed = [...items].sort((a, b) => getRange(a)[0] - getRange(b)[0]).map((it) => {
    const [a, b] = getRange(it);
    let r = rows.findIndex((end) => end <= a + 1e-6);
    if (r < 0) r = rows.length;
    rows[r] = b;
    return { it, row: r };
  });
  return { placed, rows: Math.max(1, rows.length) };
}

function rulerStep(total, W) {
  const pxPerSec = W / Math.max(0.1, total);
  for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pxPerSec >= 56) return s;
  return 600;
}

const mmss = (t, step) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${String(Math.floor(s)).padStart(2, '0')}` : step < 1 ? `${s.toFixed(1)}s` : `${Math.floor(s)}s`;
};

function plan(o, W) {
  const { project } = o;
  const ovs = packRows(project.overlays || [], (v) => [v.start, v.end]);
  const fxs = packRows(project.effects || [], (v) => [v.start, v.end]);
  const auds = packRows(project.audioClips || [], (v) => [v.start, v.end]);
  const capsOn = !!project.captions?.enabled;
  const lanes = [
    { id: 'ruler', h: 18 },
    { id: 'video', h: 46 },
    capsOn && { id: 'caps', h: 8 },
    { id: 'ov', h: ovs.rows * ROW + GAP, rows: ovs },
    { id: 'fx', h: fxs.rows * ROW + GAP, rows: fxs },
    { id: 'aud', h: auds.rows * ROW + GAP, rows: auds },
    { id: 'sfx', h: ROW + GAP },
  ].filter(Boolean);
  let y = 0;
  for (const l of lanes) {
    l.y = y;
    y += l.h + 2;
  }
  return { lanes, height: y };
}

export function timelineHeight(o, W) {
  return plan(o, W).height;
}

/**
 * o = { project, tl, total, analysis, capGroups: [{t0,t1}], sel: {kind,id}|null, selSeg: índice|null }
 * Devuelve { height, regions }.
 */
export function drawLanes(c, W, o) {
  const { project, tl, total, analysis } = o;
  const { lanes, height } = plan(o, W);
  const regions = [];
  const x = (t) => (t / Math.max(0.001, total)) * W;
  const L = Object.fromEntries(lanes.map((l) => [l.id, l]));
  c.font = '600 10px -apple-system, Segoe UI, sans-serif';
  c.textBaseline = 'middle';

  // fondos de pista
  for (const l of lanes) {
    c.fillStyle = l.id === 'ruler' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.025)';
    c.fillRect(0, l.y, W, l.h);
  }

  // regla
  {
    const l = L.ruler;
    const step = rulerStep(total, W);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.lineWidth = 1;
    for (let t = 0; t <= total + 1e-6; t += step) {
      const px = Math.round(x(t)) + 0.5;
      c.beginPath();
      c.moveTo(px, l.y + l.h - 6);
      c.lineTo(px, l.y + l.h);
      c.stroke();
      c.fillText(mmss(t, step), px + 3, l.y + 8);
    }
    for (const m of project.markers || []) {
      const px = x(m.t);
      const selm = o.sel?.kind === 'marker' && o.sel.id === m.id;
      c.fillStyle = selm ? '#fff' : '#ffb703';
      c.beginPath();
      c.moveTo(px - 5, l.y + 3);
      c.lineTo(px + 5, l.y + 3);
      c.lineTo(px + 5, l.y + 11);
      c.lineTo(px, l.y + 16);
      c.lineTo(px - 5, l.y + 11);
      c.closePath();
      c.fill();
      regions.push({ kind: 'marker', item: m, x0: px - 6, x1: px + 6, y0: l.y, y1: l.y + l.h });
    }
  }

  // video
  {
    const l = L.video;
    tl.segs.forEach((seg, i) => {
      const x0 = x(seg.tlStart);
      const x1 = x(seg.tlStart + seg.dur);
      if (seg.type === 'card') {
        c.fillStyle = 'rgba(124,92,255,0.5)';
        c.fillRect(x0, l.y + 2, x1 - x0, l.h - 4);
        c.fillStyle = '#fff';
        c.fillText(seg.card === 'intro' ? 'Intro' : 'Cierre', x0 + 4, l.y + 12);
        return;
      }
      c.fillStyle = seg.clip % 2 ? '#23324d' : '#2d2747';
      c.fillRect(x0, l.y + 2, x1 - x0, l.h - 4);
      const a = analysis?.[project.clips[seg.clip]?.mediaId];
      if (a?.env?.length) {
        c.fillStyle = 'rgba(255,255,255,0.4)';
        for (let px = Math.floor(x0); px < x1; px += 2) {
          const t = (px / W) * total;
          const s = seg.src0 + (t - seg.tlStart) * tl.speed;
          const v = a.env[Math.floor(s / a.hop)] || 0;
          const hh = Math.max(1, v * (l.h - 14));
          c.fillRect(px, l.y + l.h / 2 - hh / 2, 1.3, hh);
        }
      }
      if (seg.cont) {
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.setLineDash([2, 2]);
        c.beginPath();
        c.moveTo(Math.round(x0) + 0.5, l.y + 2);
        c.lineTo(Math.round(x0) + 0.5, l.y + l.h - 2);
        c.stroke();
        c.setLineDash([]);
      } else {
        c.fillStyle = 'rgba(0,0,0,0.75)';
        c.fillRect(x0, l.y + 2, 1.5, l.h - 4);
      }
      const tr = project.transitions?.[segKey(seg)];
      if (tr && tr.kind !== 'none') {
        c.fillStyle = '#ffb703';
        c.beginPath();
        c.moveTo(x0, l.y + 6);
        c.lineTo(x0 + 7, l.y + 13);
        c.lineTo(x0, l.y + 20);
        c.lineTo(x0 - 7, l.y + 13);
        c.closePath();
        c.fill();
        if (x1 - x0 > 60) {
          c.fillStyle = 'rgba(255,255,255,0.85)';
          c.fillText(TRANSITIONS[tr.kind]?.label || tr.kind, x0 + 10, l.y + 13);
        }
      }
      if (o.selSeg === i) {
        c.strokeStyle = '#00d2d3';
        c.lineWidth = 2;
        c.strokeRect(x0 + 1, l.y + 3, x1 - x0 - 2, l.h - 6);
        c.lineWidth = 1;
      }
      regions.push({ kind: 'seg', item: seg, index: i, x0, x1, y0: l.y, y1: l.y + l.h });
    });
  }

  // subtítulos
  if (L.caps) {
    c.fillStyle = 'rgba(0,210,211,0.85)';
    for (const g of o.capGroups || []) c.fillRect(x(g.t0) + 0.5, L.caps.y + 2, Math.max(1, x(g.t1) - x(g.t0) - 1), 4);
  }

  const bar = (kind, item, lane, row, t0, t1, color, label) => {
    const x0 = x(t0);
    const w = Math.max(6, x(t1) - x0);
    const y0 = lane.y + GAP / 2 + row * ROW;
    const isSel = o.sel?.kind === kind && o.sel.id === item.id;
    c.fillStyle = color;
    c.globalAlpha = isSel ? 1 : 0.78;
    c.beginPath();
    c.roundRect(x0, y0, w, ROW - 2, 4);
    c.fill();
    c.globalAlpha = 1;
    if (isSel) {
      c.strokeStyle = '#fff';
      c.lineWidth = 1.5;
      c.stroke();
      c.lineWidth = 1;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillRect(x0 + 1, y0 + 2, 2.5, ROW - 6);
      c.fillRect(x0 + w - 3.5, y0 + 2, 2.5, ROW - 6);
    }
    if (w > 30 && label) {
      c.save();
      c.beginPath();
      c.rect(x0 + 4, y0, w - 8, ROW);
      c.clip();
      c.fillStyle = '#0b0b12';
      c.fillText(label, x0 + 5, y0 + ROW / 2 - 0.5);
      c.restore();
    }
    regions.push({ kind, item, x0, x1: x0 + w, y0, y1: y0 + ROW - 2 });
  };

  // capas
  for (const { it, row } of L.ov.rows.placed) {
    const label = it.kind === 'broll' ? it.name || 'B-roll' : it.kind === 'shape' ? SHAPES[it.shape] || 'Forma' : it.kind === 'sticker' ? it.emoji : it.text;
    bar('ov', it, L.ov, row, it.start, it.end, LANE_COLORS[it.kind] || '#888', label);
  }
  // efectos
  for (const { it, row } of L.fx.rows.placed) bar('fx', it, L.fx, row, it.start, it.end, LANE_COLORS.fx, it.kind);
  // audios importados
  for (const { it, row } of L.aud.rows.placed) bar('aud', it, L.aud, row, it.start, it.end, LANE_COLORS.aud, `♪ ${it.name || 'Audio'}`);
  // sonidos
  for (const s of project.audio?.sfx || []) {
    const d = SFX_KINDS[s.kind]?.dur || 0.4;
    const x0 = x(s.t);
    const w = Math.max(8, x(s.t + Math.min(d, 1.5)) - x0);
    const y0 = L.sfx.y + GAP / 2;
    const isSel = o.sel?.kind === 'sfx' && o.sel.id === s;
    c.fillStyle = LANE_COLORS.sfx;
    c.globalAlpha = isSel ? 1 : 0.78;
    c.beginPath();
    c.roundRect(x0, y0, w, ROW - 2, 4);
    c.fill();
    c.globalAlpha = 1;
    if (isSel) {
      c.strokeStyle = '#fff';
      c.stroke();
    }
    if (w > 34) {
      c.fillStyle = '#0b0b12';
      c.fillText(sfxLabel(s.kind), x0 + 4, y0 + ROW / 2 - 0.5);
    }
    regions.push({ kind: 'sfx', item: s, x0, x1: x0 + w, y0, y1: y0 + ROW - 2 });
  }

  // etiquetas de pistas vacías
  c.fillStyle = 'rgba(255,255,255,0.22)';
  if (!(project.overlays || []).length) c.fillText('Capas: textos, formas, B-roll', 6, L.ov.y + L.ov.h / 2);
  if (!(project.effects || []).length) c.fillText('Efectos: Biblioteca › Efectos', 6, L.fx.y + L.fx.h / 2);
  if (!(project.audioClips || []).length) c.fillText('Audios: Biblioteca › Mis medios (o suelta un archivo aquí)', 6, L.aud.y + L.aud.h / 2);
  if (!(project.audio?.sfx || []).length) c.fillText('Sonidos: Biblioteca › Sonidos', 6, L.sfx.y + L.sfx.h / 2);

  return { height, regions, lanes: L };
}

/** Atajos mostrados en la ayuda del editor (PC). */
export const SHORTCUTS = [
  ['Espacio / K', 'Reproducir o pausar'],
  ['L', 'Reproducir'],
  ['J', 'Retroceder 1 s'],
  ['← →  ·  , .', 'Un fotograma atrás / adelante (Mayús: 1 s)'],
  ['↑ ↓  ·  Ctrl+← →', 'Ir al corte o marcador anterior / siguiente'],
  ['Enter', 'Reproducir o pausar'],
  ['Alt+← / Alt+→', 'Pantalla anterior / siguiente de la app'],
  ['Inicio / Fin', 'Ir al principio o al final'],
  ['S  ·  C  ·  Ctrl+K  ·  Ctrl+B', 'Dividir el tramo en el cursor (cuchilla)'],
  ['Supr / Retroceso', 'Borrar el elemento elegido; si no hay, el tramo bajo el cursor (con ripple)'],
  ['Q  ·  W', 'Recortar todo lo anterior / posterior al cursor (ripple)'],
  ['I  ·  O', 'Marcar entrada / salida; X borra lo marcado'],
  ['M', 'Poner un marcador (Mayús+M: borrar el más cercano)'],
  ['Ctrl+D', 'Duplicar la capa, efecto, audio o sonido elegido'],
  ['Ctrl+C · Ctrl+X · Ctrl+V', 'Copiar, cortar y pegar en el cursor'],
  ['Esc  ·  D', 'Quitar la selección'],
  ['Ctrl+S', 'Guardar'],
  ['Ctrl+E  ·  Ctrl+M', 'Exportar'],
  ['Ctrl+Z / Ctrl+Mayús+Z', 'Deshacer / rehacer'],
  ['+  ·  −  ·  Ctrl+rueda  ·  \\', 'Acercar / alejar / ajustar la línea de tiempo'],
  ['N', 'Imán (alinea al cursor, cortes y marcadores)'],
  ['Clic y arrastre', 'Mover un elemento; sus bordes lo recortan'],
  ['Alt + clic en tramo', 'Quitar la transición de ese corte'],
  ['?', 'Mostrar esta ayuda'],
];
