// Arranque, navegación y enrutado por hash.
// Celular: estudio de grabación (Grabar, Guiones, Tomas, Ajustes). PC: la app completa de edición.
import { h, icon, toast } from './lib/dom.js';
import { MOBILE_APP, APP_VERSION } from './lib/util.js';

const ROUTES = {
  '': () => import('./views/projects.js'),
  scripts: () => import('./views/scripts.js'),
  script: () => import('./views/script-editor.js'),
  record: () => import('./views/recorder.js'),
  takes: () => import('./views/takes.js'),
  editor: () => import('./views/editor.js'),
  brand: () => import('./views/brand.js'),
  ideas: () => import('./views/ideas.js'),
  screen: () => import('./views/screen.js'),
  settings: () => import('./views/settings.js'),
  more: () => import('./views/more.js'),
  ia: () => import('./views/ai-studio.js'),
  luz: () => import('./views/lighting.js'),
};

const IMMERSIVE = new Set(['record', 'editor', 'screen-rec']);
// En el celular solo existen las pantallas para grabar; la edición se hace en el PC.
const MOBILE_ROUTES = new Set(['record', 'scripts', 'script', 'takes', 'settings', 'luz']);

const NAV = [
  { route: '', label: 'Proyectos', icon: 'home' },
  { route: 'scripts', label: 'Guiones', icon: 'script' },
  { route: 'record', label: 'Grabar', icon: 'record', rec: true },
  { route: 'ia', label: 'Estudio IA', icon: 'magic' },
  { route: 'ideas', label: 'Ideas', icon: 'bulb', desktop: true },
  { route: 'luz', label: 'Iluminación', icon: 'bulb', desktop: true },
  { route: 'brand', label: 'Marca', icon: 'brand', desktop: true },
  { route: 'screen', label: 'Pantalla', icon: 'screen', desktop: true },
  { action: 'phone', label: 'Conectar celular', icon: 'phone', desktop: true },
  { route: 'settings', label: 'Ajustes', icon: 'settings', desktop: true },
  { route: 'more', label: 'Más', icon: 'more', mobile: true },
];

const NAV_MOBILE = [
  { route: 'scripts', label: 'Guiones', icon: 'script' },
  { route: 'record', label: 'Grabar', icon: 'record', rec: true },
  { route: 'takes', label: 'Tomas', icon: 'photos' },
  { route: 'settings', label: 'Ajustes', icon: 'settings' },
];

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { route: parts[0] || '', id: parts[1] ? decodeURIComponent(parts[1]) : null, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function go(path) {
  location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

const openPhone = () => import('./views/iphone.js').then((m) => m.showPhoneConnect());

function renderNav(active) {
  const nav = document.getElementById('nav');
  if (MOBILE_APP) {
    nav.replaceChildren(
      ...NAV_MOBILE.map((item) =>
        h('a', { href: `#/${item.route}`, class: `nav-item${item.rec ? ' nav-rec' : ''}${active === item.route ? ' active' : ''}`, 'aria-current': active === item.route ? 'page' : null },
          item.rec ? h('span', { class: 'nav-rec-dot' }, icon('record', 22)) : icon(item.icon, 22),
          h('span', null, item.label)
        )
      )
    );
    return;
  }
  nav.replaceChildren(
    h('div', { class: 'nav-brand' }, h('span', { class: 'logo-mark' }, icon('film', 18)), 'Psico Influencer'),
    h('div', { class: 'nav-history' },
      h('button', { class: 'icon-btn', 'aria-label': 'Atrás', title: 'Atrás (Alt+←)', onclick: () => history.back() }, '←'),
      h('button', { class: 'icon-btn', 'aria-label': 'Adelante', title: 'Adelante (Alt+→)', onclick: () => history.forward() }, '→')
    ),
    ...NAV.map((item) => {
      const cls = `nav-item${item.rec ? ' nav-rec' : ''}${item.desktop ? ' nav-desktop-only' : ''}${item.mobile ? ' nav-mobile-only' : ''}${active === item.route ? ' active' : ''}`;
      const inner = [item.rec ? h('span', { class: 'nav-rec-dot' }, icon('record', 22)) : icon(item.icon, 22), h('span', null, item.label)];
      if (item.action === 'phone') return window.psicoDesktop ? h('button', { class: cls, onclick: openPhone }, inner) : null;
      return h('a', { href: `#/${item.route}`, class: cls, 'aria-current': active === item.route ? 'page' : null }, inner);
    }).filter(Boolean)
  );
}

let cleanup = null;
let navToken = 0;

async function route() {
  const token = ++navToken;
  const { route: r, id, query } = parseHash();
  if (MOBILE_APP && !MOBILE_ROUTES.has(r)) {
    // Celular: abre la cámara; enlaces antiguos al editor llevan a «Mis tomas».
    location.replace(`#/${r === 'editor' ? 'takes' : 'record'}`);
    return;
  }
  const loader = ROUTES[r] || ROUTES[''];
  if (typeof cleanup === 'function') {
    try {
      await cleanup();
    } catch (e) {
      console.warn(e);
    }
  }
  cleanup = null;
  const root = document.getElementById('view');
  document.body.classList.toggle('immersive', IMMERSIVE.has(r));
  renderNav(r);
  root.replaceChildren(h('div', { class: 'muted', style: { padding: '24px' } }, 'Cargando…'));
  try {
    const mod = await loader();
    if (token !== navToken) return;
    root.replaceChildren();
    root.scrollTop = 0;
    window.scrollTo(0, 0);
    cleanup = await mod.default(root, { id, query, go });
  } catch (err) {
    console.error(err);
    root.replaceChildren(
      h('div', { class: 'empty' }, h('h2', null, 'Algo salió mal'), h('p', null, String(err?.message || err)), h('a', { class: 'btn', href: MOBILE_APP ? '#/record' : '#/' }, 'Volver al inicio'))
    );
  }
}

document.body.classList.toggle('mobile-app', MOBILE_APP);
window.addEventListener('hashchange', route);
window.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') history.back();
  else if (e.key === 'ArrowRight') history.forward();
  else return;
  e.preventDefault();
});
window.addEventListener('error', (e) => {
  if (e.message && !/ResizeObserver/.test(e.message)) toast(`Error: ${e.message}`, 'error', 5000);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  if (msg && !/AbortError|play\(\) request was interrupted|The operation was aborted/i.test(msg)) toast(`Error: ${msg}`, 'error', 5000);
});

// Botón «atrás» de Android: primero cierra diálogos y hojas abiertas.
window.__psicoBack = () => {
  if (document.querySelector('.overlay.show')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  }
  const review = document.querySelector('.review [aria-label="Cerrar revisión"]');
  if (review) {
    review.click();
    return true;
  }
  const pop = document.querySelector('.speed-pop:not(.hidden)');
  if (pop) {
    pop.classList.add('hidden');
    return true;
  }
  return false;
};

/** ¿Hay algo en curso que una recarga interrumpiría? (grabando, exportando o un diálogo abierto) */
const busy = () => !!document.querySelector('.recorder.is-rec, .overlay.show, .review, .countdown');

// Modo sin conexión y actualizaciones: en el iPhone, Android y la web. En el PC la app se sirve localmente.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if ('serviceWorker' in navigator && window.isSecureContext) {
  if (LOCAL_HOST) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  } else {
    const hadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        const check = () => reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
        setInterval(check, 30 * 60 * 1000);
      } catch (e) {
        console.warn('SW no registrado', e);
      }
    });
    // Versión nueva instalada: se recarga sola cuando no estás grabando ni guardando.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      const tryReload = () => {
        if (reloading) return;
        if (busy()) return setTimeout(tryReload, 5000);
        reloading = true;
        location.reload();
      };
      tryReload();
    });
  }
}
try {
  const last = localStorage.getItem('psico-version');
  if (last && last !== APP_VERSION) setTimeout(() => toast(`Actualizado a la versión ${APP_VERSION}`, 'ok', 4000), 1200);
  localStorage.setItem('psico-version', APP_VERSION);
} catch {
  /* sin almacenamiento local */
}

navigator.storage?.persist?.().catch(() => {});
if (navigator.audioSession) {
  try {
    navigator.audioSession.type = 'play-and-record';
  } catch {
    /* no soportado */
  }
}

// Recordatorios de publicaciones programadas (mientras la app está abierta, en el PC).
async function checkReminders() {
  try {
    const { db } = await import('./lib/db.js');
    const now = new Date();
    for (const i of await db.all('ideas')) {
      if (!i.date || !i.time || i.notified || i.status === 'publicado') continue;
      if (new Date(`${i.date}T${i.time}:00`) > now) continue;
      i.notified = true;
      await db.put('ideas', i);
      const text = `Es hora de publicar: ${i.title}`;
      toast(text, 'ok', 10000);
      if (window.psicoDesktop) window.psicoDesktop.notify('Psico Influencer', text);
      else if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Psico Influencer', { body: text, icon: 'icons/icon-192.png' });
        } catch {
          /* iOS sin notificaciones locales */
        }
      }
    }
  } catch (e) {
    console.warn(e);
  }
}
if (!MOBILE_APP) {
  setInterval(checkReminders, 60000);
  setTimeout(checkReminders, 4000);
}

// Programa de PC: conectar celular, videos recibidos por Wi-Fi y puente para Claude (MCP).
if (window.psicoDesktop) {
  window.psicoDesktop.onIphoneRequest?.(openPhone);
  window.psicoDesktop.onPhoneReceived?.((data) => import('./views/iphone.js').then((m) => m.onPhoneReceived(data, go)));
  import('./ai/agent-bridge.js').then((m) => m.installAgentBridge({ go })).catch((e) => console.warn('Puente de Claude', e));
}

// Acceso de depuración para pruebas automatizadas.
window.__psico = { go, parseHash };

route();
