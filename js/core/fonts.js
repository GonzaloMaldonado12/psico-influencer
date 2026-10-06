// Banco de fuentes libres (OFL) para títulos, textos y subtítulos. Solo en el PC: en el iPhone se usan las del sistema.
import { FONTS } from './captions.js';
import { IS_MOBILE } from '../lib/util.js';

// id → [nombre visible, familia CSS, peso, categoría]
const BANK = {
  anton: ['Anton', 'Anton', 400, 'Impacto'],
  bebas: ['Bebas Neue', 'Bebas Neue', 400, 'Impacto'],
  oswald: ['Oswald', 'Oswald', 700, 'Impacto'],
  archivo: ['Archivo Black', 'Archivo Black', 400, 'Impacto'],
  russo: ['Russo One', 'Russo One', 400, 'Impacto'],
  teko: ['Teko', 'Teko', 600, 'Impacto'],
  montserrat: ['Montserrat', 'Montserrat', 800, 'Limpia'],
  poppins: ['Poppins', 'Poppins', 700, 'Limpia'],
  inter: ['Inter', 'Inter', 800, 'Limpia'],
  fredoka: ['Fredoka', 'Fredoka', 600, 'Redonda'],
  righteous: ['Righteous', 'Righteous', 400, 'Redonda'],
  bangers: ['Bangers', 'Bangers', 400, 'Cómic'],
  marker: ['Marcador', 'Permanent Marker', 400, 'Cómic'],
  playfair: ['Playfair', 'Playfair Display', 800, 'Elegante'],
  lobster: ['Lobster', 'Lobster', 400, 'Manuscrita'],
  pacifico: ['Pacífico', 'Pacifico', 400, 'Manuscrita'],
  caveat: ['Caveat', 'Caveat', 700, 'Manuscrita'],
  dancing: ['Dancing Script', 'Dancing Script', 700, 'Manuscrita'],
};

export const FONT_BANK = Object.fromEntries(Object.entries(BANK).map(([k, [label, family, weight, cat]]) => [k, { label, family, weight, cat }]));

// Se registran junto a las fuentes del sistema para que render.js y los paneles las usen igual.
if (!IS_MOBILE) {
  for (const [k, f] of Object.entries(FONT_BANK)) FONTS[k] = { label: f.label, family: `"${f.family}", Impact, sans-serif`, weight: f.weight, cat: f.cat, bank: true };
}

const loading = new Map();
/** Carga una fuente del banco (no hace nada con las del sistema). */
export function loadFont(key) {
  const f = FONT_BANK[key];
  if (!f || IS_MOBILE || typeof FontFace === 'undefined') return Promise.resolve(false);
  if (!loading.has(key)) {
    const url = new URL(`../../vendor/fonts/${key}.woff2`, import.meta.url).href;
    const ff = new FontFace(f.family, `url(${url}) format("woff2")`, { weight: String(f.weight) });
    loading.set(key, ff.load().then((x) => (document.fonts.add(x), true)).catch(() => false));
  }
  return loading.get(key);
}

/** Carga todas las fuentes del banco que usa el proyecto (subtítulos, título, capas de texto). */
export async function loadProjectFonts(project) {
  const keys = new Set([project.captions?.style?.font, project.headline?.font, project.title_font]);
  for (const o of project.overlays || []) if (o.font) keys.add(o.font);
  await Promise.all([...keys].filter((k) => FONT_BANK[k]).map(loadFont));
}

export async function loadAllFonts() {
  await Promise.all(Object.keys(FONT_BANK).map(loadFont));
}

/** Lista [clave, etiqueta, categoría] para los selectores. */
export function fontOptions() {
  return Object.entries(FONTS).map(([k, f]) => [k, f.label, f.cat || 'Sistema']);
}
