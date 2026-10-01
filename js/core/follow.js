// Seguimiento por voz del teleprompter: ubica lo que dices dentro del guion.
import { normalizeWord, splitWords } from '../lib/util.js';

function lev1(a, b) {
  // ¿distancia de edición <= 1?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
  return a.length >= 3 && b.length >= 3 && lev1(a, b);
}

export class ScriptFollower {
  constructor(text) {
    this.tokens = splitWords(text).map(normalizeWord);
    this.pos = 0; // índice de la próxima palabra por leer
  }

  reset(pos = 0) {
    this.pos = pos;
  }

  /** Recibe la transcripción reciente y devuelve la nueva posición. */
  update(spokenText) {
    const spoken = splitWords(spokenText).map(normalizeWord).filter(Boolean).slice(-6);
    const n = this.tokens.length;
    if (!spoken.length || !n) return this.pos;
    const m = spoken.length;
    let best = -1;
    let bestScore = 0;
    const from = Math.max(0, this.pos - 3);
    const to = Math.min(n - 1, this.pos + 30);
    for (let end = from; end <= to; end++) {
      let score = 0;
      for (let k = 0; k < m; k++) {
        const j = end - (m - 1 - k);
        if (j < 0) continue;
        if (similar(this.tokens[j], spoken[k])) score += k === m - 1 ? 1.5 : 1;
      }
      score -= Math.max(0, end - this.pos) * 0.03;
      if (score > bestScore) {
        bestScore = score;
        best = end;
      }
    }
    const needed = m >= 3 ? 2 : 1.4;
    if (best >= 0 && bestScore >= needed && best + 1 > this.pos) this.pos = best + 1;
    return this.pos;
  }
}
