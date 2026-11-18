/**
 * Moteur sonore entièrement procédural (Web Audio API uniquement, aucun fichier audio).
 *
 * Palette volontairement sèche, courte et un peu « lo-fi » : salves de bruit filtré et petits
 * coups tonaux, chaque déclenchement étant légèrement désaccordé (±10 %) pour ne jamais sonner
 * mécanique.
 *
 * Chaîne : voix → master (GainNode) → passe-bas « sous l'eau » (ouvert à 20 kHz hors de l'eau) → sortie.
 * Tant que `resume()` n'a pas abouti (geste utilisateur), toutes les méthodes sont silencieuses
 * et ne lèvent jamais d'exception ; musique, pluie et état « sous l'eau » sont simplement mémorisés.
 */

/** Familles de sons de blocs (même type que SoundGroup dans src/world/Blocks.ts). */
export type SoundGroup = 'stone' | 'wood' | 'grass' | 'gravel' | 'sand' | 'cloth' | 'glass' | 'snow' | 'metal';

export type SfxName =
  | 'click' | 'pop' | 'hurt' | 'death' | 'eat' | 'burp' | 'drink' | 'explode' | 'fuse' | 'bow' | 'arrow_hit'
  | 'splash' | 'swim' | 'door_open' | 'door_close' | 'chest_open' | 'chest_close' | 'fall_small' | 'fall_big'
  | 'tool_break' | 'levelup' | 'fizz' | 'fire' | 'ignite' | 'attack' | 'attack_crit' | 'attack_miss' | 'bucket_fill' | 'bucket_empty'
  | 'pig' | 'cow' | 'sheep' | 'chicken' | 'zombie' | 'skeleton' | 'spider' | 'creeper_hurt' | 'mob_hurt' | 'egg' | 'shear' | 'thunder' | 'orb'
  | 'note_piano' | 'note_grosse_caisse' | 'note_basse' | 'note_flute' | 'note_clochette' | 'note_cloche' | 'note_guitare';

export interface SfxOptions {
  volume?: number;
  pitch?: number;
  /** panoramique -1 (gauche) .. 1 (droite) */
  pan?: number;
}

type BlockKind = 'break' | 'place' | 'hit' | 'step';

/** Options facultatives d'une couche sonore (bruit ou oscillateur). */
interface Extra {
  /** Temps de montée en secondes. */
  attack?: number;
  /** Durée de maintien au niveau de crête avant la décroissance. */
  hold?: number;
  /** Bruit : fréquence d'arrivée du filtre (balayage sur toute la durée). */
  to?: number;
  /** Trémolo : [fréquence en Hz, profondeur 0..1]. */
  trem?: [number, number];
  /** Vibrato : [fréquence en Hz, profondeur relative à la note]. */
  vib?: [number, number];
  /** Oscillateur : filtre [type, fréquence, Q, fréquence d'arrivée ?]. */
  filter?: [BiquadFilterType, number, number, number?];
  /** Oscillateur : points de passage [décalage en s, fréquence] avant la fréquence finale. */
  glide?: Array<[number, number]>;
  /** Désaccord en cents. */
  detune?: number;
}

/** Plancher des enveloppes : une rampe exponentielle ne peut pas atteindre 0. */
const FLOOR = 0.001;
/** Écart minimal entre deux sons de même nom (polyphonie bon marché). */
const MIN_GAP = 0.03;
/** Nombre maximal de voix simultanées. */
const MAX_VOICES = 24;
/** Coupure du passe-bas général quand le joueur est sous l'eau. */
const UNDERWATER_HZ = 650;
/** Niveau de la pluie à intensité maximale. */
const RAIN_GAIN = 0.28;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const hz = (f: number): number => clamp(f, 20, 16000);
const num = (v: number | undefined, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Enveloppe percussive : montée linéaire, maintien éventuel, puis décroissance exponentielle. */
function envelope(p: AudioParam, t: number, peak: number, dur: number, attack: number, hold: number): void {
  const pk = Math.max(peak, FLOOR * 2);
  const a = clamp(attack, 0.001, dur * 0.5);
  const h = Math.min(hold, dur - a - 0.01);
  p.setValueAtTime(FLOOR, t);
  p.linearRampToValueAtTime(pk, t + a);
  if (h > 0) p.setValueAtTime(pk, t + a + h);
  p.exponentialRampToValueAtTime(FLOOR, t + dur);
}

/**
 * Compensation de niveau d'un bruit blanc filtré : plus la bande est étroite, plus l'énergie
 * chute. On vise une crête voisine de `gain` quelle que soit la largeur du filtre.
 */
function noiseMakeup(type: BiquadFilterType, f: number, q: number, sampleRate: number): number {
  const nyq = sampleRate / 2;
  let frac = 1;
  if (type === 'bandpass') frac = ((Math.PI / 2) * (f / Math.max(q, 0.1))) / nyq;
  else if (type === 'lowpass') frac = (1.1 * f) / nyq;
  else if (type === 'highpass') frac = 1 - f / nyq;
  return 0.9 / Math.sqrt(clamp(frac, 0.004, 1));
}

/** Même idée pour une onde riche passée dans un filtre (formants des voix d'animaux). */
function toneMakeup(wave: OscillatorType, f0: number, type: BiquadFilterType, fc: number, q: number): number {
  let sum = 0;
  for (let n = 1; n <= 48 && n * f0 < 16000; n++) {
    let a = n === 1 ? 1 : 0;
    if (wave === 'sawtooth') a = 2 / (Math.PI * n);
    else if (wave === 'square') a = n % 2 ? 4 / (Math.PI * n) : 0;
    else if (wave === 'triangle') a = n % 2 ? 8 / (Math.PI * Math.PI * n * n) : 0;
    if (a === 0) continue;
    const r = (n * f0) / fc;
    let h2 = 1;
    if (type === 'bandpass') h2 = 1 / (1 + q * q * (r - 1 / r) ** 2);
    else if (type === 'lowpass') h2 = 1 / (1 + r ** 4);
    else if (type === 'highpass') h2 = r ** 4 / (1 + r ** 4);
    sum += 0.5 * a * a * h2;
  }
  return clamp(0.4 / Math.max(Math.sqrt(sum), 0.02), 0.5, 8);
}

/**
 * Une voix = un son complet, composé de couches (bruits filtrés et oscillateurs) qui partagent
 * un gain de sortie, un éventuel étouffoir et un panoramique. Tout est libéré à la fin.
 */
class Voice {
  private readonly out: GainNode;
  private readonly chain: AudioNode[] = [];
  private last: AudioScheduledSourceNode | null = null;
  private end: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly buf: AudioBuffer,
    dest: AudioNode,
    private readonly t0: number,
    private readonly pitch: number,
    volume: number,
    pan: number,
    muffle: number,
  ) {
    this.end = t0;
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    let node: AudioNode = this.out;
    if (muffle > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = muffle;
      lp.Q.value = 0;
      node.connect(lp);
      this.chain.push(lp);
      node = lp;
    }
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      node.connect(sp);
      this.chain.push(sp);
      node = sp;
    }
    node.connect(dest);
  }

  /** Salve de bruit blanc filtré. `gain` ≈ niveau de crête, quelle que soit la largeur de bande. */
  noise(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, x: Extra = {}): void {
    const ctx = this.ctx;
    const start = this.t0 + Math.max(0, t);
    const d = Math.max(0.012, dur);
    const end = start + d + 0.03;
    const f0 = hz(freq * this.pitch);
    const src = ctx.createBufferSource();
    src.buffer = this.buf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, start);
    if (x.to !== undefined) filt.frequency.exponentialRampToValueAtTime(hz(x.to * this.pitch), start + d);
    const amp = ctx.createGain();
    envelope(amp.gain, start, gain * noiseMakeup(type, f0, q, ctx.sampleRate), d, x.attack ?? 0.002, x.hold ?? 0);
    src.connect(filt);
    filt.connect(amp);
    this.tremolo(amp, start, end, x).connect(this.out);
    // Départ à un endroit aléatoire du tampon : deux salves ne sont jamais identiques.
    src.start(start, Math.random() * Math.max(0, this.buf.duration - 0.1));
    this.stopAt(src, end);
  }

  /** Coup tonal : oscillateur glissant de `f0` à `f1`, filtré et modulé au besoin. */
  tone(t: number, dur: number, gain: number, wave: OscillatorType, f0: number, f1 = f0, x: Extra = {}): void {
    const ctx = this.ctx;
    const start = this.t0 + Math.max(0, t);
    const d = Math.max(0.012, dur);
    const end = start + d + 0.03;
    const p = this.pitch;
    const base = hz(f0 * p);
    const osc = ctx.createOscillator();
    osc.type = wave;
    if (x.detune) osc.detune.value = x.detune;
    osc.frequency.setValueAtTime(base, start);
    if (x.glide) {
      for (const [dt, f] of x.glide) osc.frequency.exponentialRampToValueAtTime(hz(f * p), start + clamp(dt, 0.001, d));
    }
    if (f1 !== f0 || x.glide) osc.frequency.exponentialRampToValueAtTime(hz(f1 * p), start + d);
    if (x.vib) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = x.vib[0];
      depth.gain.value = base * x.vib[1];
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(end);
    }
    let node: AudioNode = osc;
    let makeup = 1;
    if (x.filter) {
      const [type, fc, q, fcEnd] = x.filter;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.Q.value = q;
      filt.frequency.setValueAtTime(hz(fc * p), start);
      if (fcEnd !== undefined) filt.frequency.exponentialRampToValueAtTime(hz(fcEnd * p), start + d);
      makeup = toneMakeup(wave, f0, type, fc, q);
      node.connect(filt);
      node = filt;
    }
    const amp = ctx.createGain();
    envelope(amp.gain, start, gain * makeup, d, x.attack ?? 0.003, x.hold ?? 0);
    node.connect(amp);
    this.tremolo(amp, start, end, x).connect(this.out);
    osc.start(start);
    this.stopAt(osc, end);
  }

  /** Clôt la voix : tout est déconnecté quand la dernière source s'arrête. Renvoie l'instant de fin. */
  finish(): number {
    const out = this.out;
    const chain = this.chain;
    const release = (): void => {
      out.disconnect();
      for (const n of chain) n.disconnect();
    };
    if (this.last) this.last.onended = release;
    else release();
    return this.end;
  }

  private tremolo(node: AudioNode, start: number, end: number, x: Extra): AudioNode {
    if (!x.trem) return node;
    const ctx = this.ctx;
    const depth = clamp(x.trem[1], 0, 1);
    const g = ctx.createGain();
    g.gain.value = 1 - depth / 2;
    const lfo = ctx.createOscillator();
    const amount = ctx.createGain();
    lfo.frequency.value = x.trem[0];
    amount.gain.value = depth / 2;
    lfo.connect(amount);
    amount.connect(g.gain);
    lfo.start(start);
    lfo.stop(end);
    node.connect(g);
    return g;
  }

  private stopAt(src: AudioScheduledSourceNode, end: number): void {
    src.stop(end);
    if (end >= this.end) {
      this.end = end;
      this.last = src;
    }
  }
}

/** Réglages par usage d'un son de bloc : niveau, échelle de durée, hauteur, étouffoir (Hz, 0 = aucun). */
const KINDS: Record<BlockKind, { level: number; len: number; pitch: number; muffle: number }> = {
  break: { level: 0.7, len: 1, pitch: 1, muffle: 0 },
  place: { level: 0.6, len: 0.7, pitch: 0.85, muffle: 0 },
  hit: { level: 0.36, len: 0.55, pitch: 0.7, muffle: 2600 },
  step: { level: 0.3, len: 0.6, pitch: 1.05, muffle: 0 },
};

/** Matières douces : passe-bas appliqué à toute la voix (Hz) pour arrondir les aigus du bruit. */
const SOFTEN: Partial<Record<SoundGroup, number>> = { grass: 5500, sand: 7000, snow: 6000, cloth: 1200 };

/** Partiels inharmoniques d'une barre métallique. */
const METAL_RATIOS = [1, 2.76, 5.4, 8.93];

/** Synthèse d'un son de bloc. `len` raccourcit le corps du son ; seule la casse a des débris. */
function renderBlock(v: Voice, group: SoundGroup, kind: BlockKind, len: number): void {
  const brk = kind === 'break';
  switch (group) {
    case 'stone':
      v.noise(0, 0.06 * len + 0.015, 0.5, 'bandpass', 3200, 0.8); // clic dur et brillant
      v.noise(0, 0.22 * len, 0.3, 'bandpass', 950, 1.2); // grain minéral
      v.tone(0, 0.2 * len, 0.38, 'sine', 170, 62); // coup sourd
      if (brk) {
        for (let i = 0; i < 3; i++) {
          v.noise(0.05 + i * rnd(0.04, 0.07), 0.08, rnd(0.12, 0.22), 'bandpass', rnd(1400, 2800), 1.5); // éclats
        }
      }
      break;
    case 'wood': {
      const f = rnd(420, 880);
      v.noise(0, 0.24 * len, 0.5, 'bandpass', f, 5); // toc creux
      v.tone(0, 0.2 * len, 0.3, 'triangle', f * 0.42, f * 0.3); // résonance de la planche
      v.noise(0, 0.025, 0.18, 'bandpass', 2000, 1); // attaque
      if (brk) {
        v.noise(0.09, 0.22, 0.35, 'bandpass', f * 0.8, 5);
        v.noise(0.05, 0.12, 0.18, 'bandpass', 1500, 1.5); // craquement des fibres
      }
      break;
    }
    case 'grass':
      v.noise(0, 0.28 * len, 0.3, 'highpass', 1600, 0.5, { attack: 0.03 * len + 0.008 }); // bruissement
      v.noise(0, 0.17 * len, 0.3, 'lowpass', 380, 0.5, { attack: 0.006 }); // terre meuble
      if (brk) v.noise(0.09, 0.26, 0.2, 'bandpass', 3200, 0.7, { attack: 0.04 });
      break;
    case 'gravel': {
      const grains = brk ? 7 : kind === 'place' ? 4 : 3;
      for (let i = 0; i < grains; i++) {
        v.noise(i * rnd(0.016, 0.034), rnd(0.03, 0.07), rnd(0.18, 0.4), 'bandpass', rnd(900, 3400), 1.6); // cailloux
      }
      v.noise(0, 0.16 * len, 0.32, 'lowpass', 520, 0.5);
      break;
    }
    case 'sand':
      v.noise(0, 0.28 * len, 0.42, 'bandpass', 4200, 0.7, { attack: 0.012, to: 2000 }); // souffle doux
      v.noise(0, 0.15 * len, 0.22, 'lowpass', 600, 0.5, { attack: 0.006 });
      if (brk) v.noise(0.08, 0.24, 0.18, 'bandpass', 3200, 0.7, { attack: 0.03, to: 1600 });
      break;
    case 'cloth':
      v.noise(0, 0.22 * len, 0.4, 'lowpass', 300, 0.5, { attack: 0.006 }); // choc très étouffé
      v.tone(0, 0.2 * len, 0.3, 'sine', 125, 60, { attack: 0.006 });
      if (brk) v.noise(0.06, 0.15, 0.3, 'lowpass', 420, 0.5, { attack: 0.01 });
      break;
    case 'glass':
      if (brk) {
        v.noise(0, 0.09, 0.4, 'highpass', 4800, 0.5); // fracas
        v.noise(0, 0.2, 0.2, 'bandpass', 2600, 1.2);
        for (let i = 0; i < 7; i++) {
          v.tone(rnd(0, 0.11), rnd(0.14, 0.4), rnd(0.05, 0.1), 'sine', rnd(2000, 6000)); // tintements
        }
        for (let i = 0; i < 3; i++) v.noise(0.05 + i * rnd(0.03, 0.05), 0.04, 0.2, 'bandpass', rnd(4500, 7500), 3);
      } else {
        v.noise(0, 0.05 * len + 0.015, 0.4, 'bandpass', 4300, 2);
        v.tone(0, 0.14 * len, 0.12, 'sine', rnd(2300, 3000));
        v.tone(0, 0.1 * len, 0.08, 'sine', rnd(3800, 5200));
        v.tone(0, 0.11 * len, 0.25, 'sine', 320, 190);
      }
      break;
    case 'snow':
      v.noise(0, 0.2 * len, 0.36, 'bandpass', 1300, 3, { attack: 0.012, to: 2300 }); // crissement
      v.noise(0, 0.15 * len, 0.3, 'lowpass', 650, 0.5, { attack: 0.008 }); // tassement
      if (brk) v.noise(0.08, 0.2, 0.3, 'bandpass', 2000, 3, { attack: 0.015, to: 1100 });
      break;
    case 'metal': {
      const f = rnd(480, 620);
      METAL_RATIOS.forEach((r, i) => v.tone(0, (0.62 - i * 0.12) * len, 0.24 / (i + 1), 'sine', f * r)); // tintement
      v.noise(0, 0.035, 0.3, 'bandpass', 3600, 1.2); // impact
      v.tone(0, 0.09 * len, 0.22, 'sine', 210, 120);
      if (brk) METAL_RATIOS.forEach((r, i) => v.tone(0.09, 0.45 - i * 0.09, 0.14 / (i + 1), 'sine', f * 1.19 * r));
      break;
    }
  }
}

/** Coup porté : base commune de 'attack' et 'attack_crit'. */
function thud(v: Voice): void {
  v.noise(0, 0.09, 0.45, 'bandpass', 750, 1);
  v.tone(0, 0.11, 0.4, 'sine', 185, 85);
  v.noise(0, 0.03, 0.2, 'bandpass', 2400, 1.2);
}

/** Niveau de sortie par son (0.7 par défaut). */
const LEVELS: Partial<Record<SfxName, number>> = {
  click: 0.5, pop: 0.6, orb: 0.6, egg: 0.6, levelup: 0.6, fire: 0.5, fuse: 0.55, swim: 0.55, fizz: 0.6,
  explode: 0.6, thunder: 0.6, fall_big: 0.6,
};

/** Recette de synthèse de chaque son nommé. */
const SOUNDS: Record<SfxName, (v: Voice) => void> = {
  click: (v) => {
    v.noise(0, 0.03, 0.45, 'bandpass', 2500, 2.5);
    v.tone(0, 0.045, 0.25, 'triangle', 980, 620);
  },
  pop: (v) => {
    const f = rnd(650, 1100); // ramassage d'objet : petit « plop » montant
    v.tone(0, 0.1, 0.4, 'sine', f, f * 1.45, { attack: 0.004 });
  },
  hurt: (v) => {
    // « Ouf » classique : note descendante avec un formant en « o ».
    v.tone(0, 0.26, 0.5, 'sawtooth', 300, 135, { glide: [[0.035, 335]], filter: ['bandpass', 620, 1.4, 420], attack: 0.008 });
    v.tone(0, 0.22, 0.2, 'sine', 150, 68);
    v.noise(0, 0.06, 0.25, 'lowpass', 500, 0.5);
  },
  death: (v) => {
    v.tone(0, 0.7, 0.5, 'sawtooth', 280, 62, { glide: [[0.04, 310]], filter: ['bandpass', 600, 1.4, 260], attack: 0.01, hold: 0.1 });
    v.tone(0.05, 0.6, 0.25, 'sine', 140, 40);
    v.noise(0, 0.1, 0.3, 'lowpass', 450, 0.5);
  },
  eat: (v) => {
    for (let i = 0; i < 3; i++) {
      const t = i * 0.15 + rnd(0, 0.02); // trois bouchées croustillantes
      v.noise(t, 0.09, 0.4, 'bandpass', rnd(1100, 2000), 1.4);
      v.noise(t + 0.012, 0.05, 0.25, 'bandpass', rnd(2500, 3800), 2);
      v.noise(t, 0.07, 0.25, 'lowpass', 520, 0.5);
    }
  },
  burp: (v) => {
    v.tone(0, 0.42, 0.6, 'sawtooth', 96, 58, { glide: [[0.08, 112]], filter: ['bandpass', 420, 1.2, 300], trem: [41, 0.9], attack: 0.02, hold: 0.15 });
  },
  drink: (v) => {
    for (let i = 0; i < 3; i++) {
      const t = i * 0.16; // trois gorgées
      v.tone(t, 0.11, 0.35, 'sine', 240 + i * 25, 520 + i * 40, { attack: 0.012 });
      v.noise(t, 0.08, 0.12, 'lowpass', 700, 0.5, { attack: 0.01 });
    }
  },
  explode: (v) => {
    v.noise(0, 0.14, 0.3, 'highpass', 1200, 0.5); // déflagration
    v.noise(0, 1.4, 0.5, 'lowpass', 950, 0.5, { attack: 0.004, hold: 0.12, to: 80 }); // grondement
    v.noise(0.03, 1.2, 0.25, 'bandpass', 190, 0.8, { attack: 0.02, hold: 0.2 });
    v.tone(0, 1.4, 0.45, 'sine', 90, 30, { attack: 0.004, hold: 0.1 }); // souffle grave 90 → 30 Hz
  },
  fuse: (v) => {
    v.noise(0, 1.5, 0.3, 'bandpass', 6500, 0.8, { attack: 0.04, hold: 1.15, to: 4200 }); // mèche qui siffle
    v.noise(0, 1.5, 0.12, 'bandpass', 2300, 1.5, { attack: 0.08, hold: 1.1, trem: [47, 0.6] }); // grésillement
  },
  bow: (v) => {
    v.tone(0, 0.22, 0.4, 'triangle', 260, 150, { vib: [38, 0.05] }); // corde qui vibre
    v.noise(0, 0.16, 0.25, 'bandpass', 2200, 1.2, { attack: 0.01, to: 700 }); // sifflement de la flèche
    v.noise(0, 0.02, 0.2, 'bandpass', 3000, 1);
  },
  arrow_hit: (v) => {
    v.noise(0, 0.06, 0.45, 'bandpass', 1150, 3);
    v.tone(0, 0.16, 0.3, 'triangle', 330, 210, { trem: [48, 0.8] }); // hampe qui tremble
    v.tone(0, 0.07, 0.3, 'sine', 160, 90);
  },
  splash: (v) => {
    v.noise(0, 0.55, 0.45, 'bandpass', 1300, 0.7, { attack: 0.012, hold: 0.06, to: 450 });
    v.noise(0, 0.3, 0.25, 'highpass', 3200, 0.5, { attack: 0.006 });
    for (let i = 0; i < 3; i++) v.tone(0.08 + i * rnd(0.05, 0.09), 0.07, 0.14, 'sine', rnd(280, 520), rnd(600, 900)); // bulles
  },
  swim: (v) => {
    v.noise(0, 0.34, 0.3, 'bandpass', 800, 0.8, { attack: 0.05, to: 420 });
    v.noise(0.03, 0.2, 0.12, 'highpass', 2800, 0.5, { attack: 0.04 });
    v.tone(0.1, 0.06, 0.1, 'sine', 320, 560);
  },
  door_open: (v) => {
    v.noise(0, 0.1, 0.45, 'bandpass', 520, 4);
    v.tone(0, 0.09, 0.25, 'triangle', 190, 140);
    v.tone(0.03, 0.1, 0.12, 'sawtooth', 300, 420, { filter: ['bandpass', 1100, 5], trem: [55, 0.9] }); // léger grincement
    v.noise(0.1, 0.09, 0.35, 'bandpass', 760, 4);
  },
  door_close: (v) => {
    v.noise(0, 0.08, 0.3, 'bandpass', 700, 4);
    v.noise(0.08, 0.13, 0.5, 'bandpass', 400, 3.5); // battant contre le chambranle
    v.tone(0.08, 0.13, 0.35, 'sine', 120, 68);
  },
  chest_open: (v) => {
    v.noise(0, 0.07, 0.35, 'bandpass', 600, 4);
    v.tone(0.03, 0.36, 0.3, 'sawtooth', 170, 250, { filter: ['bandpass', 950, 4, 1500], trem: [36, 0.95], attack: 0.05, hold: 0.15 }); // charnières
  },
  chest_close: (v) => {
    v.tone(0, 0.2, 0.22, 'sawtooth', 250, 160, { filter: ['bandpass', 1300, 4, 850], trem: [40, 0.95], attack: 0.03 });
    v.noise(0.19, 0.14, 0.45, 'bandpass', 380, 3); // couvercle qui retombe
    v.noise(0.19, 0.1, 0.3, 'lowpass', 300, 0.5);
    v.tone(0.19, 0.15, 0.35, 'sine', 105, 55);
  },
  fall_small: (v) => {
    v.noise(0, 0.13, 0.45, 'lowpass', 420, 0.5);
    v.tone(0, 0.13, 0.4, 'sine', 135, 62);
    v.noise(0, 0.05, 0.2, 'bandpass', 1300, 1.2);
  },
  fall_big: (v) => {
    v.noise(0, 0.28, 0.45, 'lowpass', 600, 0.5);
    v.tone(0, 0.32, 0.45, 'sine', 115, 40);
    v.noise(0, 0.08, 0.3, 'bandpass', 1600, 1.5); // craquement
    v.noise(0.05, 0.07, 0.25, 'bandpass', 2300, 2);
  },
  tool_break: (v) => {
    v.noise(0, 0.07, 0.45, 'bandpass', 2700, 1.5);
    v.noise(0.05, 0.08, 0.3, 'bandpass', 900, 3);
    v.noise(0.06, 0.12, 0.3, 'highpass', 4500, 0.5);
    v.tone(0, 0.14, 0.14, 'sine', 1350);
    v.tone(0.02, 0.12, 0.1, 'sine', 2180);
  },
  levelup: (v) => {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      v.tone(i * 0.075, 0.55, 0.2, 'sine', f); // arpège montant
      v.tone(i * 0.075, 0.4, 0.07, 'triangle', f * 2);
    });
    v.tone(0.4, 0.9, 0.13, 'sine', 1046.5);
    v.tone(0.4, 0.9, 0.1, 'sine', 1568);
  },
  fizz: (v) => {
    v.noise(0, 0.5, 0.35, 'bandpass', 7500, 0.7, { attack: 0.006, hold: 0.08, to: 3000 });
    v.noise(0, 0.3, 0.15, 'bandpass', 2200, 1.5, { trem: [60, 0.7] });
  },
  fire: (v) => {
    v.noise(0, 0.9, 0.22, 'lowpass', 340, 0.5, { attack: 0.15, hold: 0.4 }); // souffle de la flamme
    for (let i = 0; i < 6; i++) v.noise(rnd(0, 0.75), rnd(0.012, 0.03), rnd(0.15, 0.4), 'bandpass', rnd(1400, 4200), 2); // crépitements
  },
  ignite: (v) => {
    v.noise(0, 0.045, 0.4, 'bandpass', 4200, 2.5); // silex contre acier
    v.tone(0, 0.08, 0.1, 'sine', 3150);
    v.noise(0.04, 0.45, 0.3, 'bandpass', 500, 0.8, { attack: 0.09, to: 1500 }); // embrasement
  },
  attack: (v) => thud(v),
  attack_crit: (v) => {
    thud(v);
    v.noise(0, 0.14, 0.3, 'highpass', 3500, 0.5);
    for (let i = 0; i < 3; i++) v.tone(i * 0.035, 0.16, 0.1, 'sine', 1700 + i * 520); // étincelles
  },
  attack_miss: (v) => {
    v.noise(0, 0.24, 0.3, 'bandpass', 500, 1.6, { attack: 0.07, to: 1900 }); // coup dans le vide
    v.noise(0.02, 0.2, 0.1, 'highpass', 3000, 0.5, { attack: 0.08 });
  },
  bucket_fill: (v) => {
    v.noise(0, 0.36, 0.35, 'bandpass', 600, 0.9, { attack: 0.03, hold: 0.08, to: 1500 });
    for (let i = 0; i < 3; i++) v.tone(0.04 + i * 0.07, 0.08, 0.15, 'sine', 300 + i * 90, 560 + i * 120);
  },
  bucket_empty: (v) => {
    v.noise(0, 0.4, 0.4, 'bandpass', 1500, 0.9, { attack: 0.015, hold: 0.06, to: 480 });
    v.noise(0, 0.15, 0.15, 'highpass', 3000, 0.5);
    for (let i = 0; i < 3; i++) v.tone(0.05 + i * 0.07, 0.08, 0.14, 'sine', 620 - i * 80, 330 - i * 40);
  },
  pig: (v) => {
    for (let i = 0; i < 2; i++) {
      // Grognement nasal : dent de scie qui monte puis retombe, rendue rauque par un trémolo rapide.
      const lo = 150 - i * 20;
      v.tone(i * 0.19, 0.17, 0.45, 'sawtooth', lo, lo - 30, { glide: [[0.06, lo + 85]], filter: ['bandpass', 1150, 3], trem: [34, 0.7], attack: 0.015 });
    }
    v.noise(0, 0.1, 0.1, 'bandpass', 1400, 2, { attack: 0.02 });
  },
  cow: (v) => {
    const glide: Array<[number, number]> = [[0.18, 142], [0.6, 132]];
    v.tone(0, 0.95, 0.4, 'sawtooth', 118, 98, { glide, filter: ['lowpass', 320, 4, 750], vib: [5.5, 0.025], attack: 0.09, hold: 0.45 });
    v.tone(0, 0.95, 0.2, 'triangle', 118, 98, { glide, vib: [5.5, 0.025], attack: 0.09, hold: 0.45 });
  },
  sheep: (v) => {
    v.tone(0, 0.65, 0.45, 'sawtooth', 400, 340, { filter: ['bandpass', 1300, 2], trem: [10, 0.85], vib: [10, 0.03], attack: 0.03, hold: 0.35 });
  },
  chicken: (v) => {
    const n = Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1; // la dernière syllabe est plus longue et plus aiguë
      v.tone(i * 0.13 + rnd(0, 0.02), last ? 0.16 : 0.08, 0.5, 'sawtooth', 620, 540, {
        glide: [[0.03, last ? 1250 : 980]], filter: ['bandpass', 1900, 3], attack: 0.008,
      });
    }
  },
  zombie: (v) => {
    const glide: Array<[number, number]> = [[0.3, 96], [0.7, 78]];
    v.tone(0, 1, 0.3, 'sawtooth', 84, 70, { glide, filter: ['bandpass', 560, 2.5, 420], vib: [4.2, 0.03], attack: 0.14, hold: 0.4 });
    v.tone(0, 1, 0.3, 'sawtooth', 84, 70, { glide, detune: 22, filter: ['bandpass', 980, 4, 760], vib: [4.2, 0.03], attack: 0.14, hold: 0.4 });
    v.noise(0, 0.9, 0.1, 'bandpass', 700, 1.5, { attack: 0.2, hold: 0.3 }); // souffle rauque
  },
  skeleton: (v) => {
    let t = 0;
    for (let i = 0; i < 6; i++) {
      v.noise(t, 0.045, rnd(0.3, 0.5), 'bandpass', rnd(1000, 2300), 7); // os qui s'entrechoquent
      v.tone(t, 0.03, 0.1, 'triangle', rnd(700, 1200));
      t += rnd(0.045, 0.1);
    }
  },
  spider: (v) => {
    v.noise(0, 0.45, 0.35, 'highpass', 4200, 0.5, { attack: 0.03, hold: 0.2, trem: [31, 0.9] });
    v.noise(0, 0.4, 0.2, 'bandpass', 2400, 2.5, { attack: 0.02, to: 3200, trem: [23, 0.8] });
  },
  creeper_hurt: (v) => {
    v.noise(0, 0.32, 0.4, 'bandpass', 3400, 0.9, { attack: 0.01, to: 1700 });
    v.tone(0, 0.2, 0.25, 'sawtooth', 210, 130, { filter: ['bandpass', 800, 2] });
  },
  mob_hurt: (v) => {
    v.tone(0, 0.18, 0.45, 'sawtooth', 430, 210, { filter: ['bandpass', 950, 1.5], attack: 0.006 });
    v.noise(0, 0.07, 0.25, 'bandpass', 800, 1);
  },
  egg: (v) => {
    v.tone(0, 0.08, 0.35, 'sine', 420, 760, { attack: 0.004 });
    v.noise(0, 0.03, 0.15, 'bandpass', 1800, 1.5);
  },
  shear: (v) => {
    for (let i = 0; i < 2; i++) {
      const t = i * 0.1; // deux coups de lames
      v.noise(t, 0.05, 0.4, 'highpass', 5000, 0.5);
      v.noise(t, 0.04, 0.2, 'bandpass', 2600, 3);
      v.tone(t, 0.07, 0.08, 'sine', 4100 + i * 600);
    }
  },
  thunder: (v) => {
    v.noise(0, 0.3, 0.35, 'highpass', 1500, 0.5); // claquement
    v.noise(0.02, 3.2, 0.5, 'lowpass', 700, 0.5, { attack: 0.03, hold: 0.5, to: 70 }); // grondement
    v.noise(0.15, 3, 0.3, 'bandpass', 130, 0.8, { attack: 0.3, hold: 0.8, trem: [5.5, 0.7] }); // roulement
    v.tone(0, 2.4, 0.3, 'sine', 58, 30, { attack: 0.02, hold: 0.2 });
  },
  orb: (v) => {
    const f = rnd(1300, 1900);
    v.tone(0, 0.28, 0.3, 'sine', f);
    v.tone(0, 0.2, 0.1, 'sine', f * 2);
    v.tone(0.05, 0.3, 0.2, 'sine', f * 1.5);
  },
  note_piano: (v) => {
    v.tone(0, 0.32, 0.42, 'sine', 370);
    v.tone(0, 0.24, 0.14, 'triangle', 740);
  },
  note_grosse_caisse: (v) => {
    v.tone(0, 0.18, 0.55, 'sine', 120, 45);
    v.noise(0, 0.05, 0.25, 'lowpass', 180, 0.8);
  },
  note_basse: (v) => {
    v.tone(0, 0.28, 0.45, 'triangle', 185);
    v.tone(0, 0.22, 0.15, 'sawtooth', 185, 185, { filter: ['lowpass', 480, 1] });
  },
  note_flute: (v) => {
    v.tone(0, 0.36, 0.38, 'sine', 370, 370, { attack: 0.03, vib: [5, 0.012] });
    v.noise(0, 0.2, 0.08, 'bandpass', 740, 2, { attack: 0.02 });
  },
  note_clochette: (v) => {
    v.tone(0, 0.28, 0.3, 'sine', 740);
    v.tone(0, 0.22, 0.18, 'sine', 1480);
    v.noise(0, 0.02, 0.12, 'highpass', 3200, 0.7);
  },
  note_cloche: (v) => {
    v.tone(0, 0.5, 0.35, 'sine', 587);
    v.tone(0, 0.42, 0.18, 'sine', 1175);
    v.tone(0, 0.3, 0.1, 'sine', 1760);
  },
  note_guitare: (v) => {
    v.tone(0, 0.28, 0.35, 'sawtooth', 277, 277, { filter: ['lowpass', 900, 1.2] });
    v.tone(0, 0.24, 0.18, 'triangle', 554);
  },
};

/** Gammes de la musique d'ambiance (demi-tons depuis la fondamentale) : pentatoniques et lydien léger. */
const MUSIC_SCALES = [
  [0, 2, 4, 7, 9],
  [0, 3, 5, 7, 10],
  [0, 2, 5, 7, 9],
  [0, 2, 4, 6, 7, 9],
];
/** Fondamentales possibles (notes MIDI, la2 .. fa3). */
const MUSIC_ROOTS = [45, 48, 50, 52, 53];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicIn: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private rain: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  private vol = 0.8;
  private musicVol = 0.35;
  private rainLevel = 0;
  private submerged = false;

  private musicOn = false;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly musicOscs = new Set<OscillatorNode>();
  private musicRoot = MUSIC_ROOTS[1];
  private musicScale = 0;
  private musicDegree = 4;
  private musicCount = 0;

  private readonly lastStart = new Map<string, number>();
  private voiceEnds: number[] = [];

  /** Volume général 0..1 (défaut 0.8). */
  get volume(): number {
    return this.vol;
  }

  set volume(v: number) {
    this.vol = clamp(num(v, this.vol), 0, 1);
    this.ramp(this.master?.gain, this.vol, 0.02);
  }

  /** Volume de la musique d'ambiance 0..1 (défaut 0.35). */
  get musicVolume(): number {
    return this.musicVol;
  }

  set musicVolume(v: number) {
    this.musicVol = clamp(num(v, this.musicVol), 0, 1);
    if (this.musicOn) this.ramp(this.musicBus?.gain, this.musicVol, 0.1);
  }

  /** À appeler sur un geste utilisateur : crée / reprend l'AudioContext. Sans effet si déjà actif. */
  resume(): void {
    try {
      if (!this.ctx) {
        if (typeof window === 'undefined') return;
        const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext || w.webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        this.build(ctx);
        this.ctx = ctx;
        if (this.rainLevel > 0) this.applyRain();
      }
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        const p: Promise<void> | undefined = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => undefined);
      }
    } catch {
      // Audio indisponible : le jeu reste simplement muet.
    }
  }

  play(name: SfxName, opts?: SfxOptions): void {
    try {
      const recipe = SOUNDS[name];
      if (!recipe) return;
      // Les sons mélodiques sont à peine désaccordés pour rester justes.
      const v = this.begin(name, opts, LEVELS[name] ?? 0.7, 1, 0, name === 'levelup' ? 0.02 : 0.1);
      if (!v) return;
      recipe(v);
      this.voiceEnds.push(v.finish());
    } catch {
      // Un son raté ne doit jamais interrompre le jeu.
    }
  }

  /** Bloc cassé (son long et plein). */
  blockBreak(group: SoundGroup, opts?: SfxOptions): void {
    this.block('break', group, opts);
  }

  /** Bloc posé. */
  blockPlace(group: SoundGroup, opts?: SfxOptions): void {
    this.block('place', group, opts);
  }

  /** Coup de minage en cours (son court et étouffé, répété toutes les 4 ticks). */
  blockHit(group: SoundGroup, opts?: SfxOptions): void {
    this.block('hit', group, opts);
  }

  /** Bruit de pas. */
  step(group: SoundGroup, opts?: SfxOptions): void {
    this.block('step', group, opts);
  }

  /** Musique d'ambiance générative, douce et lente, façon piano/pads (accords épars, longues réverbérations simulées par des délais). */
  startMusic(): void {
    try {
      this.musicOn = true;
      this.ramp(this.musicBus?.gain, this.musicVol, 0.3);
      // Le minuteur tourne même avant resume() : il ne joue rien tant que le contexte est muet.
      if (this.musicTimer === null) this.musicTimer = setTimeout(() => this.musicTick(), 1200);
    } catch {
      // Sans effet.
    }
  }

  stopMusic(): void {
    try {
      this.musicOn = false;
      if (this.musicTimer !== null) {
        clearTimeout(this.musicTimer);
        this.musicTimer = null;
      }
      const ctx = this.ctx;
      this.ramp(this.musicBus?.gain, 0, 0.25);
      if (ctx) {
        // Les notes en cours s'éteignent sous le fondu puis sont arrêtées pour de bon.
        for (const osc of this.musicOscs) {
          try {
            osc.stop(ctx.currentTime + 1.5);
          } catch {
            // Déjà arrêtée.
          }
        }
      }
      this.musicOscs.clear();
    } catch {
      // Sans effet.
    }
  }

  /** Boucle de pluie : intensité 0 (coupée) .. 1. */
  setRain(intensity: number): void {
    try {
      this.rainLevel = clamp(num(intensity, 0), 0, 1);
      this.applyRain();
    } catch {
      // Sans effet.
    }
  }

  /** Ambiance sous l'eau (filtre passe-bas sur tout le mixage quand true). */
  setUnderwater(on: boolean): void {
    try {
      this.submerged = !!on;
      const ctx = this.ctx;
      if (ctx) this.ramp(this.lowpass?.frequency, on ? UNDERWATER_HZ : this.openHz(ctx), 0.08);
    } catch {
      // Sans effet.
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Interne
  // ---------------------------------------------------------------------------------------------

  /** Fréquence « ouverte » du passe-bas général : 20 kHz, bornée par Nyquist. */
  private openHz(ctx: AudioContext): number {
    return Math.min(20000, ctx.sampleRate / 2);
  }

  /** Glissement doux d'un paramètre vers une cible (évite les clics de volume). */
  private ramp(param: AudioParam | undefined, target: number, timeConstant: number): void {
    const ctx = this.ctx;
    if (!ctx || !param) return;
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(target, ctx.currentTime, timeConstant);
  }

  /** Construit le graphe permanent : master, passe-bas, bruit blanc partagé, bus et échos de la musique. */
  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = this.vol;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0;
    lowpass.frequency.value = this.submerged ? UNDERWATER_HZ : this.openHz(ctx);
    master.connect(lowpass);
    lowpass.connect(ctx.destination);

    // Bruit blanc de 2 s, partagé par toutes les salves et par la pluie.
    const length = Math.floor(ctx.sampleRate * 2);
    const noiseBuf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    // Musique : entrée → bus (son direct) + deux lignes à retard bouclées et assourdies (fausse réverbération).
    const musicBus = ctx.createGain();
    musicBus.gain.value = this.musicOn ? this.musicVol : 0;
    musicBus.connect(master);
    const musicIn = ctx.createGain();
    musicIn.connect(musicBus);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    wet.connect(musicBus);
    const taps: Array<[number, number, number]> = [[0.37, 0.5, 2400], [0.61, 0.42, 1700]];
    for (const [time, feedback, cutoff] of taps) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = time;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = cutoff;
      damp.Q.value = 0;
      const back = ctx.createGain();
      back.gain.value = feedback;
      musicIn.connect(delay);
      delay.connect(damp);
      damp.connect(back);
      back.connect(delay);
      damp.connect(wet);
    }

    this.master = master;
    this.lowpass = lowpass;
    this.noiseBuf = noiseBuf;
    this.musicBus = musicBus;
    this.musicIn = musicIn;
  }

  /** Ouvre une voix si le contexte tourne et que la polyphonie le permet ; sinon null. */
  private begin(key: string, opts: SfxOptions | undefined, level: number, pitchMul: number, muffle: number, jitter: number): Voice | null {
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.noiseBuf;
    if (!ctx || !master || !buf || ctx.state !== 'running') return null;
    const now = ctx.currentTime;
    const last = this.lastStart.get(key);
    if (last !== undefined && now - last < MIN_GAP) return null;
    this.voiceEnds = this.voiceEnds.filter((end) => end > now);
    if (this.voiceEnds.length >= MAX_VOICES) return null;
    const volume = clamp(num(opts?.volume, 1), 0, 2) * level;
    if (volume < 0.0005) return null;
    this.lastStart.set(key, now);
    const pitch = clamp(num(opts?.pitch, 1), 0.25, 4) * pitchMul * (1 + (Math.random() * 2 - 1) * jitter);
    const pan = clamp(num(opts?.pan, 0), -1, 1);
    return new Voice(ctx, buf, master, now + 0.003, pitch, volume, pan, muffle);
  }

  private block(kind: BlockKind, group: SoundGroup, opts?: SfxOptions): void {
    try {
      const k = KINDS[kind];
      const soften = SOFTEN[group] ?? 0;
      const muffle = k.muffle > 0 && soften > 0 ? Math.min(k.muffle, soften) : k.muffle || soften;
      const v = this.begin(`${kind}:${group}`, opts, k.level, k.pitch, muffle, 0.1);
      if (!v) return;
      renderBlock(v, group, kind, k.len);
      this.voiceEnds.push(v.finish());
    } catch {
      // Un son raté ne doit jamais interrompre le jeu.
    }
  }

  /** Crée, ajuste ou éteint la boucle de pluie selon `rainLevel`. */
  private applyRain(): void {
    const ctx = this.ctx;
    const master = this.master;
    const buf = this.noiseBuf;
    if (!ctx || !master || !buf) return;
    const now = ctx.currentTime;
    if (this.rainLevel <= 0) {
      const old = this.rain;
      this.rain = null;
      if (old) {
        // Fondu de sortie puis arrêt : la boucle ne consomme plus rien une fois coupée.
        old.gain.gain.cancelScheduledValues(now);
        old.gain.gain.setTargetAtTime(0, now, 0.15);
        old.src.stop(now + 1);
      }
      return;
    }
    if (!this.rain) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // Averse : sifflement large (gouttes) + bande grave (masse de la pluie au sol).
      const hiss = ctx.createBiquadFilter();
      hiss.type = 'highpass';
      hiss.frequency.value = 900;
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 5200;
      const body = ctx.createBiquadFilter();
      body.type = 'bandpass';
      body.frequency.value = 420;
      body.Q.value = 0.6;
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = 0.8;
      src.connect(hiss);
      hiss.connect(soften);
      soften.connect(gain);
      src.connect(body);
      body.connect(bodyGain);
      bodyGain.connect(gain);
      gain.connect(master);
      src.onended = () => gain.disconnect();
      src.start();
      this.rain = { src, gain };
    }
    const g = this.rain.gain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.rainLevel * RAIN_GAIN, now, 0.4);
  }

  /** Battement de la musique : une courte phrase, puis un nouveau rendez-vous dans quelques secondes. */
  private musicTick(): void {
    this.musicTimer = null;
    if (!this.musicOn) return;
    try {
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running' && this.musicIn) this.musicPhrase(ctx.currentTime + 0.1);
    } catch {
      // Une phrase ratée n'arrête pas la musique.
    }
    this.musicTimer = setTimeout(() => this.musicTick(), 2600 + Math.random() * 4800);
  }

  /** Une phrase : silence, note isolée, petit motif ou accord égrené, parfois soutenu par une nappe grave. */
  private musicPhrase(t: number): void {
    if (this.musicCount++ % 7 === 0) {
      // Changement de couleur de temps en temps.
      this.musicRoot = MUSIC_ROOTS[Math.floor(Math.random() * MUSIC_ROOTS.length)];
      this.musicScale = Math.floor(Math.random() * MUSIC_SCALES.length);
    }
    const scale = MUSIC_SCALES[this.musicScale];
    const r = Math.random();
    if (r < 0.15) return; // la musique respire
    const count = r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
    const chord = Math.random() < 0.3;
    let when = t;
    for (let i = 0; i < count; i++) {
      const move = chord ? 2 : Math.floor(rnd(-2, 3));
      this.musicDegree = clamp(this.musicDegree + move, 0, scale.length + 3);
      if (chord && this.musicDegree >= scale.length + 3) this.musicDegree = Math.floor(rnd(0, 3));
      const d = this.musicDegree;
      const midi = this.musicRoot + 12 + scale[d % scale.length] + 12 * Math.floor(d / scale.length);
      this.musicNote(when, midiHz(midi), rnd(0.25, 0.4), rnd(3.5, 5.5), false);
      when += chord ? rnd(0.04, 0.09) : rnd(0.45, 1.1);
    }
    if (Math.random() < 0.3) this.musicNote(t, midiHz(this.musicRoot), 0.2, rnd(6, 8), true);
  }

  /** Une note : sinus + triangle légèrement désaccordé ; frappe douce façon piano, ou nappe à montée lente. */
  private musicNote(t: number, freq: number, gain: number, dur: number, pad: boolean): void {
    const ctx = this.ctx;
    const dest = this.musicIn;
    if (!ctx || !dest) return;
    const amp = ctx.createGain();
    const g = amp.gain;
    g.setValueAtTime(FLOOR, t);
    if (pad) {
      g.linearRampToValueAtTime(gain, t + dur * 0.35);
    } else {
      g.linearRampToValueAtTime(gain, t + 0.012);
      g.exponentialRampToValueAtTime(gain * 0.4, t + 0.4);
    }
    g.exponentialRampToValueAtTime(FLOOR, t + dur);
    amp.connect(dest);
    const soft = ctx.createGain();
    soft.gain.value = 0.35;
    soft.connect(amp);
    const sine = ctx.createOscillator();
    sine.frequency.value = freq;
    sine.connect(amp);
    const tri = ctx.createOscillator();
    tri.type = 'triangle';
    tri.frequency.value = freq;
    tri.detune.value = 5;
    tri.connect(soft);
    for (const osc of [sine, tri]) {
      this.musicOscs.add(osc);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    sine.onended = () => {
      amp.disconnect();
      this.musicOscs.delete(sine);
    };
    tri.onended = () => {
      this.musicOscs.delete(tri);
    };
  }
}
