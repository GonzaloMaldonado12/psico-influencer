// Material local de edición (carpeta «Material» del PC): catálogo compacto para Claude con códigos cortos
// estables (s = sonido, m = música, v = footage, o = overlay, l = LUT) e importación a la biblioteca.
import { addMedia } from '../store.js';
import { decodeAudio } from '../core/media.js';
import { materialUrl } from '../core/sfx.js';

let cache = null;
let loadingP = null;

/** Lista del Material (vacía si no hay programa de PC o carpeta). */
export function loadMaterial(force = false) {
  if (typeof window === 'undefined' || !window.psicoDesktop) return Promise.resolve([]);
  if (cache && !force) return Promise.resolve(cache);
  loadingP ||= fetch('/material/manifest.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((j) => (cache = withCodes(j.items || [])))
    .catch(() => (cache = []))
    .finally(() => (loadingP = null));
  return loadingP;
}

const PREFIX = { sfx: 's', music: 'm', footage: 'v', overlays: 'o', luts: 'l', graficos: 'e' };

function withCodes(items) {
  const by = {};
  for (const it of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const p = PREFIX[it.categoria];
    if (!p) continue;
    by[p] = (by[p] || 0) + 1;
    it.code = `${p}${by[p]}`;
  }
  return items.filter((x) => x.code);
}

export const byCode = (items, code) => items.find((x) => x.code === String(code || '').trim().toLowerCase());
export const fileUrl = (it) => materialUrl(it.ruta);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Palabras que suelen indicar sonidos útiles y sobrios para edición.
const BAD = /zombie|monster|horror|scream|roar|fart|gun|shot|explosion|war|battle|karate|punch|blood|scary|terror|alarm|siren|vomit|burp|sneeze|cough|kiss|moan/i;
// Etiquetas de música más afines al tono clínico y cálido (orden de preferencia).
const CALM = ['ambient', 'atmospheres', 'chillout', 'minimalism', 'new-age', 'underscore', 'calming', 'relaxed', 'corporate-music', 'lo-fi-beats', 'downtempo'];
const GOOD = /soft|light|gentle|short|quick|subtle|air|pop|click|whoosh|swoosh|swish|transition|ding|bell|notification|shutter|typing|keyboard|paper|page|bubble|sparkle|magic|interface|ui|tap|select/i;

/**
 * Catálogo compacto (~1 000 tokens) del Material para el modelo. Va en las instrucciones de sistema
 * (estable entre pedidos → caché de Claude).
 */
export function materialCatalog(items) {
  if (!items?.length) return '';
  const sfx = items.filter((x) => x.categoria === 'sfx' && (x.duracion == null || x.duracion <= 4) && !BAD.test(x.nombre));
  const usos = {};
  const seen = new Set();
  for (const s of sfx.sort((a, b) => (GOOD.test(b.nombre) ? 1 : 0) - (GOOD.test(a.nombre) ? 1 : 0) || (a.duracion ?? 1) - (b.duracion ?? 1))) {
    const u = s.uso || 'otros';
    const base = clean(s.nombre).toLowerCase().replace(/[\s_]*\d+$/, '');
    if (seen.has(base) || (usos[u] ||= []).length >= 6) continue;
    seen.add(base);
    usos[u].push(`${s.code} ${clean(s.nombre).slice(0, 26)}`);
  }
  const tagRank = (t) => {
    const i = CALM.indexOf(String(t).toLowerCase());
    return i < 0 ? 20 : i;
  };
  // Primero lo que no exige crédito y lo más calmo.
  const rank = (m) => (m.atribucion ? 100 : 0) + Math.min(20, ...(m.etiquetas || []).map(tagRank));
  const music = items.filter((x) => x.categoria === 'music' && !(x.etiquetas || []).some((t) => /dark|action|humorous|bouncy|epic/i.test(t)))
    .sort((a, b) => rank(a) - rank(b)).slice(0, 22)
    .map((m) => `${m.code} ${clean(m.nombre).slice(0, 24)} (${(m.etiquetas || []).slice(0, 1).join('')}${m.bpm ? ` ${m.bpm}bpm` : ''})${m.atribucion ? ' [crédito]' : ''}`);
  const foot = items.filter((x) => x.categoria === 'footage').map((v) => `${v.code} ${clean(v.descripcion || v.nombre).slice(0, 48)}`);
  const over = items.filter((x) => x.categoria === 'overlays').map((v) => `${v.code} ${clean(v.nombre).slice(0, 32)}`);
  const luts = items.filter((x) => x.categoria === 'luts').map((v) => `${v.code} ${clean(v.nombre)}`);
  const stk = items.filter((x) => x.categoria === 'graficos').slice(0, 60).map((v) => `${v.code} ${(v.etiquetas || []).at(-1) || ''}`);
  return [
    'MATERIAL PROFESIONAL DEL PC (archivos locales con licencia verificada; úsalos por su código):',
    'Sonidos (op sonido tipo=<código>, volumen 0.25-0.35; sin whoosh fuerte):',
    ...Object.entries(usos).map(([u, l]) => `- ${u}: ${l.join(' · ')}`),
    `Música (op musica archivo=<código>, volumen ≈0.30, baja sola bajo la voz): ${music.join(' · ')}`,
    foot.length ? `Footage vertical (op material codigo=<código> desde hasta, b-roll a pantalla completa): ${foot.join(' · ')}` : '',
    over.length ? `Overlays de luz (op material codigo=<código> desde hasta, se mezclan en modo pantalla): ${over.join(' · ')}` : '',
    luts.length ? `LUTs de color (op color lut=<código> intensidad 0.4-1): ${luts.join(' · ')}` : '',
    stk.length ? `Stickers emoji 3D (op material codigo=e# desde hasta x y; máx. 1-2 por video, para remarcar una idea): ${stk.join(' ')}` : '',
    'Transiciones pro GL (op transicion tipo=gl:<nombre>, 0.4-0.7 s, solo en cambios de tema): gl:fade gl:LinearBlur gl:crosswarp gl:directionalwarp gl:Dreamy gl:CrossZoom gl:DefocusBlur gl:Overexposure gl:wind gl:ripple gl:burn gl:morph',
  ].filter(Boolean).join('\n');
}

const imported = new Map(); // ruta → media (evita duplicar en la biblioteca durante la sesión)

/** Copia un archivo del Material a la biblioteca del proyecto (necesario para el reproductor y la exportación). */
export async function importMaterial(it) {
  if (imported.has(it.ruta)) return imported.get(it.ruta);
  const r = await fetch(fileUrl(it));
  if (!r.ok) throw new Error(`No pude leer «${it.nombre}» del Material (${r.status}).`);
  const blob = await r.blob();
  const name = `${clean(it.nombre)}${it.ruta.slice(it.ruta.lastIndexOf('.'))}`;
  const credit = it.atribucion || '';
  let media;
  if (it.categoria === 'music' || it.categoria === 'sfx') {
    let duration = it.duracion || 0;
    try {
      duration = (await decodeAudio(blob)).duration;
    } catch { /* se usa la duración del catálogo */ }
    media = await addMedia({ blob, name, kind: 'audio', duration, extra: { library: true, material: it.id, credit, license: it.licencia } });
  } else if (it.categoria === 'graficos') {
    media = await addMedia({ blob, name, kind: 'image', extra: { library: true, material: it.id, credit, license: it.licencia } });
  } else {
    const duration = await new Promise((res) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => res(v.duration || 0);
      v.onerror = () => res(it.duracion || 0);
      v.src = fileUrl(it);
    });
    media = await addMedia({ blob, name, kind: 'video', duration, extra: { library: true, material: it.id, credit, license: it.licencia } });
  }
  imported.set(it.ruta, media);
  return media;
}
