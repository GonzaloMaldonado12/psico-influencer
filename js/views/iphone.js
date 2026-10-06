// «Conectar celular» (programa de PC): recibir por Wi-Fi los videos grabados en el celular,
// copiar guiones al celular e instalar la app de grabación en iPhone o Android.
import { h, icon, modal, toast } from '../lib/dom.js';
import { fmtBytes } from '../lib/util.js';

export const WEB_URL = 'https://gonzalomaldonado12.github.io/psico-influencer/';

function steps(list) {
  return h('ol', { class: 'install-steps' }, list.map((s) => h('li', null, s)));
}

export async function showPhoneConnect() {
  const D = window.psicoDesktop;
  if (!D?.phone) {
    return modal({
      title: 'Conectar celular',
      body: h('div', null, h('p', null, 'Abre el programa de PC de Psico Influencer para recibir videos por Wi-Fi.'), h('p', null, 'App del celular: ', h('a', { href: WEB_URL, target: '_blank', rel: 'noopener' }, WEB_URL))),
      actions: [{ label: 'Cerrar', value: null }],
    });
  }
  const live = h('div', { class: 'phone-live', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'spinner' }), 'Preparando la conexión…');
  const recvCard = h('div', { class: 'card' }, h('h2', null, '📲 Recibir videos del celular'), live);
  const webQr = await D.qr(WEB_URL).catch(() => null);
  const installCard = h('div', { class: 'card' },
    h('h2', null, 'Instalar la app de grabación'),
    h('div', { class: 'qr-row' },
      webQr ? h('div', { class: 'qr' }, h('img', { src: webQr, alt: 'Código QR de la app' }), h('b', null, 'iPhone y Android'), h('small', null, WEB_URL)) : null
    ),
    h('h3', null, 'iPhone'),
    steps(['Escanea el código con la Cámara y ábrelo en Safari.', 'Toca Compartir (cuadrado con flecha) › «Agregar a pantalla de inicio».', 'Abre Psico Influencer desde el ícono y permite cámara y micrófono.']),
    h('h3', null, 'Android'),
    steps(['Instala el archivo «Psico-Influencer-Android.apk» que está en el Escritorio de este PC (envíalo por WhatsApp o cable),', 'o abre el código en Chrome › menú ⋮ › «Instalar app».'])
  );
  let unsub = null;
  const files = new Map();
  const render = (info, extra) => {
    live.replaceChildren(
      h('div', { class: 'qr-row' }, h('div', { class: 'qr' }, h('img', { src: info.qr, alt: 'Código QR para enviar videos' }), h('b', null, 'Escanéalo con la cámara del celular'), h('small', null, info.url))),
      steps([
        'Celular y PC en la misma Wi-Fi.',
        'Escanea el código: se abre una página para enviar.',
        'Elige los videos (desde Fotos o Archivos) y toca Enviar.',
        'Llegan solos aquí como un proyecto nuevo, listos para editar.',
      ]),
      h('p', { class: 'hint' }, 'En esa misma página puedes copiar tus guiones para pegarlos en la app del celular. Mantén esta ventana abierta mientras se envían.'),
      extra || ''
    );
  };
  const progressList = h('div', { class: 'list' });
  try {
    const info = await D.phone.start();
    render(info, progressList);
    unsub = D.onPhoneProgress?.((p) => {
      files.set(p.name, p);
      progressList.replaceChildren(...[...files.values()].map((f) => h('div', { class: 'list-item' },
        icon(f.done ? 'check' : 'upload'),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, f.name), h('div', { class: 'sub' }, f.done ? `Recibido · ${fmtBytes(f.size)}` : `${Math.round((f.received / Math.max(1, f.size)) * 100)}% · ${fmtBytes(f.received)} de ${fmtBytes(f.size)}`))
      )));
    });
  } catch (e) {
    live.replaceChildren(h('p', { class: 'bad' }, `No se pudo activar: ${e.message}`), h('p', { class: 'hint' }, 'Revisa que el PC esté conectado a una red Wi-Fi o por cable. Si Windows pregunta por el Firewall, permite «Redes privadas».'));
  }
  await modal({ title: 'Conectar celular', wide: true, body: h('div', null, recvCard, installCard), actions: [{ label: 'Cerrar', value: null }] });
  unsub?.();
  D.phone.stop().catch(() => {});
}

/** Compatibilidad: el menú antiguo «Modo iPhone». */
export const showIphoneMode = showPhoneConnect;

/** Videos que llegaron del celular: se crea un proyecto con todas las tomas del envío. */
export async function onPhoneReceived(data, go) {
  if (!data?.files?.length) return;
  const { importVideos } = await import('./projects.js');
  const done = toast(`Recibiendo ${data.files.length} video${data.files.length === 1 ? '' : 's'} del celular…`, 'info', 4000);
  try {
    const list = [];
    for (const f of data.files) {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error(`No pude leer ${f.name}`);
      const blob = await r.blob();
      list.push(new File([blob], f.name, { type: blob.type || 'video/mp4' }));
    }
    const p = await importVideos(list);
    const v = await modal({
      title: 'Videos recibidos del celular',
      body: h('p', null, `${list.length} video${list.length === 1 ? '' : 's'} en el proyecto «${p.title}». También quedaron guardados en Videos › Psico Influencer › Recibidos.`),
      actions: [{ label: 'Más tarde', value: null }, { label: 'Abrir en el editor', value: 'open', kind: 'primary' }],
    });
    if (v === 'open') go(`editor/${p.id}`);
  } catch (e) {
    toast(`No se pudieron importar: ${e.message}`, 'error', 6000);
  }
  return done;
}
