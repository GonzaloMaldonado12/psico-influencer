// Acciones de una toma en el celular: guardar en Fotos/Galería (original o con la mirada
// corregida por IA) y enviarla al PC. Lo usan la grabadora y «Mis tomas».
import { h, icon, toggle, modal } from '../lib/dom.js';
import { IS_IOS, sanitizeFilename } from '../lib/util.js';
import { extFor } from '../core/media.js';
import { saveSettings, updateMedia } from '../store.js';
import { saveToDevice } from './share.js';

/** Nombre de archivo para guardar una toma. */
export function takeFileName(rec) {
  const d = new Date(rec.createdAt || Date.now());
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  return `${sanitizeFilename(rec.scriptTitle || 'toma')}-${stamp}.${extFor(rec.type || rec.blob?.type)}`;
}

export const SAVE_LABEL = IS_IOS ? 'Guardar en Fotos' : 'Guardar en la galería';

/**
 * Bloque «Guardar»: el original se guarda dentro del mismo toque (iOS lo exige para abrir la hoja
 * de «Guardar video»); con la mirada corregida primero se procesa y después un segundo toque guarda.
 */
export function saveBox(rec, settings, { isAlive = () => true, onSaved } = {}) {
  const box = h('div', { class: 'save-box' });
  const status = h('div', { class: 'save-status hint center' });
  const markSaved = () => {
    rec.saved = true;
    updateMedia(rec.id, { saved: true }).catch(() => {});
    onSaved?.();
  };
  const label = () => (settings.saveGaze ? 'Corregir mirada y guardar' : SAVE_LABEL);
  const btn = h('button', { class: 'btn btn-primary btn-block btn-lg' });
  const paint = () => btn.replaceChildren(icon(settings.saveGaze ? 'eye' : 'photos', 20), label());
  const gazeT = toggle({
    label: 'Corregir mirada con IA',
    hint: 'Lleva tus ojos al lente de forma natural. Tarda más o menos lo que dura el video.',
    checked: !!settings.saveGaze,
    onChange: (v) => {
      settings.saveGaze = v;
      saveSettings(settings);
      paint();
    },
  });
  btn.addEventListener('click', async () => {
    const webm = /webm/.test(rec.type || rec.blob?.type || '');
    if (!settings.saveGaze && !webm) {
      if (await saveToDevice(rec.blob, takeFileName(rec))) markSaved();
      return;
    }
    // Procesar: mirada corregida (o MP4 compatible si la toma quedó en WebM).
    btn.disabled = true;
    gazeT.classList.add('hidden');
    const bar = h('div', { class: 'progress-fill' });
    const text = h('span', null, 'Preparando…');
    let cancelled = false;
    status.replaceChildren(h('div', { class: 'progress' }, bar), text, h('button', { class: 'btn btn-sm btn-ghost', onclick: () => (cancelled = true) }, 'Cancelar'));
    try {
      const { processTake } = await import('../core/take-export.js');
      const out = await processTake(rec, {
        gaze: !!settings.saveGaze,
        onProgress: (p, t) => {
          bar.style.width = `${Math.round(p * 100)}%`;
          if (t) text.textContent = t;
        },
        isCancelled: () => cancelled || !isAlive(),
      });
      if (!out) {
        status.textContent = 'Cancelado.';
        btn.disabled = false;
        gazeT.classList.remove('hidden');
        return;
      }
      status.replaceChildren(h('span', null, settings.saveGaze ? 'Mirada corregida ✔' : 'Video listo ✔'));
      const save2 = h('button', { class: 'btn btn-primary btn-block btn-lg' }, icon('photos', 20), IS_IOS ? 'Toca para guardar en Fotos' : SAVE_LABEL);
      save2.addEventListener('click', async () => {
        if (await saveToDevice(out.blob, takeFileName({ ...out, scriptTitle: rec.scriptTitle }))) markSaved();
      });
      btn.replaceWith(save2);
      // En la app de Android se guarda directo, sin un segundo toque.
      if (window.AndroidBridge) save2.click();
    } catch (e) {
      status.textContent = `No se pudo procesar: ${e.message}`;
      btn.disabled = false;
      gazeT.classList.remove('hidden');
    }
  });
  paint();
  box.append(btn, gazeT, status);
  return box;
}

/** Cómo pasar tomas al PC (Wi-Fi con el programa abierto, o compartiendo). */
export function sendToPcHelp() {
  return modal({
    title: 'Enviar tomas al PC',
    body: h('div', null,
      h('ol', { class: 'install-steps' },
        h('li', null, 'Primero guarda la toma en ', h('b', null, IS_IOS ? 'Fotos' : 'tu galería'), ' (botón de arriba).'),
        h('li', null, 'En el PC abre Psico Influencer › ', h('b', null, 'Conectar celular'), ' (menú Archivo o Ajustes).'),
        h('li', null, 'Escanea el código con la cámara del celular (misma Wi-Fi) y elige los videos.'),
        h('li', null, 'Llegan solos al PC como un proyecto nuevo, listos para editar.')
      ),
      h('p', { class: 'hint' }, 'También puedes usar Compartir (AirDrop, WhatsApp, Drive…) y luego Importar en el PC.')
    ),
    actions: [{ label: 'Entendido', value: true, kind: 'primary' }],
  });
}
