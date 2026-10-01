// Claude con TU plan (Pro de 20 USD, o Max) a través de Claude Code instalado en este PC: sin API de
// pago ni claves. Pensado para rendir el plan al máximo:
//  · instrucciones fijas y cortas (Claude las guarda en caché entre consultas),
//  · contexto compacto (resumen + transcripción por frases, no el proyecto entero),
//  · sin herramientas ni MCP en la consulta (no se cargan definiciones que gastan tokens),
//  · modelo según la tarea: Haiku para textos cortos, Sonnet para planes y guiones, Opus solo si lo eliges,
//  · respuesta en JSON validado cuando hace falta estructura (sin reintentos por formato).
// Sin internet, sin Claude o con el límite del plan alcanzado, la app usa la IA local (Ollama / navegador).
import * as usage from './ai-usage.js';
import { db } from '../lib/db.js';

export const CLAUDE_MODELS = [
  ['auto', 'Automático (recomendado)'],
  ['haiku', 'Haiku · rápido y muy ahorrador'],
  ['sonnet', 'Sonnet · mejor calidad por consumo'],
  ['opus', 'Opus · máxima calidad (gasta más del plan)'],
];

export const hasClaudeBridge = () => typeof window !== 'undefined' && !!window.psicoDesktop?.claude;

export async function claudeSettings() {
  const ai = await db.getKV('ai', {});
  return { claudeOn: ai.claudeOn !== false, claudeModel: ai.claudeModel || 'auto' };
}

let statusCache = null;
/** Estado de la conexión: { ok, installed, loggedIn, plan, online, desktopMcp, codeMcp, reason } */
export async function claudeStatus(force = false) {
  if (!hasClaudeBridge()) return { ok: false, installed: false, reason: 'Claude se usa desde el programa de PC.' };
  if (statusCache && !force && Date.now() - statusCache.at < 60_000) return statusCache.value;
  const value = await window.psicoDesktop.claude.status(force);
  statusCache = { at: Date.now(), value };
  return value;
}

/** Modelo para la tarea: 'short' (títulos, hashtags, ganchos), 'plan' (edición), 'write' (guiones). */
export function pickModel(task, pref = 'auto') {
  if (pref && pref !== 'auto') return pref;
  return task === 'short' ? 'haiku' : 'sonnet';
}

export const MODEL_LABEL = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };

export class ClaudeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // off | missing | auth | offline | limit | error
  }
}

/** Texto para explicar por qué no se usó Claude. */
export function claudeReason(e) {
  return {
    off: 'Claude está desactivado.',
    missing: 'Claude Code no está instalado en este PC.',
    auth: 'Claude Code no tiene tu sesión iniciada.',
    offline: 'Sin internet.',
    limit: 'Llegaste al límite de tu plan por ahora.',
  }[e?.kind] || `Claude no respondió (${e?.message || 'error'}).`;
}

/**
 * Consulta única a Claude. Devuelve { text, data, model, usage, ms }.
 * schema: esquema JSON para respuesta estructurada (opcional).
 */
export async function askClaude({ task = 'write', system, prompt, schema = null, effort } = {}) {
  if (!hasClaudeBridge()) throw new ClaudeError('missing', 'Claude se usa desde el programa de PC.');
  const cfg = await claudeSettings();
  if (!cfg.claudeOn) throw new ClaudeError('off', 'Claude está desactivado en Ajustes.');
  const model = pickModel(task, cfg.claudeModel);
  const r = await window.psicoDesktop.claude.ask({ system, prompt, schema, model, effort: effort || (task === 'write' && model !== 'haiku' ? 'medium' : 'low') });
  if (!r?.ok) {
    statusCache = null;
    throw new ClaudeError(r?.kind || 'error', r?.error || 'Claude no respondió.');
  }
  usage.recordClaude(r.usage).catch(() => {});
  return { ...r, modelKey: model };
}

/** Tokens de una respuesta (para mostrar el consumo). */
export function tokensOf(r) {
  const u = r?.usage || {};
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
}
