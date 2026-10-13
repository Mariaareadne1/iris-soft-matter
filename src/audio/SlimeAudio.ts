import type { PresetId } from '../render/presets.ts';

/**
 * Procedural slime foley, synthesised live with Web Audio — no samples.
 *
 * Real slime has almost no pitch: it is wet, sticky noise. So every sound
 * here is shaped noise, never an oscillator:
 *
 *   stretch  sticky crackle — a stream of tiny band-passed noise grains, the
 *            sound of a surface pulling apart, denser the faster you pull,
 *            over a soft low tearing hiss
 *   squish   muffled low noise with small air-pocket pops while held
 *   poke     a short wet "tck" (two filtered bursts) and a couple of bubbles
 *   release  a downward "shhlp" sweep, a fading trail of crackle as the
 *            surface separates, and one soft suction pop
 *
 * Continuous layers are driven every frame from the simulation, one-shots
 * from interaction events, so the demo sounds like a person playing. The
 * master bus also feeds a MediaStream so recorded clips carry the sound.
 */
export type SlimeSoundEvent =
  | { kind: 'press' }
  | { kind: 'drag' }
  | { kind: 'release'; amount: number }
  | { kind: 'poke'; strength: number };

export interface SlimeFrameState {
  /** largest particle displacement from rest, body radii */
  deformation: number;
  /** rate of change of `deformation`, radii per second */
  deformationSpeed: number;
  /** 'idle' | 'pressing' | 'dragging' (or a demo grab) */
  holding: 'idle' | 'pressing' | 'dragging';
}

interface Texture {
  /** filter brightness multiplier */
  bright: number;
  /** how wet: scales bubble pops */
  wet: number;
  /** how sticky: scales crackle density */
  sticky: number;
  /** overall level */
  level: number;
}

const TEXTURES: Record<PresetId, Texture> = {
  jelly: { bright: 1, wet: 1, sticky: 1, level: 1 },
  chrome: { bright: 1.35, wet: 0.45, sticky: 0.55, level: 0.85 }, // smooth, crisp, little bubbling
  putty: { bright: 0.55, wet: 0.5, sticky: 0.4, level: 1.15 }, // dense, dull, quiet surface
  clear: { bright: 1.2, wet: 1.4, sticky: 1.15, level: 0.95 }, // wettest, most bubbly
};

const MASTER_LEVEL = 1.05;
const MAX_GRAINS_PER_FRAME = 24;
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class SlimeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private noise: AudioBuffer | null = null;
  private analyser: AnalyserNode | null = null;
  // continuous layers
  private tearGain: GainNode | null = null;
  private tearFilter: BiquadFilterNode | null = null;
  private squishGain: GainNode | null = null;
  private squishFilter: BiquadFilterNode | null = null;

  private tex: Texture = TEXTURES.jelly;
  private volume = 0.8;
  private muted = false;
  private lastPoke = -Infinity;
  private lastUpdate = 0;
  /** fractional grains carried between frames */
  private crackleDebt = 0;
  private bubbleDebt = 0;
  /** lingering stickiness after a release, decays to 0 */
  private residual = 0;
  /** counts of one-shots actually voiced (for tests and debugging) */
  readonly stats = { pokes: 0, releases: 0, presses: 0 };

  /** Web Audio needs a user gesture: call from a pointer/key handler. */
  unlock() {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMaster();
  }

  setVolume(v: number) {
    this.volume = clamp01(v);
    this.applyMaster();
  }

  setPreset(id: PresetId) {
    this.tex = TEXTURES[id] ?? TEXTURES.jelly;
  }

  /** A stream carrying the slime's sound, for clip recording. */
  get recordingStream(): MediaStream | null {
    return this.recordDest?.stream ?? null;
  }

  /**
   * Peak level of the master bus over the last ~0.7 s, 0..1. The long window
   * means a brief poke is still caught even if the main thread only gets to
   * look occasionally (tests use this to prove sound is actually made).
   */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** Per-frame: drive the continuous layers and the grain streams. */
  update(state: SlimeFrameState) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.tearGain) return;
    const now = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    const tx = this.tex;
    const speed = Math.abs(state.deformationSpeed);
    const deform = clamp01(state.deformation / 1.6);
    const pulling = state.holding === 'dragging';
    const pressing = state.holding === 'pressing';

    // stretch: a soft low tearing hiss under the crackle
    const pull = pulling ? clamp01(speed / 2.2) : 0;
    this.tearGain!.gain.setTargetAtTime(pull * 0.16 * tx.level, now, 0.06);
    this.tearFilter!.frequency.setTargetAtTime((500 + deform * 900) * tx.bright, now, 0.08);

    // squish: muffled low noise while a press is held
    const squish = pressing ? clamp01(0.3 + speed / 1.2) : 0;
    this.squishGain!.gain.setTargetAtTime(squish * 0.2 * tx.level, now, pressing ? 0.05 : 0.1);
    this.squishFilter!.frequency.setTargetAtTime((220 + deform * 380) * tx.bright, now, 0.08);

    if (this.muted || dt === 0) return;

    // sticky crackle: grains/s rise with pull speed; after a release the
    // surface keeps separating for a moment (residual)
    this.residual *= Math.exp(-dt / 0.35);
    const crackleRate = tx.sticky * (pulling ? 10 + pull * 140 + deform * 25 : 0) + this.residual * 160 * tx.sticky;
    // air pockets: a held press pops a few small bubbles, more while it deepens
    const bubbleRate = tx.wet * (pressing ? 2.5 + clamp01(speed / 1.2) * 18 : pulling ? pull * 4 : 0);

    this.crackleDebt += crackleRate * dt;
    this.bubbleDebt += bubbleRate * dt;
    let n = 0;
    while (this.crackleDebt >= 1 && n < MAX_GRAINS_PER_FRAME) {
      this.crackleDebt -= 1;
      n++;
      this.crackle(now + Math.random() * dt, 0.5 + 0.5 * Math.max(pull, this.residual));
    }
    this.crackleDebt = Math.min(this.crackleDebt, 4);
    while (this.bubbleDebt >= 1) {
      this.bubbleDebt -= 1;
      this.bubble(now + Math.random() * dt, rand(0.35, 0.8));
    }
  }

  /** One-shots from interaction or the demo. */
  play(e: SlimeSoundEvent) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    switch (e.kind) {
      case 'poke':
        this.poke(clamp01(e.strength));
        break;
      case 'release':
        if (e.amount > 0.08) this.shhlp(clamp01(e.amount / 1.6));
        break;
      case 'press':
        this.stats.presses++;
        this.contact(ctx.currentTime, 0.35);
        break;
      case 'drag':
        break;
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }

  // ─── graph ──────────────────────────────────────────────────────────

  private build() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.lastUpdate = ctx.currentTime;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    // a gentle high cut takes the digital edge off every noise source
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 9000;
    tone.Q.value = 0.5;
    this.master.connect(tone).connect(comp);
    comp.connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    comp.connect(this.recordDest);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 32768; // ~0.7 s at 48 kHz
    comp.connect(this.analyser);
    this.applyMaster();

    // two seconds of slightly pinkened noise, shared by every voice
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1;
    let last = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const white = (seed / 2147483647) * 2 - 1;
      last = last * 0.55 + white * 0.45; // tilt away from hiss
      data[i] = last * 1.6;
    }

    // tearing hiss: noise → low-Q band-pass, slowly wandering
    this.tearFilter = ctx.createBiquadFilter();
    this.tearFilter.type = 'bandpass';
    this.tearFilter.Q.value = 1.8;
    this.tearGain = ctx.createGain();
    this.tearGain.gain.value = 0;
    this.loopNoise().connect(this.tearFilter).connect(this.tearGain).connect(this.master);
    const drift = ctx.createOscillator(); // modulates a filter, never heard as a tone
    drift.frequency.value = 0.9;
    const driftAmt = ctx.createGain();
    driftAmt.gain.value = 120;
    drift.connect(driftAmt).connect(this.tearFilter.frequency);
    drift.start();

    // squish: muffled low noise
    this.squishFilter = ctx.createBiquadFilter();
    this.squishFilter.type = 'lowpass';
    this.squishFilter.Q.value = 1.2;
    this.squishGain = ctx.createGain();
    this.squishGain.gain.value = 0;
    this.loopNoise().connect(this.squishFilter).connect(this.squishGain).connect(this.master);
  }

  private applyMaster() {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.volume * MASTER_LEVEL;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.9);
    return src;
  }

  /** A shaped noise burst through one band-pass — the building block. */
  private burst(at: number, freq: number, q: number, dur: number, level: number, sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(freq, at);
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + Math.min(0.002, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(at, Math.random() * 1.85, dur + 0.02);
  }

  /** One sticky micro-pop: a few milliseconds of bright, band-passed noise. */
  private crackle(at: number, intensity: number) {
    const tx = this.tex;
    this.burst(at, rand(1600, 5200) * tx.bright, rand(2.5, 6), rand(0.003, 0.011), rand(0.06, 0.16) * intensity * tx.level);
  }

  /** A small air pocket popping inside the gel: a short resonant noise blip that dips. */
  private bubble(at: number, size: number) {
    const tx = this.tex;
    const f = rand(320, 900) * (1.3 - size * 0.6) * tx.bright;
    this.burst(at, f, rand(5, 10), 0.018 + size * 0.03, (0.1 + size * 0.18) * tx.level, f * 0.7);
  }

  /** The wet contact of a fingertip on the surface. */
  private contact(at: number, level: number) {
    const tx = this.tex;
    this.burst(at, 650 * tx.bright, 1.4, 0.05, level * 0.32 * tx.level);
    this.burst(at, 2300 * tx.bright, 2, 0.02, level * 0.14 * tx.level);
  }

  /** Poke: a short wet "tck" plus a couple of bubbles squeezed out. */
  private poke(strength: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (now - this.lastPoke < 0.04) return; // debounce doubled events
    this.lastPoke = now;
    this.stats.pokes++;
    const tx = this.tex;
    this.contact(now, 0.7 + strength * 0.6);
    // the gel squelching as it is displaced
    this.burst(now + 0.01, 420 * tx.bright, 1.1, 0.09 + strength * 0.06, (0.18 + strength * 0.2) * tx.level, 260 * tx.bright);
    const bubbles = Math.round((1 + strength * 2) * tx.wet);
    for (let i = 0; i < bubbles; i++) this.bubble(now + rand(0.015, 0.11), rand(0.3, 0.75));
    this.residual = Math.max(this.residual, 0.15 * strength);
  }

  /** Release: a downward wet sweep, trailing crackle, and a soft suction pop. */
  private shhlp(amount: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    this.stats.releases++;
    const tx = this.tex;
    const dur = 0.22 + amount * 0.3;
    const peak = (0.2 + 0.3 * amount) * tx.level;
    this.burst(now, 2400 * tx.bright, 2.2, dur, peak, 380 * tx.bright);
    this.burst(now + 0.005, 700 * tx.bright, 1.2, dur * 0.7, peak * 0.6, 240 * tx.bright);
    // suction: the surface letting go, low and short
    this.burst(now + dur * 0.35, 260 * tx.bright, 7, 0.05, peak * 0.7 * tx.wet, 170 * tx.bright);
    // the surface keeps unsticking for a moment
    this.residual = Math.max(this.residual, 0.4 + amount * 0.6);
  }
}
