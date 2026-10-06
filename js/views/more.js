// Menú «Más» (móvil).
import { h, icon } from '../lib/dom.js';
import { hasScreenCapture } from '../core/media.js';

export default async function render(root, { go }) {
  const items = [
    ['ideas', 'calendar', 'Ideas y calendario', 'Planifica y programa tus publicaciones'],
    ['luz', 'bulb', 'Iluminación recomendada', 'Cómo ponerte la luz para verte profesional'],
    ['brand', 'brand', 'Mi marca', 'Logo, colores, nombre y estilo'],
    hasScreenCapture() ? ['screen', 'screen', 'Grabar pantalla', 'Tutoriales con tu cámara'] : null,
    ['scripts', 'script', 'Guiones', 'Plantillas, ganchos y generador'],
    ['settings', 'settings', 'Ajustes', 'Idioma, calidad, copia de seguridad e instalación'],
  ].filter(Boolean);
  root.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Más')),
    h('div', { class: 'list' },
      items.map(([route, ic, title, sub]) =>
        h('button', { class: 'list-item', onclick: () => go(route) }, icon(ic), h('div', { class: 'grow' }, h('div', { class: 'title' }, title), h('div', { class: 'sub' }, sub)))
      )
    )
  );
}
