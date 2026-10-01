// Grabación a prueba de cortes: cada segundo de video se guarda en el dispositivo mientras grabas.
// Si la app se cierra de golpe (llamada, batería, iOS la suspende), la toma se recupera al volver.
import { db } from '../lib/db.js';
import { uid } from '../lib/util.js';

const ACTIVE = 'rec-active';

export class TakeWriter {
  constructor(meta = {}) {
    this.id = uid('t_');
    this.meta = meta;
    this.mem = []; // trozos aún no guardados (o todos, si el guardado falla)
    this.persist = true;
    this.pending = Promise.resolve();
    this.bytes = 0;
  }

  async begin() {
    try {
      await db.setKV(ACTIVE, { id: this.id, startedAt: Date.now(), ...this.meta });
    } catch {
      this.persist = false;
    }
  }

  push(blob) {
    if (!blob?.size) return;
    this.bytes += blob.size;
    const i = this.mem.push(blob) - 1;
    if (!this.persist) return;
    const id = `${this.id}:${String(i).padStart(6, '0')}`;
    this.pending = this.pending.then(async () => {
      if (!this.persist) return;
      try {
        await db.put('chunks', { id, take: this.id, seq: i, blob });
        this.mem[i] = null; // ya está en disco: se libera la memoria
      } catch {
        this.persist = false; // sin espacio u otro error: se sigue en memoria
      }
    });
  }

  /** Une todos los trozos en un solo archivo. */
  async finish(type) {
    await this.pending;
    let parts = this.mem;
    if (this.mem.some((b) => !b)) {
      const stored = await db.byPrefix('chunks', `${this.id}:`);
      const bySeq = new Map(stored.map((c) => [c.seq, c.blob]));
      parts = this.mem.map((b, i) => b || bySeq.get(i)).filter(Boolean);
    }
    return new Blob(parts, { type });
  }

  async cleanup() {
    try {
      await db.delPrefix('chunks', `${this.id}:`);
      await db.setKV(ACTIVE, null);
    } catch {
      /* se limpiará en la próxima recuperación */
    }
  }
}

/**
 * Recupera grabaciones que quedaron a medias (la app se cerró mientras grababas).
 * Devuelve [{ blob, meta }] y borra los trozos.
 */
export async function recoverTakes() {
  let keys = [];
  try {
    keys = await db.keys('chunks');
  } catch {
    return [];
  }
  if (!keys.length) return [];
  const active = await db.getKV(ACTIVE, null);
  const ids = [...new Set(keys.map((k) => String(k).split(':')[0]))];
  const out = [];
  for (const id of ids) {
    const chunks = (await db.byPrefix('chunks', `${id}:`)).sort((a, b) => a.seq - b.seq);
    const meta = active?.id === id ? active : {};
    const type = (meta.mime || chunks[0]?.blob?.type || 'video/mp4').split(';')[0];
    const blob = new Blob(chunks.map((c) => c.blob), { type });
    await db.delPrefix('chunks', `${id}:`);
    if (blob.size > 50_000) out.push({ blob, meta, seconds: chunks.length });
  }
  await db.setKV(ACTIVE, null);
  return out;
}
