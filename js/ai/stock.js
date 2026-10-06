// Imágenes de stock con licencia libre (Openverse), traídas directo de internet al editor.
// Se guardan como medios de la biblioteca con su autor y licencia (para dar el crédito si lo piden).
import { addMedia } from '../store.js';

export async function searchStock(query) {
  const r = await fetch(`/api/stock?q=${encodeURIComponent(query)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'No se pudo buscar');
  return j.results || [];
}

/** Busca y trae la primera imagen utilizable. Devuelve el medio agregado a la biblioteca. */
export async function stockImage(query) {
  const results = await searchStock(query);
  if (!results.length) throw new Error(`sin resultados libres para «${query}»`);
  for (const it of results.slice(0, 6)) {
    try {
      const r = await fetch(`/api/fetch?url=${encodeURIComponent(it.url)}`);
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob.type.startsWith('image/') || blob.size < 5000) continue;
      return addMedia({ blob, name: `Stock · ${(it.title || query).slice(0, 40)}`, kind: 'image', extra: { library: true, stock: true, credit: it.creator || '', license: it.license, page: it.page } });
    } catch {
      /* siguiente resultado */
    }
  }
  throw new Error('no pude traer ninguna imagen de los resultados');
}
