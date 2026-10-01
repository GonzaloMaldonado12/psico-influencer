// Guía de iluminación recomendada, con diagramas simples vistos desde arriba.
import { h, icon } from '../lib/dom.js';
import { LIGHTING_GUIDE } from '../core/lighting.js';

const DIAGRAMS = [
  // [luces: x,y,label], ventana?
  { window: true, lights: [] },
  { ring: true, lights: [] },
  { lights: [[70, 110, 'Principal'], [230, 110, 'Relleno']] },
  { lights: [[70, 110, 'Principal'], [230, 110, 'Relleno'], [210, 40, 'Contraluz'], [60, 30, 'Fondo']] },
  null,
];

function diagram(d) {
  if (!d) return null;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 300 200');
  svg.setAttribute('class', 'light-diagram');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Esquema visto desde arriba');
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    svg.appendChild(el);
    return el;
  };
  add('rect', { x: 0, y: 0, width: 300, height: 200, rx: 14, fill: 'rgba(255,255,255,0.03)' });
  if (d.window) {
    add('rect', { x: 110, y: 176, width: 80, height: 10, rx: 3, fill: '#7fd3ff' });
    add('text', { x: 150, y: 170, 'text-anchor': 'middle', fill: '#7fd3ff', 'font-size': 12 }, 'Ventana');
    add('path', { d: 'M150 160 L150 105', stroke: '#7fd3ff', 'stroke-width': 2, 'stroke-dasharray': '4 4' });
  }
  add('circle', { cx: 150, cy: 70, r: 18, fill: '#b8a9e3' });
  add('text', { x: 150, y: 44, 'text-anchor': 'middle', fill: '#e5e5ee', 'font-size': 12 }, 'Tú');
  add('rect', { x: 138, y: 130, width: 24, height: 16, rx: 3, fill: '#e5e5ee' });
  add('text', { x: 150, y: 164, 'text-anchor': 'middle', fill: '#a0a0b4', 'font-size': 11 }, d.window ? '' : 'Cámara');
  if (d.ring) {
    add('circle', { cx: 150, cy: 138, r: 22, fill: 'none', stroke: '#ffd60a', 'stroke-width': 5 });
    add('text', { x: 180, y: 128, fill: '#ffd60a', 'font-size': 11 }, 'Aro de luz con el');
    add('text', { x: 180, y: 142, fill: '#ffd60a', 'font-size': 11 }, 'celular al centro');
  }
  for (const [x, y, label] of d.lights) {
    add('circle', { cx: x, cy: y, r: 11, fill: '#ffd60a' });
    add('path', { d: `M${x} ${y} L${150 + (x - 150) * 0.35} ${70 + (y - 70) * 0.35}`, stroke: '#ffd60a', 'stroke-width': 2, 'stroke-dasharray': '4 4' });
    add('text', { x, y: y + 26, 'text-anchor': 'middle', fill: '#ffd60a', 'font-size': 11 }, label);
  }
  return svg;
}

export default async function render(root, { go }) {
  root.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Iluminación recomendada'), h('p', { class: 'muted small' }, 'Con buena luz tu video se ve profesional aunque grabes con el celular.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: () => go('record') }, icon('record', 18), 'Probar mi luz ahora'))
    ),
    h('p', { class: 'hint' }, 'En la grabadora toca «💡 Luz» para ver tu nota de iluminación en vivo con consejos. En el editor, «Luz y color › Analizar y mejorar la luz» corrige automáticamente lo grabado.'),
    ...LIGHTING_GUIDE.map((g, i) =>
      h('div', { class: 'card light-card' },
        h('div', { class: 'card-title' }, h('h2', null, g.title), h('span', { class: 'badge badge-accent' }, g.level)),
        diagram(DIAGRAMS[i]),
        h('ol', { class: 'install-steps' }, g.steps.map((s) => h('li', null, s)))
      )
    )
  );
}
