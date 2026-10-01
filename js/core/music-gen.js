// Música original generada en el dispositivo (sin derechos de autor): acordes, bajo,
// batería y ambiente sintetizados con Web Audio y renderizados sin conexión a WAV.

export const MUSIC_STYLES = {
  calma: { label: 'Calma', desc: 'Ambiente suave para temas de bienestar', bpm: 68, prog: ['Cmaj7', 'Am7', 'Fmaj7', 'G6'], layers: ['pad', 'bell', 'sub'] },
  lofi: { label: 'Lo-fi', desc: 'Relajado, con ritmo tranquilo', bpm: 80, prog: ['Dm9', 'G7', 'Cmaj7', 'Am7'], layers: ['keys', 'lofiDrums', 'bass', 'crackle'] },
  inspirador: { label: 'Inspirador', desc: 'Piano y cuerdas que crecen', bpm: 92, prog: ['C', 'G', 'Am', 'F'], layers: ['piano', 'pad', 'softKick', 'bass'] },
  positivo: { label: 'Positivo', desc: 'Alegre y profesional', bpm: 112, prog: ['F', 'C', 'Dm', 'Bb'], layers: ['pluck', 'popDrums', 'bass', 'pad'] },
  emotivo: { label: 'Emotivo', desc: 'Piano íntimo para historias', bpm: 62, prog: ['Am', 'F', 'C', 'G'], layers: ['piano', 'pad'] },
  energia: { label: 'Energía', desc: 'Ritmo marcado para consejos rápidos', bpm: 124, prog: ['Am', 'F', 'C', 'G'], layers: ['pluck', 'fourDrums', 'bass', 'pad'] },
};

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Acorde → semitonos (desde C4 = 60). */
export function chordNotes(name, octave = 4) {
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(name);
  const root = 12 * (octave + 1) + NOTE[m[1]];
  const q = m[2];
  let iv = [0, 4, 7];
  if (q.startsWith('m') && !q.startsWith('maj')) iv = [0, 3, 7];
  if (q.includes('maj7')) iv = [0, 4, 7, 11];
  else if (q === 'm7' || q === 'm9') iv = [0, 3, 7, 10];
  else if (q === '7') iv = [0, 4, 7, 10];
  else if (q === '6') iv = [0, 4, 7, 9];
  if (q.endsWith('9')) iv = [...iv, 14];
  return { root, notes: iv.map((i) => root + i) };
}

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function noiseBuffer(ctx, secs, rand) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return b;
}

function reverbImpulse(ctx, secs, decay, rand) {
  const len = Math.ceil(ctx.sampleRate * secs);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * (1 - i / len) ** decay;
  }
  return b;
}

/** Genera la pista. Devuelve un AudioBuffer estéreo. */
export async function generateMusic(styleKey = 'calma', { seconds = 60, variant = 0, sampleRate = 44100 } = {}) {
  const st = MUSIC_STYLES[styleKey] || MUSIC_STYLES.calma;
  const rand = rng(1234 + variant * 7919 + styleKey.length * 131);
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const beat = 60 / st.bpm;
  const bar = beat * 4;
  const bars = Math.max(4, Math.ceil(seconds / bar / 4) * 4);
  const total = bars * bar + 2.5;
  const ctx = new Ctx(2, Math.ceil(total * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  master.connect(comp);
  comp.connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = reverbImpulse(ctx, 2.8, 2.5, rand);
  const verbGain = ctx.createGain();
  verbGain.gain.value = styleKey === 'calma' || styleKey === 'emotivo' ? 0.45 : 0.25;
  verb.connect(verbGain);
  verbGain.connect(master);
  const bus = ctx.createGain();
  bus.connect(master);
  bus.connect(verb);
  if (styleKey === 'lofi') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    bus.disconnect();
    bus.connect(lp);
    lp.connect(master);
    lp.connect(verb);
  }
  const noise = noiseBuffer(ctx, 1, rand);

  const tone = (type, f, t, dur, vol, { attack = 0.01, release = 0.3, cutoff = 0, detune = 0, dest = bus } = {}) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    let node = o;
    if (cutoff) {
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = cutoff;
      o.connect(f2);
      node = f2;
    }
    node.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const pluckNote = (type, f, t, vol, decay, cutoff = 2400) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff / 6), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + decay + 0.05);
  };
  const noiseHit = (t, dur, vol, type, fq, q = 1) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = fq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t, rand() * 0.5);
    s.stop(t + dur + 0.02);
  };
  const kick = (t, vol = 0.9) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.4);
  };
  const snare = (t, vol = 0.35) => {
    noiseHit(t, 0.18, vol, 'bandpass', 1800, 0.8);
    tone('triangle', 190, t, 0.1, vol * 0.4, { attack: 0.002, release: 0.08, dest: master });
  };
  const hat = (t, vol = 0.08) => noiseHit(t, 0.05, vol, 'highpass', 7000);

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const chord = chordNotes(st.prog[b % st.prog.length]);
    const section = Math.floor(b / 4); // intensidad crece por secciones
    const intensity = Math.min(1, 0.55 + section * 0.15);
    for (const layer of st.layers) {
      if (layer === 'pad') {
        for (const n of chord.notes) {
          for (const d of [-7, 7]) tone('sawtooth', freq(n), t0, bar + 0.4, 0.028 * intensity, { attack: bar * 0.3, release: bar * 0.35, cutoff: 1100, detune: d });
        }
      } else if (layer === 'sub') {
        tone('sine', freq(chord.root - 24), t0, bar, 0.12, { attack: 0.3, release: 0.4 });
      } else if (layer === 'bell') {
        if (rand() < 0.7) {
          const n = chord.notes[Math.floor(rand() * chord.notes.length)] + 12;
          const t = t0 + beat * Math.floor(rand() * 4);
          pluckNote('sine', freq(n), t, 0.08, 2.2, 6000);
          pluckNote('sine', freq(n) * 2.76, t, 0.015, 1.2, 8000);
        }
      } else if (layer === 'keys' || layer === 'piano') {
        const steps = layer === 'piano' ? [0, 1.5, 2, 3] : [0, 2.5];
        steps.forEach((s, i) => {
          const notes = layer === 'piano' && i > 0 ? [chord.notes[(i + b) % chord.notes.length] + 12] : chord.notes;
          for (const n of notes) {
            pluckNote('triangle', freq(n), t0 + s * beat, (layer === 'piano' ? 0.12 : 0.08) * intensity, layer === 'piano' ? 2.4 : 1.6, 3000);
            pluckNote('sine', freq(n) * 2, t0 + s * beat, 0.03 * intensity, 1.2, 5000);
          }
        });
      } else if (layer === 'pluck') {
        for (let s = 0; s < 8; s++) {
          const n = chord.notes[(s + (s > 3 ? 1 : 0)) % chord.notes.length] + 12;
          pluckNote('square', freq(n), t0 + s * (beat / 2), 0.045 * intensity, 0.35, 2600);
        }
      } else if (layer === 'bass') {
        const pat = styleKey === 'lofi' ? [0, 2.5] : [0, 1, 2, 3];
        pat.forEach((s) => tone('triangle', freq(chord.root - 24), t0 + s * beat, beat * 0.9, 0.2 * intensity, { attack: 0.01, release: 0.1, cutoff: 700 }));
      } else if (layer === 'softKick' && section > 0) {
        kick(t0, 0.5);
        kick(t0 + 2 * beat, 0.4);
      } else if (layer === 'lofiDrums') {
        const sw = beat * 0.08; // swing
        kick(t0, 0.55);
        kick(t0 + 2.5 * beat, 0.45);
        snare(t0 + beat, 0.22);
        snare(t0 + 3 * beat, 0.22);
        for (let s = 0; s < 8; s++) hat(t0 + s * (beat / 2) + (s % 2 ? sw : 0), 0.05);
      } else if (layer === 'popDrums' || layer === 'fourDrums') {
        if (section === 0 && layer === 'popDrums') continue;
        for (let s = 0; s < 4; s++) if (layer === 'fourDrums' || s % 2 === 0) kick(t0 + s * beat, 0.7);
        snare(t0 + beat, 0.3);
        snare(t0 + 3 * beat, 0.3);
        for (let s = 0; s < 8; s++) hat(t0 + s * (beat / 2), s % 2 ? 0.06 : 0.035);
      } else if (layer === 'crackle' && b === 0) {
        const s = ctx.createBufferSource();
        s.buffer = noiseBuffer(ctx, 2, rand);
        s.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 3000;
        const g = ctx.createGain();
        g.gain.value = 0.012;
        s.connect(f);
        f.connect(g);
        g.connect(master);
        s.start(0);
        s.stop(total);
      }
    }
  }
  // Acorde final para que termine limpio.
  const end = bars * bar;
  const last = chordNotes(st.prog[0]);
  for (const n of last.notes) tone('sine', freq(n), end, 2.4, 0.06, { attack: 0.02, release: 2 });
  master.gain.setValueAtTime(0.9, end);
  master.gain.linearRampToValueAtTime(0, total);
  return ctx.startRendering();
}

/** AudioBuffer → WAV 16 bits (Blob). */
export function toWav(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + len * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let p = 44;
  let peak = 0;
  for (const d of data) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      out.setInt16(p, Math.max(-1, Math.min(1, data[c][i] * g)) * 32767, true);
      p += 2;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
