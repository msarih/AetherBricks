export class SoundManager {
  private ctx: AudioContext | null = null;
  public enabled = true;
  public ambienceEnabled = true;

  // Noeuds audio pour l'ambiance procédurale
  private ambienceMasterGain: GainNode | null = null;
  private breezeGain: GainNode | null = null;
  private cricketsGain: GainNode | null = null;
  private fireGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private isAmbienceRunning = false;

  private birdTimer = 0;
  private fireCrackleTimer = 0;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public toggleAmbience(): boolean {
    this.ambienceEnabled = !this.ambienceEnabled;
    if (this.ambienceMasterGain && this.ctx) {
      this.ambienceMasterGain.gain.linearRampToValueAtTime(
        this.ambienceEnabled ? 0.35 : 0.0001,
        this.ctx.currentTime + 0.3
      );
    }
    return this.ambienceEnabled;
  }

  public startAmbience(): void {
    if (this.isAmbienceRunning) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.isAmbienceRunning = true;

    // Master Ambience Gain
    this.ambienceMasterGain = ctx.createGain();
    this.ambienceMasterGain.gain.setValueAtTime(this.ambienceEnabled ? 0.35 : 0.0001, ctx.currentTime);
    this.ambienceMasterGain.connect(ctx.destination);

    // 1. Brise de vent procédurale (bruit rose filtré doux)
    try {
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        output[i] = (b0 + b1 + b2) * 0.05;
      }
      const windSource = ctx.createBufferSource();
      windSource.buffer = noiseBuffer;
      windSource.loop = true;

      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.setValueAtTime(320, ctx.currentTime);

      this.breezeGain = ctx.createGain();
      this.breezeGain.gain.setValueAtTime(0.18, ctx.currentTime);

      windSource.connect(windFilter);
      windFilter.connect(this.breezeGain);
      this.breezeGain.connect(this.ambienceMasterGain);
      windSource.start(0);
    } catch {
      // Ignorer si audio non encore activé
    }

    // 2. Grillons nocturnes (crickets)
    this.cricketsGain = ctx.createGain();
    this.cricketsGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.cricketsGain.connect(this.ambienceMasterGain);

    // 3. Feu crépitant (gain)
    this.fireGain = ctx.createGain();
    this.fireGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.fireGain.connect(this.ambienceMasterGain);

    // 4. Eau qui coule (gain)
    this.waterGain = ctx.createGain();
    this.waterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.waterGain.connect(this.ambienceMasterGain);
  }

  /**
   * Met à jour dynamiquement l'ambiance sonore selon l'heure et l'environnement
   */
  public updateAmbience(
    dt: number,
    isNight: boolean,
    isRaining: boolean,
    nearFire: boolean,
    nearWater: boolean
  ): void {
    if (!this.enabled || !this.ambienceEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (!this.isAmbienceRunning) {
      this.startAmbience();
    }

    const now = ctx.currentTime;

    // Brise / Vent : augmente légèrement s'il pleut
    if (this.breezeGain) {
      const targetBreeze = isRaining ? 0.38 : 0.18;
      this.breezeGain.gain.linearRampToValueAtTime(targetBreeze, now + 0.5);
    }

    // Grillons : audibles la nuit sans pluie
    if (this.cricketsGain) {
      const targetCrickets = isNight && !isRaining ? 0.22 : 0.0001;
      this.cricketsGain.gain.linearRampToValueAtTime(targetCrickets, now + 1.0);
    }

    // Feu crépitant à proximité
    if (this.fireGain) {
      const targetFire = nearFire ? 0.28 : 0.0001;
      this.fireGain.gain.linearRampToValueAtTime(targetFire, now + 0.3);
    }

    // Eau ruisselante à proximité
    if (this.waterGain) {
      const targetWater = nearWater ? 0.25 : 0.0001;
      this.waterGain.gain.linearRampToValueAtTime(targetWater, now + 0.3);
    }

    // Micro-clics aléatoires de bois qui crépite si près d'un feu
    if (nearFire) {
      this.fireCrackleTimer -= dt;
      if (this.fireCrackleTimer <= 0) {
        this.fireCrackleTimer = 0.08 + Math.random() * 0.22;
        this.playPop();
      }
    }

    // Chants d'oiseaux périodiques le jour sans pluie
    if (!isNight && !isRaining) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) {
        this.birdTimer = 4.5 + Math.random() * 8.0;
        this.playBirdChirp();
      }
    }
  }

  private playPop(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.ambienceEnabled) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(350 + Math.random() * 800, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.015);
    gain.gain.setValueAtTime(0.04 + Math.random() * 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    osc.connect(gain);
    if (this.fireGain) {
      gain.connect(this.fireGain);
    } else {
      gain.connect(ctx.destination);
    }
    osc.start(now);
    osc.stop(now + 0.02);
  }

  public playBirdChirp(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.ambienceEnabled) return;
    const now = ctx.currentTime;

    const baseFreq = 2200 + Math.random() * 1200;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq + 600, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(baseFreq - 300, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(baseFreq + 400, now + 0.12);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    if (this.ambienceMasterGain) {
      gain.connect(this.ambienceMasterGain);
    } else {
      gain.connect(ctx.destination);
    }
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playTeleportHome(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // Do, Mi, Sol, Do octave
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.001, now + idx * 0.07);
      gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.35);
    });
  }

  public playPlace(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Crisp ceramic/stone brick placement thud + click
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.085);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);

    // High ceramic click
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(920, now);
    clickOsc.frequency.exponentialRampToValueAtTime(340, now + 0.03);

    clickGain.gain.setValueAtTime(0.12, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.start(now);
    clickOsc.stop(now + 0.04);
  }

  public playRemove(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.11);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.125);
  }

  public playDig(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Bruit sourd et croustillant de coup de pelle / terre creusée
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140 + Math.random() * 25, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.14);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playPaint(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Bruissement doux et soyeux de pinceau ou rouleau de peinture
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.08);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.125);
  }

  public playStep(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 + Math.random() * 25, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.05);

    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playSelect(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.04);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playDoor(open: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Metallic latch click
    const latchOsc = ctx.createOscillator();
    const latchGain = ctx.createGain();
    latchOsc.type = 'triangle';
    latchOsc.frequency.setValueAtTime(open ? 640 : 480, now);
    latchOsc.frequency.exponentialRampToValueAtTime(190, now + 0.045);
    latchGain.gain.setValueAtTime(0.18, now);
    latchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    latchOsc.connect(latchGain);
    latchGain.connect(ctx.destination);
    latchOsc.start(now);
    latchOsc.stop(now + 0.055);

    // Warm wooden swing resonance
    const woodOsc = ctx.createOscillator();
    const woodGain = ctx.createGain();
    woodOsc.type = 'sine';
    woodOsc.frequency.setValueAtTime(open ? 135 : 165, now + 0.03);
    woodOsc.frequency.exponentialRampToValueAtTime(open ? 185 : 92, now + 0.22);
    woodGain.gain.setValueAtTime(0.16, now + 0.03);
    woodGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    woodOsc.connect(woodGain);
    woodGain.connect(ctx.destination);
    woodOsc.start(now + 0.03);
    woodOsc.stop(now + 0.25);
  }
}

