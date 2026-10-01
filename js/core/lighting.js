// Análisis de iluminación (puro): recibe píxeles RGBA y la caja del rostro y devuelve
// métricas, una nota de 0 a 100 y recomendaciones concretas en español de Chile.

const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function regionStats(data, W, H, box) {
  const x0 = Math.max(0, Math.floor(box.x * W));
  const y0 = Math.max(0, Math.floor(box.y * H));
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * W));
  const y1 = Math.min(H, Math.ceil((box.y + box.h) * H));
  let n = 0;
  let L = 0;
  let R = 0;
  let G = 0;
  let B = 0;
  let left = 0;
  let right = 0;
  let nl = 0;
  let nr = 0;
  const mid = (x0 + x1) / 2;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      L += l;
      R += data[i];
      G += data[i + 1];
      B += data[i + 2];
      n++;
      if (x < mid) {
        left += l;
        nl++;
      } else {
        right += l;
        nr++;
      }
    }
  }
  if (!n) return null;
  return { luma: L / n, r: R / n, g: G / n, b: B / n, left: nl ? left / nl : 0, right: nr ? right / nr : 0 };
}

/**
 * data: RGBA (Uint8ClampedArray) de W×H; face: caja normalizada {x,y,w,h} o null.
 */
export function analyzeLighting(data, W, H, face) {
  const all = regionStats(data, W, H, { x: 0, y: 0, w: 1, h: 1 });
  let clipped = 0;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = luma(data[i], data[i + 1], data[i + 2]);
    if (l > 0.97) clipped++;
    if (l < 0.04) dark++;
  }
  const px = data.length / 4;
  const m = {
    face: !!face,
    faceLuma: null,
    bgLuma: all.luma,
    clipped: clipped / px,
    crushed: dark / px,
    warmth: (all.r - all.b) / 255,
    tintG: (all.g - (all.r + all.b) / 2) / 255,
    sideDiff: 0,
  };
  if (face) {
    const f = regionStats(data, W, H, face);
    if (f) {
      m.faceLuma = f.luma;
      m.sideDiff = Math.abs(f.left - f.right);
      m.warmth = (f.r - f.b) / 255;
      // Fondo: promedio del cuadro sin el rostro (aproximado con la media global).
      const faceFrac = Math.min(0.9, face.w * face.h);
      m.bgLuma = (all.luma - f.luma * faceFrac) / (1 - faceFrac);
    }
  }
  const tips = [];
  let score = 100;
  const add = (pen, level, text) => {
    score -= pen;
    tips.push({ level, text });
  };
  if (!face) add(35, 'warn', 'No se detecta tu cara: céntrate en la guía y mira a la cámara.');
  const fl = m.faceLuma ?? m.bgLuma;
  if (fl < 0.3) add(30, 'bad', 'Tu cara se ve oscura: ponte frente a una ventana o una luz, un poco sobre la altura de tus ojos.');
  else if (fl < 0.42) add(15, 'warn', 'Falta un poco de luz en tu cara: acércate a la fuente de luz o súbele la intensidad.');
  if (fl > 0.82 || m.clipped > 0.04) add(20, 'bad', 'Hay zonas quemadas por exceso de luz: aléjate de la lámpara o suaviza la luz con una tela o papel blanco.');
  if (face && m.bgLuma - fl > 0.12) add(25, 'bad', 'Estás a contraluz: no te pongas de espaldas a la ventana; gira para que la luz te dé de frente.');
  if (face && m.sideDiff > 0.18) add(12, 'warn', 'Un lado de tu cara queda en sombra: agrega luz de relleno o un cartón blanco que rebote la luz desde ese lado.');
  if (m.warmth > 0.22) add(10, 'warn', 'La luz es muy amarilla (cálida). Usa luz de día o ampolletas neutras/frías de 5000–5600 K.');
  else if (m.warmth < -0.08) add(10, 'warn', 'La luz es muy azulada (fría). Mezcla con una luz más cálida o usa ampolletas de 4000–5000 K.');
  if (m.tintG > 0.08) add(6, 'warn', 'La imagen tira a verde (típico de tubos fluorescentes): cambia a LED de buena calidad.');
  if (face && fl >= 0.42 && fl <= 0.82 && m.bgLuma < fl - 0.35) add(5, 'info', 'Buen rostro, pero el fondo está muy oscuro: una lámpara cálida atrás da profundidad y un aire acogedor.');
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!tips.length) tips.push({ level: 'ok', text: '¡Iluminación correcta! Tu cara está bien expuesta y pareja.' });
  return { score, tips, metrics: m };
}

/** Ajustes de color automáticos a partir de las métricas (para «Mejorar iluminación IA»). */
export function autoGrade(metrics) {
  const fl = metrics.faceLuma ?? metrics.bgLuma;
  const target = 0.56;
  const exposure = Math.max(-0.8, Math.min(1.1, Math.log2(target / Math.max(0.05, fl)) * 0.85));
  const temp = Math.max(-0.6, Math.min(0.6, -(metrics.warmth - 0.06) * 2.2));
  const tint = Math.max(-0.5, Math.min(0.5, -metrics.tintG * 4));
  const faceBoost = metrics.face && metrics.bgLuma - fl > 0.05 ? Math.min(0.45, (metrics.bgLuma - fl) * 1.8) : metrics.face && fl < 0.45 ? 0.15 : 0;
  return {
    exposure: Math.round(exposure * 100) / 100,
    contrast: fl < 0.35 ? 1.02 : 1.06,
    saturation: 1.06,
    temp: Math.round(temp * 100) / 100,
    tint: Math.round(tint * 100) / 100,
    faceBoost: Math.round(faceBoost * 100) / 100,
    vignette: 0.12,
  };
}

export const LIGHTING_GUIDE = [
  {
    title: 'Ventana (gratis y la mejor)',
    level: 'Básico',
    steps: [
      'Ponte de frente a una ventana, a 1–2 metros, con la cámara entre tú y la ventana.',
      'Nunca de espaldas a la ventana (contraluz).',
      'Si el sol entra directo, cubre la ventana con una cortina blanca delgada para suavizar.',
      'Graba a la misma hora para que tus videos se vean parejos.',
    ],
  },
  {
    title: 'Aro de luz (ring light)',
    level: 'Básico',
    steps: [
      'Colócalo a la altura de tus ojos o un poco más arriba, a 50–100 cm.',
      'Usa temperatura neutra (5000–5600 K) y potencia media para evitar brillos.',
      'Pon el celular en el centro del aro: el reflejo en los ojos se ve natural.',
      'Si usas lentes, sube el aro y gíralo levemente para evitar reflejos.',
    ],
  },
  {
    title: 'Dos luces (principal + relleno)',
    level: 'Intermedio',
    steps: [
      'Luz principal a 45° de un lado y un poco sobre tu cabeza, apuntando a tu cara.',
      'Luz de relleno al otro lado con la mitad de intensidad (o un reflector blanco).',
      'Ambas con difusor (softbox o paraguas) para una luz suave y profesional.',
    ],
  },
  {
    title: 'Tres puntos (look de estudio)',
    level: 'Profesional',
    steps: [
      'Principal y relleno como en el esquema de dos luces.',
      'Contraluz suave detrás y arriba de ti para separar tu silueta del fondo.',
      'Opcional: una lámpara cálida en el fondo (biblioteca, planta) crea un ambiente acogedor, ideal para contenido de psicología.',
    ],
  },
  {
    title: 'Fondo y cámara',
    level: 'Consejos',
    steps: [
      'Sepárate 1–2 metros del fondo para que se vea con profundidad.',
      'Lente a la altura de los ojos; encuadra desde el pecho hacia arriba.',
      'Limpia el lente antes de grabar y graba en 1080p a 30 fps.',
      'Evita mezclar luces de distinto color (ampolleta amarilla + ventana).',
    ],
  },
];
