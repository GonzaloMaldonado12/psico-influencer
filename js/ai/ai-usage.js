// Estadísticas de IA del mes: imágenes del motor local (tiempos) y consultas a Claude con tu plan
// (tokens), para que veas cuánto usas. No hay servicios de pago: Claude usa tu suscripción.
import { db } from '../lib/db.js';

export const DEFAULTS = { checkpoint: '' };

const monthKey = () => new Date().toISOString().slice(0, 7);
const blank = () => ({ month: monthKey(), local: { images: 0, ms: [] }, claude: { requests: 0, input: 0, output: 0, cached: 0, local: 0 } });

export async function getConfig() {
  return { ...DEFAULTS, ...(await db.getKV('aiConfig', {})) };
}
export async function setConfig(patch) {
  await db.setKV('aiConfig', { ...(await getConfig()), ...patch });
}

/** Uso del mes actual (se reinicia solo al cambiar de mes). */
export async function getUsage() {
  const u = await db.getKV('aiUsage', null);
  if (!u || u.month !== monthKey() || !u.local) {
    const fresh = blank();
    await db.setKV('aiUsage', fresh);
    return fresh;
  }
  u.claude ||= blank().claude;
  return u;
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export async function summary() {
  const u = await getUsage();
  return { month: u.month, localImages: u.local.images, localAvgMs: avg(u.local.ms), claude: u.claude };
}

export async function recordLocal(ms) {
  const u = await getUsage();
  u.local.images++;
  u.local.ms = [...u.local.ms, Math.round(ms)].slice(-20);
  await db.setKV('aiUsage', u);
}

/** Suma una consulta a Claude (usage: {input_tokens, output_tokens, cache_read_input_tokens, ...}). */
export async function recordClaude(usage = {}) {
  const u = await getUsage();
  const c = u.claude;
  c.requests++;
  c.input += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  c.cached += usage.cache_read_input_tokens || 0;
  c.output += usage.output_tokens || 0;
  await db.setKV('aiUsage', u);
}

/** Suma una tarea resuelta con la IA local (sin internet o sin Claude). */
export async function recordLocalText() {
  const u = await getUsage();
  u.claude.local++;
  await db.setKV('aiUsage', u);
}
