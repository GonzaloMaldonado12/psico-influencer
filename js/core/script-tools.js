// Herramientas de guion 100 % locales: estadísticas, plantillas, ganchos,
// generador estructurado, texto de publicación y hashtags.
import { splitWords, normalizeWord } from '../lib/util.js';

export function scriptStats(text, wpm = 140) {
  const words = splitWords(text).filter((w) => normalizeWord(w)).length;
  const seconds = wpm > 0 ? (words / wpm) * 60 : 0;
  return { words, seconds, chars: String(text || '').length };
}

export const PLATFORMS = {
  tiktok: { label: 'TikTok', limit: 4000, tags: ['#tiktok', '#parati', '#fyp'] },
  instagram: { label: 'Instagram Reels', limit: 2200, tags: ['#reels', '#reelsinstagram'] },
  youtube: { label: 'YouTube Shorts', limit: 5000, tags: ['#shorts'] },
  facebook: { label: 'Facebook', limit: 5000, tags: ['#reels', '#video'] },
  linkedin: { label: 'LinkedIn', limit: 3000, tags: [] },
  x: { label: 'X (Twitter)', limit: 280, tags: [] },
};

export const HOOKS = [
  'Nadie te cuenta esto sobre {tema}…',
  'Si eres {audiencia}, deja de hacer esto con {tema}.',
  'El error nº 1 que cometes con {tema} (y cómo evitarlo).',
  '3 cosas que ojalá hubiera sabido antes sobre {tema}.',
  '¿Sabías que el 90 % de la gente hace mal {tema}?',
  'Esto cambió por completo mi forma de ver {tema}.',
  'Te explico {tema} en menos de 60 segundos.',
  'Guarda este video si quieres mejorar en {tema}.',
  'Opinión impopular: {tema} no funciona como crees.',
  'Así es como {audiencia} está perdiendo dinero con {tema}.',
  'Deja de hacer scroll si te importa {tema}.',
  'La forma más fácil de empezar con {tema} hoy mismo.',
  'Lo que aprendí después de 5 años con {tema}.',
  'Mito o realidad: {tema}.',
  'Haz esto antes de volver a intentar {tema}.',
  '¿Por qué nadie habla de esto en {tema}?',
  'El truco de {tema} que uso todos los días.',
  'Si solo pudiera darte un consejo sobre {tema}, sería este.',
  'Esto es lo que diferencia a los mejores en {tema}.',
  'Pruébalo una semana y me cuentas: {tema}.',
  'Tu {tema} no funciona por esta razón.',
  'Estás a un paso de dominar {tema}.',
  '¿Te pasa esto con {tema}? No eres el único.',
  'Cómo pasé de cero a resultados con {tema}.',
  'La verdad incómoda sobre {tema}.',
  'Antes de gastar un euro en {tema}, mira esto.',
  'El método de 3 pasos para {tema}.',
  'Si tienes 30 segundos, te enseño {tema}.',
  'Esto es lo que haría si empezara hoy con {tema}.',
  'Deja que te ahorre meses de prueba y error con {tema}.',
  'Todo el mundo recomienda esto sobre {tema}, y está mal.',
  'Mira hasta el final: el último consejo de {tema} es el mejor.',
  'Pregunta de {audiencia}: ¿cómo empiezo con {tema}?',
  'Si {tema} te parece difícil, mira esto.',
  'La herramienta gratuita que necesitas para {tema}.',
  'Tres señales de que estás haciendo bien {tema}.',
  'No compres nada para {tema} sin ver esto.',
  'Lo que {audiencia} debería saber sobre {tema}.',
  'Un minuto, un consejo: {tema}.',
  'Esto me hubiera gustado que me dijeran sobre {tema}.',
];

// Ganchos pensados para divulgación en psicología y bienestar.
export const PSY_HOOKS = [
  '3 señales de que {tema} te está afectando más de lo que crees.',
  'Lo que tu psicólogo quisiera que supieras sobre {tema}.',
  'Si {tema} te está costando, no es flojera: es tu cerebro intentando protegerte.',
  'Un ejercicio de 60 segundos para cuando {tema} te sobrepasa.',
  'Mito: «{tema} se supera con fuerza de voluntad». Te explico por qué no.',
  '¿Sientes que {tema} te sobrepasa? No estás sola ni solo: le pasa a mucha gente.',
  'Esto que parece normal sobre {tema} en realidad es una señal de alerta.',
  'Cómo explicarle a alguien que quieres qué es {tema}.',
  'La diferencia entre {tema} y algo que necesita atención profesional.',
  'Una pregunta que me hacen mucho en consulta sobre {tema}.',
];

export const DISCLAIMER = 'Este contenido es informativo y no reemplaza una evaluación o terapia profesional.';

export const CTAS = [
  'Sígueme para más consejos como este.',
  'Guarda este video para tenerlo a mano.',
  'Compártelo con alguien que lo necesite.',
  'Escríbeme «INFO» en comentarios y te cuento más.',
  'Cuéntame en comentarios qué te ha parecido.',
  'Visita el enlace de mi perfil para saber más.',
  'Reserva tu llamada gratuita en el enlace de la bio.',
  'Guárdalo para cuando lo necesites y compártelo con alguien que le haga falta.',
  'Si te identificaste, sígueme: hablo de salud mental sin tabúes.',
  'Agenda tu primera sesión en el enlace de mi perfil.',
];

export const TONES = {
  cercano: { label: 'Cercano', open: '¡Hola! ', bridge: 'Mira, ', close: '' },
  profesional: { label: 'Profesional', open: '', bridge: 'En concreto, ', close: '' },
  divertido: { label: 'Divertido', open: 'Ya, confesión: ', bridge: 'Atento, que viene lo bueno: ', close: ' 😉' },
  inspirador: { label: 'Inspirador', open: '', bridge: 'Y recuerda: ', close: ' Tú puedes.' },
};

export const FORMATS = {
  psicoeducacion: 'Psicoeducación (salud mental)',
  consejos: 'Lista de consejos',
  historia: 'Historia personal',
  tutorial: 'Tutorial paso a paso',
  mito: 'Mito vs. realidad',
  errores: 'Errores comunes',
  anuncio: 'Anuncio de producto o servicio',
  opinion: 'Opinión / debate',
  testimonio: 'Caso de éxito / testimonio',
};

export function fillHook(hook, { tema = 'tu tema', audiencia = 'emprendedor' } = {}) {
  return hook.replaceAll('{tema}', tema || 'tu tema').replaceAll('{audiencia}', audiencia || 'emprendedor');
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function hashStr(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

const ORD = ['primero', 'segundo', 'tercero', 'cuarto', 'quinto'];

/**
 * Genera un guion estructurado. Las partes entre [corchetes] son para que las
 * completes con tu experiencia: el generador es local y no inventa datos.
 */
export function generateScript(opts = {}) {
  const tema = (opts.tema || 'tu tema').trim();
  const audiencia = (opts.audiencia || '').trim();
  const beneficio = (opts.beneficio || '').trim();
  const cta = (opts.cta || '').trim() || CTAS[0];
  const tone = TONES[opts.tono] || TONES.cercano;
  const formato = FORMATS[opts.formato] ? opts.formato : 'consejos';
  const dur = Number(opts.duracion) || 45;
  const seed = hashStr(tema + formato + (opts.variant || 0));
  const hook = fillHook(pick(HOOKS, seed), { tema, audiencia: audiencia || 'emprendedor' });
  const para = audiencia ? ` para ${audiencia}` : '';
  const benefit = beneficio || `mejorar en ${tema}`;
  const n = dur <= 20 ? 2 : dur <= 45 ? 3 : dur <= 75 ? 4 : 5;
  const lines = [];
  const b = tone.bridge;
  // Si la entrada del tono acaba en dos puntos, la frase sigue en minúscula («confesión: aquí van…»).
  const o = tone.open;
  const push = (s) =>
    lines.push(o.endsWith(': ') && s.startsWith(o) ? o + s.charAt(o.length).toLowerCase() + s.slice(o.length + 1) : s);

  switch (formato) {
    case 'psicoeducacion': {
      const psyHook = fillHook(pick(PSY_HOOKS, seed), { tema, audiencia: audiencia || 'tú' });
      lines[0] = psyHook;
      push(`${tone.open}Hablemos de ${tema}${para}: es más común de lo que parece.`);
      push(`Qué es: [explicación simple, sin tecnicismos].`);
      push(`Cómo se nota en el día a día: [ejemplo concreto y cercano].`);
      if (n >= 3) push(`Por qué pasa: [causa o mecanismo, en una frase].`);
      push(`Algo que puedes hacer hoy: [herramienta práctica y segura].`);
      if (n >= 4) push(`Cuándo pedir ayuda: [señal de que conviene consultar a un profesional].`);
      push(DISCLAIMER);
      break;
    }
    case 'historia':
      push(hook);
      push(`${tone.open}Hace un tiempo me pasó algo con ${tema} que no olvidaré: [describe la situación en una frase].`);
      push(`El problema era que [explica el obstáculo o el error que cometías].`);
      push(`Hasta que descubrí esto: [el cambio o la idea clave].`);
      if (n >= 3) push(`¿El resultado? [resultado concreto, con un número si puedes].`);
      if (n >= 4) push(`Lo que más me sorprendió fue [detalle inesperado].`);
      push(`${b}si tú también quieres ${benefit}, empieza por [primer paso sencillo].`);
      break;
    case 'tutorial':
      push(hook);
      push(`${tone.open}Hoy te enseño a ${benefit}${para} en ${n} pasos.`);
      for (let i = 0; i < n; i++) push(`Paso ${i + 1}: [acción concreta ${i + 1}].`);
      push(`${b}así de fácil. Pruébalo y cuéntame cómo te va.`);
      break;
    case 'mito':
      push(hook);
      for (let i = 0; i < Math.min(n, 3); i++) {
        push(`Mito ${i + 1}: «[creencia falsa sobre ${tema}]».`);
        push(`Realidad: [lo que de verdad funciona y por qué].`);
      }
      push(`${b}la clave para ${benefit} es [idea principal].`);
      break;
    case 'errores':
      push(hook);
      push(`${tone.open}Estos son ${n} errores que veo constantemente en ${tema}${para}.`);
      for (let i = 0; i < n; i++) push(`Error ${i + 1}: [error]. En su lugar, [qué hacer].`);
      push(`${b}evita estos errores y verás cómo empiezas a ${benefit}.`);
      break;
    case 'anuncio':
      push(hook);
      push(`${tone.open}Si eres ${audiencia || '[tu cliente ideal]'} y te cuesta [problema principal], esto es para ti.`);
      push(`Te presento [nombre del producto o servicio]: te ayuda a ${benefit}.`);
      for (let i = 0; i < Math.min(n, 3); i++) push(`Beneficio ${i + 1}: [beneficio concreto].`);
      push(`[Oferta, precio o garantía, si aplica].`);
      break;
    case 'opinion':
      push(hook);
      push(`${tone.open}Voy a decir algo que no le va a gustar a todo el mundo sobre ${tema}: [tu opinión].`);
      push(`¿Por qué lo pienso? Porque [argumento 1].`);
      if (n >= 3) push(`Además, [argumento 2 o dato].`);
      push(`${b}no digo que [postura contraria] esté mal, pero para ${benefit} yo haría [tu recomendación].`);
      push(`¿Estás de acuerdo? Te leo en comentarios.`);
      break;
    case 'testimonio':
      push(hook);
      push(`${tone.open}[Nombre del cliente] llegó con este problema: [situación inicial].`);
      push(`Trabajamos juntos en [lo que hicisteis con ${tema}].`);
      push(`En [tiempo], consiguió [resultado medible].`);
      push(`${b}si quieres ${benefit}${para}, podemos hacer lo mismo contigo.`);
      break;
    default:
      push(hook);
      push(`${tone.open}Aquí van ${n} consejos para ${benefit}${para}.`);
      for (let i = 0; i < n; i++) push(`${cap(ORD[i])}: [consejo ${i + 1} sobre ${tema}, en una frase].`);
      push(`${b}aplica aunque sea uno hoy mismo.`);
  }
  lines.push(cta + (tone.close || ''));
  return lines.join('\n\n');
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const TEMPLATES = [
  {
    id: 'psi-senales',
    name: 'Psicología: señales de alerta',
    text: '3 señales de que [tema] te está afectando más de lo que crees.\n\nUna: [señal concreta, con un ejemplo cotidiano].\n\nDos: [señal].\n\nTres: [señal].\n\nSi te identificaste con dos o más, no significa que algo ande mal contigo: significa que mereces apoyo.\n\nEste contenido es informativo y no reemplaza una evaluación profesional. Guárdalo y compártelo con alguien que lo necesite.',
  },
  {
    id: 'psi-mito',
    name: 'Psicología: mito vs. realidad',
    text: 'Mito: «[creencia común sobre salud mental]».\n\nRealidad: [lo que dice la evidencia, en palabras simples].\n\n¿Por qué importa? Porque [consecuencia de creer el mito].\n\nLo que sí puedes hacer: [recomendación práctica].\n\nSígueme para más contenido de salud mental sin tabúes.',
  },
  {
    id: 'psi-tecnica',
    name: 'Psicología: técnica en 60 segundos',
    text: 'Si [situación difícil], prueba esto ahora mismo.\n\nPaso uno: [instrucción clara, por ejemplo respirar 4 segundos].\n\nPaso dos: [instrucción].\n\nPaso tres: [instrucción].\n\n¿Por qué funciona? [explicación breve].\n\nGuárdalo para cuando lo necesites.',
  },
  {
    id: 'psi-consulta',
    name: 'Psicología: pregunta de consulta',
    text: 'Una pregunta que me hacen mucho en consulta: «[pregunta]».\n\nMi respuesta corta: [respuesta].\n\nY la larga: [matiz o ejemplo, sin datos personales de pacientes].\n\n¿Tienes otra pregunta? Déjala en los comentarios y la respondo en un video.',
  },
  {
    id: 'psi-terapia',
    name: 'Psicología: desmitificar la terapia',
    text: 'Ir al psicólogo no es solo para «cuando estás muy mal».\n\n[Beneficio 1 de la terapia].\n\n[Beneficio 2].\n\n[Qué pasa en una primera sesión, para bajar la ansiedad].\n\nSi estás pensando en empezar, [llamada a la acción: agenda, escríbeme, link en la bio].',
  },
  {
    id: 'gancho-valor-cta',
    name: 'Gancho → Valor → Llamada a la acción',
    text: '[Gancho: una frase que detenga el scroll]\n\n[Presenta el problema en una frase]\n\n[Tu solución o idea principal]\n\n[Ejemplo o dato que lo demuestre]\n\n[Llamada a la acción: sígueme, guarda, comenta…]',
  },
  {
    id: 'pas',
    name: 'Problema → Agitación → Solución',
    text: '¿Te pasa que [problema]?\n\nY lo peor es que [consecuencia que duele].\n\nLa solución es más simple de lo que crees: [solución].\n\n[Llamada a la acción]',
  },
  {
    id: 'tres-consejos',
    name: '3 consejos rápidos',
    text: '3 consejos para [objetivo] que puedes aplicar hoy.\n\nUno: [consejo].\n\nDos: [consejo].\n\nTres: [consejo].\n\n¿Cuál vas a probar primero? Cuéntamelo en comentarios.',
  },
  {
    id: 'antes-despues',
    name: 'Antes / Después',
    text: 'Antes: [situación inicial].\n\nDespués: [resultado].\n\n¿Qué cambió? [la clave].\n\nSi quieres lo mismo, [llamada a la acción].',
  },
  {
    id: 'presentacion',
    name: 'Preséntate (vídeo de bienvenida)',
    text: 'Hola, soy [nombre] y ayudo a [audiencia] a [resultado].\n\nLlevo [tiempo] trabajando en [área] y he visto que [problema común].\n\nEn esta cuenta vas a encontrar [tipo de contenido].\n\nSi te interesa [tema], sígueme.',
  },
  {
    id: 'noticia',
    name: 'Noticia o novedad',
    text: 'Última hora sobre [tema]: [la novedad].\n\n¿Qué significa para ti? [impacto].\n\nMi recomendación: [qué hacer ahora].\n\nSígueme para estar al día.',
  },
  {
    id: 'faq',
    name: 'Respondo una pregunta',
    text: 'Me preguntáis mucho: «[pregunta]».\n\nRespuesta corta: [respuesta en una frase].\n\nRespuesta larga: [explicación con ejemplo].\n\n¿Tienes otra pregunta? Déjala en comentarios.',
  },
  {
    id: 'lanzamiento',
    name: 'Lanzamiento / oferta',
    text: 'Por fin puedo contarlo: [lanzamiento].\n\nEs para [audiencia] que quiere [resultado].\n\nIncluye [beneficio 1], [beneficio 2] y [beneficio 3].\n\n[Oferta y fecha límite].\n\nEnlace en la bio.',
  },
];

const STOP = new Set(
  (
    'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era eres es esa esas ese eso esos esta estas este esto estos estoy fue ha han has hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otro para pero poco por porque que quien se sea ser si sin sobre solo son su sus tambien te tener tengo ti tiene tu tus un una uno unos y ya yo vez hoy aqui esto tanto cosas cosa hacer puedes puede quieres quiero voy vas va mas menos bien mejor dia dias todo todos toda todas'
  ).split(' ')
);

export function suggestHashtags(text, max = 8) {
  const counts = new Map();
  for (const raw of splitWords(text)) {
    const w = normalizeWord(raw);
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1 + w.length / 20);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => '#' + w);
}

export function generatePost({ tema = '', texto = '', plataforma = 'instagram', cta = '' } = {}) {
  const p = PLATFORMS[plataforma] || PLATFORMS.instagram;
  const sentences = String(texto)
    .replace(/\[[^\]]*\]/g, '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const hook = sentences[0] || (tema ? `Todo sobre ${tema} en un minuto.` : 'Mira esto 👇');
  const body = sentences.slice(1, plataforma === 'x' ? 1 : 4);
  const tags = [...new Set([...suggestHashtags(`${tema} ${tema} ${texto}`, plataforma === 'x' ? 2 : 6), ...p.tags])];
  const parts = [hook];
  if (body.length) parts.push(body.map((s) => `✅ ${s}`).join('\n'));
  parts.push(cta || CTAS[1]);
  if (tags.length) parts.push(tags.join(' '));
  let out = parts.join('\n\n');
  if (out.length > p.limit) out = out.slice(0, p.limit - 1) + '…';
  return out;
}
