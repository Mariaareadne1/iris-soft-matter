/**
 * Keeps the slime smooth on slower GPUs: watches a smoothed frame time and
 * steps the render resolution down when frames run long, back up when
 * there is headroom. Physics is unaffected (it runs on fixed substeps).
 */
const SLOW_MS = 24; // below ~42 fps
const FAST_MS = 13; // above ~75 fps-equivalent headroom
const SLOW_HOLD_S = 1.5;
const FAST_HOLD_S = 5;
const MIN_RATIO = 0.75;
const STEP = 0.75; // multiplicative step

export class AdaptiveQuality {
  private avgMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private warmup = 1.5; // ignore shader-compile hitches right after start
  /** frozen while recording or exporting so output stays consistent */
  frozen = false;

  constructor(
    private getRatio: () => number,
    private getMax: () => number,
    private setRatio: (r: number) => void,
  ) {}

  /** @param frameSeconds unclamped wall time of the last frame */
  update(frameSeconds: number) {
    if (this.warmup > 0) {
      this.warmup -= frameSeconds;
      return;
    }
    // a hidden tab returns one huge frame; don't treat that as slowness
    if (frameSeconds > 0.25) return;
    this.avgMs += (frameSeconds * 1000 - this.avgMs) * 0.08;
    if (this.frozen) return;
    const ratio = this.getRatio();
    if (this.avgMs > SLOW_MS) {
      this.slowFor += frameSeconds;
      this.fastFor = 0;
      if (this.slowFor > SLOW_HOLD_S && ratio > MIN_RATIO) {
        this.setRatio(Math.max(MIN_RATIO, ratio * STEP));
        this.slowFor = 0;
        this.warmup = 0.5;
      }
    } else if (this.avgMs < FAST_MS) {
      this.fastFor += frameSeconds;
      this.slowFor = 0;
      const max = this.getMax();
      if (this.fastFor > FAST_HOLD_S && ratio < max) {
        this.setRatio(Math.min(max, ratio / STEP));
        this.fastFor = 0;
        this.warmup = 0.5;
      }
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
  }

  get averageFrameMs() {
    return this.avgMs;
  }
}
