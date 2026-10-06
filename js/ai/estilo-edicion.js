// Guía de estilo de edición que se entrega a Claude / IA local junto con cada pedido de edición.
// Basada en el «prompt maestro» de Ánima Mente (pieza de referencia «busca psicólogo v06»).
// Se guarda en Ajustes (ai.editStyle) y el usuario puede editarla o restaurarla.
import { db } from '../lib/db.js';

export const DEFAULT_EDIT_STYLE = [
  'ESTILO (referencia de calidad: igualar o superar; tono clínico, cálido y sobrio):',
  '1) Gancho en el primer segundo; sin saludos ni intros lentas. Un video = un mensaje = una acción final (CTA único, ej. link del perfil). Cada recurso visual responde a algo que se dice; el texto refuerza, no repite todo.',
  '2) Cortes: quitar_silencios (≈0.25 s) y quitar_muletillas; corta finales sobrantes. Corte seco por defecto: sin transiciones ni efectos gratuitos (transición solo al entrar al cierre).',
  '3) Ritmo: zoom_dinamico, alternando plano 1.00 / 1.12 / 1.14 por segmento, entrada suave que se asienta; la cara siempre arriba del centro.',
  '4) Fondo: la persona nítida; fondo del mismo lugar desenfocado y algo más oscuro (fondo desenfoque), nunca identificable.',
  '5) Tarjetas (op texto con caja), una por cada tema que se mencione (gancho, nombre/título, edades, online, FONASA, presencial, descuentos, CTA): breves, entran y salen suaves. Gancho arriba (posicion arriba); el resto centro-abajo SIN tapar la cara. Paleta: navy #0B2A4A, azul #1E6FD9, celeste #4DA3FF, claro #E8F1FF.',
  '6) Subtítulos: mayúsculas, máx. 3 palabras (~17 caracteres) por línea, contorno oscuro, palabras clave en celeste #4DA3FF (no amarillo), dentro de la zona segura (libre ~10 % arriba y ~15-20 % abajo).',
  '7) Sonido: voz primero. Nada de whoosh fuerte: solo un barrido suave (vol ≈0.3) en 2-3 cortes, pop suave (≈0.3) al aparecer tarjetas, click al abrir un link. Música ambiental tranquila a ≈0.30 que baja bajo la voz; entra en 1.5 s y sale en ~2.6 s.',
  '8) Honestidad: sin promesas clínicas ni resultados garantizados; no inventes datos, precios ni ofertas (solo si el usuario las da con vigencia). Si algo no se puede verificar, dilo en «resumen».',
].join('\n');

export async function getEditStyle() {
  const ai = await db.getKV('ai', {});
  return typeof ai.editStyle === 'string' && ai.editStyle.trim() ? ai.editStyle : DEFAULT_EDIT_STYLE;
}

/** Consejos para el próximo guion según el prompt maestro (se añaden al pedir o revisar guiones). */
export const SCRIPT_FEEDBACK = 'Revisa el guion para grabar y editar: gancho en la primera línea; frases de 1-2 ideas (no más de ~3 s sin pausa); un solo CTA; marca [pausa], [cambio de plano], [énfasis] y [mirar a cámara] donde ayude, y señala muletillas o frases largas.';
