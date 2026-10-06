// Guardar y compartir: en iPhone abre la hoja para «Guardar video» en Fotos; en la app de
// Android guarda directo en la Galería; en el PC descarga el archivo.
import { toast } from '../lib/dom.js';
import { IS_IOS } from '../lib/util.js';

/** App de Android (APK): el WebView no descarga blobs, así que se pasan en trozos al código nativo. */
const nativeBridge = () => (typeof window !== 'undefined' && window.AndroidBridge?.beginSave ? window.AndroidBridge : null);

async function saveNative(blob, filename, andShare) {
  const B = nativeBridge();
  B.beginSave(filename, blob.type || 'application/octet-stream');
  const CH = 768 * 1024; // múltiplo de 3 → base64 sin relleno entre trozos
  for (let o = 0; o < blob.size; o += CH) {
    const buf = new Uint8Array(await blob.slice(o, o + CH).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    B.chunk(btoa(bin));
  }
  return B.endSave(!!andShare);
}

const isMedia = (blob) => /^(video|image)\//.test(blob.type || '');

export function downloadBlob(blob, filename) {
  if (nativeBridge()) {
    saveNative(blob, filename, false)
      .then((ok) => toast(ok === false ? 'No se pudo guardar' : isMedia(blob) ? 'Guardado en tu Galería' : 'Guardado en Descargas', ok === false ? 'error' : 'ok'))
      .catch(() => toast('No se pudo guardar', 'error'));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareFile(blob, filename, title = '') {
  if (nativeBridge()) {
    try {
      await saveNative(blob, filename, true);
      return true;
    } catch {
      toast('No se pudo guardar', 'error');
      return false;
    }
  }
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return true;
      toast('No se pudo abrir «Guardar». Vuelve a tocar el botón.', 'error', 5000);
      return false;
    }
  }
  downloadBlob(blob, filename);
  toast('Descargado');
  return false;
}

/**
 * «Guardar en el dispositivo»: Fotos en iPhone (hoja de compartir → Guardar video),
 * Galería en la app de Android, descarga en el PC. Llamar dentro del toque del usuario.
 */
export async function saveToDevice(blob, filename) {
  if (nativeBridge()) {
    downloadBlob(blob, filename);
    return true;
  }
  if (IS_IOS) return shareFile(blob, filename);
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (/Android/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) return shareFile(blob, filename);
  downloadBlob(blob, filename);
  return true;
}

export async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', 'ok');
  } catch {
    toast('No se pudo compartir', 'error');
  }
}
