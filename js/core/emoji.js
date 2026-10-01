// Emojis automáticos para subtítulos (diccionario local, enfocado en bienestar y redes).
const MAP = [
  [/^ansi(edad|os[oa]s?)$/, '😰'], [/^estr[eé]s(ad[oa]s?)?$/, '😣'], [/^(miedo|temor|p[aá]nico)s?$/, '😨'],
  [/^(triste(za)?|pena|depresi[oó]n)$/, '😔'], [/^(feliz|felicidad|alegr[ií]a|contento|contenta)$/, '😊'],
  [/^(rabia|enojo|ira|enojad[oa])$/, '😤'], [/^(calma|tranquil(o|a|idad)|paz|relaj(o|arte|aci[oó]n))$/, '🧘'],
  [/^(respir(a|ar|aci[oó]n)|aire)$/, '🌬️'], [/^(cerebro|mente|mental(es)?|pensamientos?)$/, '🧠'],
  [/^(dormir|sue[nñ]o|descanso|insomnio)$/, '😴'], [/^(amor|pareja|coraz[oó]n|quererte|amar)$/, '❤️'],
  [/^(familia|hij[oa]s|mam[aá]|pap[aá])$/, '👨‍👩‍👧'], [/^(amig[oa]s?|amistad)$/, '🤝'],
  [/^(trabajo|pega|oficina|jefe)$/, '💼'], [/^(plata|dinero|sueldo|lucas)$/, '💰'],
  [/^(terapia|psic[oó]log[oa]s?|consulta)$/, '🛋️'], [/^(ayuda|apoyo)$/, '🤗'],
  [/^(idea|consejo|tip|truco)s?$/, '💡'], [/^(importante|ojo|cuidado|alerta)$/, '⚠️'],
  [/^(error|errores|mito|mitos|falso)$/, '❌'], [/^(verdad|correcto|realidad|bien)$/, '✅'],
  [/^(tiempo|minutos?|segundos?|hora)$/, '⏰'], [/^(ejercicio|deporte|caminar|moverte)$/, '🏃'],
  [/^(comida|comer|alimentaci[oó]n)$/, '🍎'], [/^(agua|hidrat(ar|arte))$/, '💧'],
  [/^(celular|redes|instagram|tiktok|pantalla)$/, '📱'], [/^(crecer|crecimiento|cambio|avanzar)$/, '🌱'],
  [/^(meta|objetivo|logro|lograr)s?$/, '🎯'], [/^(energ[ií]a|fuerza|motivaci[oó]n)$/, '⚡'],
  [/^(llorar|l[aá]grimas)$/, '😢'], [/^(risa|re[ií]r)$/, '😂'], [/^(sol|ma[nñ]ana|d[ií]a)$/, '☀️'],
  [/^(noche)$/, '🌙'], [/^(libro|leer|lectura)$/, '📚'], [/^(escuchar|m[uú]sica)$/, '🎧'],
  [/^(hablar|conversar|comunicaci[oó]n)$/, '💬'], [/^(l[ií]mites?)$/, '🚧'], [/^(autoestima|confianza)$/, '💪'],
];

const norm = (w) => String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ0-9]/g, '');

export function emojiFor(word) {
  const n = norm(word);
  if (n.length < 2) return null;
  for (const [re, e] of MAP) if (re.test(n) || re.test(String(word).toLowerCase().replace(/[^a-záéíóúñü]/g, ''))) return e;
  return null;
}

/**
 * Asigna como máximo un emoji cada `every` frases (para no saturar).
 * words: [{text,...}] con índices de grupos (de groupWords). Devuelve un Map índice→emoji.
 */
export function autoEmojis(words, groups, every = 2) {
  const out = new Map();
  let last = -every;
  groups.forEach((g, gi) => {
    if (gi - last < every) return;
    for (const i of g.idx) {
      const e = emojiFor(words[i].text);
      if (e) {
        out.set(g.idx[g.idx.length - 1], e);
        last = gi;
        break;
      }
    }
  });
  return out;
}
