/**
 * Human-facing behaviour controls, all in 0..1. The simulation converts
 * them into physical coefficients (see `deriveCoefficients`), so the UI
 * never has to speak in compliances or damping ratios.
 */
export interface SlimeBehavior {
  /** how far a pulled region extends before the body follows (edge compliance) */
  stretchiness: number;
  /** resistance to motion — thick and slow at 1, runny at 0 */
  viscosity: number;
  /** how deeply it dents and how much it gives under pressure */
  softness: number;
  /** springy overshoot when it recovers, vs. a calm creep back */
  wobble: number;
  /** how quickly it returns to its resting shape */
  recovery: number;
}

export interface PhysicalCoefficients {
  /** velocity retained per 60 Hz frame */
  damping60: number;
  /** XPBD compliance of the surface edges */
  edgeCompliance: number;
  /** XPBD compliance of the global volume constraint */
  volumeCompliance: number;
  /** shape-matching pull per 60 Hz frame */
  shapeMatch60: number;
  /** fraction of the shape-matching pull that builds velocity (springiness) */
  elasticFraction: number;
  /** grab/press region radius, in body radii */
  grabRadius: number;
  /** deepest a press can dent the surface, in body radii */
  maxPressDepth: number;
  /** laplacian surface tension per substep */
  surfaceTension: number;
  /** distance from the centre where a pull starts to meet resistance */
  softReach: number;
  /** distance from the centre a pull can never exceed */
  maxReach: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function deriveCoefficients(raw: SlimeBehavior): PhysicalCoefficients {
  const b = sanitizeBehavior(raw);
  return {
    damping60: 1 - lerp(0.03, 0.22, b.viscosity),
    edgeCompliance: Math.pow(10, lerp(-5.6, -2.2, b.stretchiness)),
    volumeCompliance: lerp(0, 5e-5, b.softness * b.softness),
    shapeMatch60: lerp(0.006, 0.07, Math.pow(b.recovery, 1.4)),
    elasticFraction: lerp(0.08, 0.92, b.wobble),
    grabRadius: lerp(0.42, 0.68, b.softness),
    maxPressDepth: lerp(0.22, 0.5, b.softness),
    surfaceTension: lerp(0.05, 0.025, b.softness),
    softReach: lerp(1.25, 2.5, b.stretchiness),
    maxReach: lerp(1.9, 3.8, b.stretchiness),
  };
}

export function sanitizeBehavior(b: SlimeBehavior): SlimeBehavior {
  return {
    stretchiness: clamp01(b.stretchiness),
    viscosity: clamp01(b.viscosity),
    softness: clamp01(b.softness),
    wobble: clamp01(b.wobble),
    recovery: clamp01(b.recovery),
  };
}

export const DEFAULT_BEHAVIOR: SlimeBehavior = {
  stretchiness: 0.62,
  viscosity: 0.45,
  softness: 0.55,
  wobble: 0.6,
  recovery: 0.45,
};
