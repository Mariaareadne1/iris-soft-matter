import type { SlimeBehavior } from '../sim/params.ts';

export type PresetId = 'jelly' | 'chrome' | 'putty' | 'clear';

/** Optical recipe for one material; `gloss` and `iridescence` scale it. */
export interface MaterialRecipe {
  metalness: number;
  /** roughness at gloss 0 → gloss 1 */
  roughness: [number, number];
  transmission: number;
  thickness: number;
  ior: number;
  attenuationDistance: number;
  clearcoat: number;
  sheen: number;
  sheenColor: string;
  /** thin-film iridescence at full Iridescence */
  iridescence: number;
  /** strength of the holographic film colour at full Iridescence */
  holo: number;
  dispersion: number;
  /** how strongly the base colour tints the body (vs. staying near-white) */
  tint: number;
  envIntensity: number;
}

export interface Preset {
  id: PresetId;
  label: string;
  color: string;
  iridescence: number;
  gloss: number;
  behavior: SlimeBehavior;
  recipe: MaterialRecipe;
  /** swatch gradient for the UI */
  swatch: string;
}

export const PRESETS: Record<PresetId, Preset> = {
  jelly: {
    id: 'jelly',
    label: 'Holographic Jelly',
    color: '#b8a6ff',
    iridescence: 0.85,
    gloss: 0.85,
    behavior: { stretchiness: 0.62, viscosity: 0.45, softness: 0.55, wobble: 0.6, recovery: 0.45 },
    recipe: {
      metalness: 0,
      roughness: [0.42, 0.04],
      transmission: 0.62,
      thickness: 2.2,
      ior: 1.38,
      attenuationDistance: 0.75,
      clearcoat: 1,
      sheen: 0.45,
      sheenColor: '#ffc8f0',
      iridescence: 1,
      holo: 1,
      dispersion: 0.25,
      tint: 0.85,
      envIntensity: 1.1,
    },
    swatch: 'conic-gradient(from 200deg, #b8a6ff, #8fd8ff, #ffb3e6, #b8a6ff)',
  },
  chrome: {
    id: 'chrome',
    label: 'Liquid Chrome',
    color: '#d7dbe6',
    iridescence: 0.45,
    gloss: 0.92,
    behavior: { stretchiness: 0.4, viscosity: 0.32, softness: 0.3, wobble: 0.78, recovery: 0.66 },
    recipe: {
      metalness: 1,
      roughness: [0.38, 0.03],
      transmission: 0,
      thickness: 0,
      ior: 1.5,
      attenuationDistance: Infinity,
      clearcoat: 0.6,
      sheen: 0,
      sheenColor: '#ffffff',
      iridescence: 0.75,
      holo: 0.35,
      dispersion: 0,
      tint: 1,
      envIntensity: 1.25,
    },
    swatch: 'linear-gradient(135deg, #f6f7fb, #8d93a6 45%, #e9ecf4 60%, #6b7085)',
  },
  putty: {
    id: 'putty',
    label: 'Pastel Putty',
    color: '#f3b9cf',
    iridescence: 0.25,
    gloss: 0.3,
    behavior: { stretchiness: 0.74, viscosity: 0.82, softness: 0.72, wobble: 0.14, recovery: 0.22 },
    recipe: {
      metalness: 0,
      roughness: [0.82, 0.32],
      transmission: 0,
      thickness: 0,
      ior: 1.45,
      attenuationDistance: Infinity,
      clearcoat: 0.25,
      sheen: 0.9,
      sheenColor: '#fff3f8',
      iridescence: 0.35,
      holo: 0.3,
      dispersion: 0,
      tint: 1,
      envIntensity: 0.9,
    },
    swatch: 'radial-gradient(circle at 35% 30%, #fde3ee, #f3b9cf 55%, #d895b3)',
  },
  clear: {
    id: 'clear',
    label: 'Clear Slime',
    color: '#bfeaff',
    iridescence: 0.4,
    gloss: 1,
    behavior: { stretchiness: 0.82, viscosity: 0.36, softness: 0.62, wobble: 0.84, recovery: 0.4 },
    recipe: {
      metalness: 0,
      roughness: [0.2, 0.0],
      transmission: 1,
      thickness: 1.9,
      ior: 1.42,
      attenuationDistance: 3.2,
      clearcoat: 1,
      sheen: 0,
      sheenColor: '#ffffff',
      iridescence: 0.5,
      holo: 0.35,
      dispersion: 0.6,
      tint: 0.6,
      envIntensity: 1.2,
    },
    swatch: 'radial-gradient(circle at 35% 30%, #ffffff, #d9f4ff 45%, #9fd6f0)',
  },
};

export const PRESET_ORDER: PresetId[] = ['jelly', 'chrome', 'putty', 'clear'];

export type BackgroundId = 'nocturne' | 'porcelain' | 'dusk' | 'void';

export interface Backdrop {
  id: BackgroundId;
  label: string;
  top: string;
  bottom: string;
  /** soft colour haze behind the blob — gives the jelly something to refract */
  glow: string;
  glowStrength: number;
  /** contact shadow colour + opacity */
  shadow: string;
  shadowOpacity: number;
  exposure: number;
  /** text colour for the UI over this backdrop */
  ink: 'light' | 'dark';
}

export const BACKDROPS: Record<BackgroundId, Backdrop> = {
  nocturne: {
    id: 'nocturne', label: 'Nocturne',
    top: '#16141d', bottom: '#060609', glow: '#5a4f8a', glowStrength: 0.32,
    shadow: '#000000', shadowOpacity: 0.55, exposure: 1.0, ink: 'light',
  },
  porcelain: {
    id: 'porcelain', label: 'Porcelain',
    top: '#f3f1f6', bottom: '#d9d6e2', glow: '#c9b8ff', glowStrength: 0.35,
    shadow: '#3b3350', shadowOpacity: 0.28, exposure: 0.95, ink: 'dark',
  },
  dusk: {
    id: 'dusk', label: 'Dusk',
    top: '#2a2148', bottom: '#120f1f', glow: '#ff8fc8', glowStrength: 0.45,
    shadow: '#05040a', shadowOpacity: 0.5, exposure: 1.05, ink: 'light',
  },
  void: {
    id: 'void', label: 'Void',
    top: '#040405', bottom: '#000000', glow: '#2b3b7a', glowStrength: 0.25,
    shadow: '#000000', shadowOpacity: 0.6, exposure: 1.0, ink: 'light',
  },
};

export const BACKDROP_ORDER: BackgroundId[] = ['nocturne', 'porcelain', 'dusk', 'void'];
