import type { PresetId } from '../render/presets.ts';

/**
 * Procedural slime foley, synthesised live with Web Audio — no samples.
 *
 *   stretch  band-passed noise + a creaky triangle "taffy" tone; loudness
 *            follows how fast the body is deforming, pitch how far it is
 *   squish   low, muffled noise while a press is held
 *   poke     a wet "bloop": a rising sine chirp with a soft click
 *   release  a "slurp-boing": a falling, wobbling glide sized by the stretch
 *
 * The continuous layers are driven every frame from simulation state, the
 * one-shots from interaction events, so the demo sounds exactly like a
 * person playing. Everything routes through one master bus, which can also
 * feed a MediaStream so recorded clips carry the sound.
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

interface Timbre {
  /** pitch multiplier */
  pitch: number;
  /** filter brightness multiplier */
  bright: number;
  /** extra metallic partial (0 = none) */
  ring: number;
  /** wobble depth on release */
  wobble: number;
  /** overall level */
  level: number;
}

const TIMBRES: Record<PresetId, Timbre> = {
  jelly: { pitch: 1, bright: 1, ring: 0, wobble: 1, level: 1 },
  chrome: { pitch: 1.55, bright: 1.4, ring: 0.5, wobble: 0.8, level: 0.85 },
  putty: { pitch: 0.68, bright: 0.5, ring: 0, wobble: 0.35, level: 1.1 },
  clear: { pitch: 1.2, bright: 1.3, ring: 0.15, wobble: 1.2, level: 0.95 },
};

const MASTER_LEVEL = 0.55;
const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export class SlimeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private noise: AudioBuffer | null = null;
  private analyser: AnalyserNode | null = null;
  // continuous layers
  private stretchGain: GainNode | null = null;
  private stretchFilter: BiquadFilterNode | null = null;
  private taffyOsc: OscillatorNode | null = null;
  private taffyGain: GainNode | null = null;
  private squishGain: GainNode | null = null;
  private squishFilter: BiquadFilterNode | null = null;

  private timbre: Timbre = TIMBRES.jelly;
  private volume = 0.8;
  private muted = false;
  private lastPoke = -Infinity;
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
    this.timbre = TIMBRES[id] ?? TIMBRES.jelly;
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

  /** Per-frame: drive the continuous stretch and squish layers. */
  update(state: SlimeFrameState) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.stretchGain) return;
    const t = ctx.currentTime;
    const tb = this.timbre;
    const speed = Math.abs(state.deformationSpeed);
    const holding = state.holding !== 'idle';

    // stretch: only while something is pulling, loudness ∝ how fast it moves
    const pulling = state.holding === 'dragging';
    const stretchAmt = pulling ? clamp01(speed / 2.2) : 0;
    const deform = clamp01(state.deformation / 1.6);
    this.stretchGain!.gain.setTargetAtTime(stretchAmt * 0.5 * tb.level, t, 0.05);
    this.stretchFilter!.frequency.setTargetAtTime((380 + deform * 1500) * tb.bright, t, 0.06);
    this.taffyOsc!.frequency.setTargetAtTime((70 + deform * 210) * tb.pitch, t, 0.08);
    this.taffyGain!.gain.setTargetAtTime(stretchAmt * deform * 0.13 * tb.level, t, 0.06);

    // squish: a held press, louder while the dent is still deepening
    const squish = state.holding === 'pressing' ? clamp01(0.25 + speed / 1.2) : 0;
    this.squishGain!.gain.setTargetAtTime(squish * 0.22 * tb.level, t, holding ? 0.05 : 0.12);
    this.squishFilter!.frequency.setTargetAtTime((240 + deform * 500) * tb.bright, t, 0.08);
  }

  /** One-shots from interaction or the demo. */
  play(e: SlimeSoundEvent) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    switch (e.kind) {
      case 'poke':
        this.bloop(clamp01(e.strength));
        break;
      case 'release':
        if (e.amount > 0.08) this.slurp(clamp01(e.amount / 1.6));
        break;
      case 'press':
        this.stats.presses++;
        this.tick(0.35);
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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    comp.connect(this.recordDest);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 32768; // ~0.7 s at 48 kHz
    comp.connect(this.analyser);
    this.applyMaster();

    // two seconds of white noise, looped by every noise voice
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }

    // stretch: noise → resonant band-pass (gooey creak) + taffy triangle
    const sNoise = this.loopNoise();
    this.stretchFilter = ctx.createBiquadFilter();
    this.stretchFilter.type = 'bandpass';
    this.stretchFilter.Q.value = 7;
    this.stretchGain = ctx.createGain();
    this.stretchGain.gain.value = 0;
    sNoise.connect(this.stretchFilter).connect(this.stretchGain).connect(this.master);
    // a slow wobble on the band keeps the creak organic
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7.5;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 140;
    lfo.connect(lfoAmt).connect(this.stretchFilter.frequency);
    lfo.start();

    this.taffyOsc = ctx.createOscillator();
    this.taffyOsc.type = 'triangle';
    this.taffyOsc.frequency.value = 80;
    const taffyLp = ctx.createBiquadFilter();
    taffyLp.type = 'lowpass';
    taffyLp.frequency.value = 900;
    this.taffyGain = ctx.createGain();
    this.taffyGain.gain.value = 0;
    this.taffyOsc.connect(taffyLp).connect(this.taffyGain).connect(this.master);
    this.taffyOsc.start();

    // squish: muffled low noise
    const qNoise = this.loopNoise();
    this.squishFilter = ctx.createBiquadFilter();
    this.squishFilter.type = 'lowpass';
    this.squishFilter.Q.value = 3;
    this.squishGain = ctx.createGain();
    this.squishGain.gain.value = 0;
    qNoise.connect(this.squishFilter).connect(this.squishGain).connect(this.master);
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
    // start each loop at a different offset so layers don't correlate
    src.start(0, Math.random() * 1.9);
    return src;
  }

  /** Short filtered noise burst — the wet contact click under every one-shot. */
  private tick(level: number, at = this.ctx!.currentTime) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 * this.timbre.bright;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level * 0.18 * this.timbre.level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(at, Math.random() * 1.8, 0.08);
  }

  /** Poke: a water-drop style rising chirp with a fast decay. */
  private bloop(strength: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (now - this.lastPoke < 0.04) return; // debounce doubled events
    this.lastPoke = now;
    this.stats.pokes++;
    const tb = this.timbre;
    const base = (170 + Math.random() * 40) * tb.pitch;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * (2.6 + strength), now + 0.07);
    const g = ctx.createGain();
    const peak = (0.25 + 0.45 * strength) * tb.level;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(g).connect(this.master!);
    osc.start(now);
    osc.stop(now + 0.25);
    if (tb.ring > 0) this.ring(base * 2.76, tb.ring * peak * 0.5, now, 0.6);
    this.tick(0.6 + strength * 0.4, now);
  }

  /** Release: a falling glide with a decaying wobble — the slime recoiling. */
  private slurp(amount: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    this.stats.releases++;
    const tb = this.timbre;
    const top = (300 + amount * 260) * tb.pitch;
    const dur = 0.3 + amount * 0.35;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(top, now);
    osc.frequency.exponentialRampToValueAtTime(top * 0.32, now + dur);
    // boing: vibrato that fades as the wobble settles
    const vib = ctx.createOscillator();
    vib.frequency.value = 7 + amount * 3;
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(top * 0.09 * tb.wobble, now);
    vibAmt.gain.exponentialRampToValueAtTime(0.01, now + dur);
    vib.connect(vibAmt).connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 * tb.bright;
    const g = ctx.createGain();
    const peak = (0.18 + 0.32 * amount) * tb.level;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(now);
    vib.start(now);
    osc.stop(now + dur + 0.05);
    vib.stop(now + dur + 0.05);

    // the wet "shhlp" of the surface pulling back
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(2200 * tb.bright, now);
    bp.frequency.exponentialRampToValueAtTime(350 * tb.bright, now + dur * 0.8);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(peak * 0.7, now + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.8);
    src.connect(bp).connect(ng).connect(this.master!);
    src.start(now, Math.random() * 1.2, dur);
    if (tb.ring > 0) this.ring(top * 1.9, tb.ring * peak * 0.4, now, 0.9);
  }

  /** A struck metallic partial (chrome / glass). */
  private ring(freq: number, level: number, at: number, decay: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(g).connect(this.master!);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}
