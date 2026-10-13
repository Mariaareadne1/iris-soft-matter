import { PRESETS, PRESET_ORDER, BACKDROP_ORDER, type BackgroundId, type PresetId } from '../render/presets.ts';
import type { SlimeSettings } from '../engine/SlimeApp.ts';

export function settingsForPreset(id: PresetId, background: BackgroundId): SlimeSettings {
  const p = PRESETS[id];
  return {
    preset: id,
    color: p.color,
    iridescence: p.iridescence,
    gloss: p.gloss,
    background,
    behavior: { ...p.behavior },
  };
}

export interface PageOptions {
  embed: boolean;
  /** show the play bar even when embedded */
  controls: boolean;
  /** disable adaptive resolution (deterministic pixels for tests/recording) */
  fixedResolution: boolean;
  /** start with sound off (`?sound=0`) */
  soundOff: boolean;
  initial: SlimeSettings;
}

const isPreset = (v: string | null): v is PresetId => !!v && (PRESET_ORDER as string[]).includes(v);
const isBackdrop = (v: string | null): v is BackgroundId => !!v && (BACKDROP_ORDER as string[]).includes(v);

/** `?embed=1&material=chrome&bg=porcelain&controls=1` */
export function readPageOptions(search: string): PageOptions {
  const q = new URLSearchParams(search);
  const flag = (k: string) => ['1', 'true', 'yes'].includes((q.get(k) ?? '').toLowerCase());
  const material = q.get('material');
  const bg = q.get('bg');
  return {
    embed: flag('embed'),
    controls: flag('controls'),
    fixedResolution: flag('fixedres'),
    soundOff: ['0', 'false', 'off', 'no'].includes((q.get('sound') ?? '').toLowerCase()),
    initial: settingsForPreset(isPreset(material) ? material : 'jelly', isBackdrop(bg) ? bg : 'nocturne'),
  };
}

const SOUND_KEY = 'iris-soft-matter:sound';

/** Per-viewer sound preference; storage can be unavailable, so never throw. */
export function loadSoundPref(): { on: boolean; volume: number } | null {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { on?: unknown; volume?: unknown };
    if (typeof v.on !== 'boolean' || typeof v.volume !== 'number') return null;
    return { on: v.on, volume: Math.min(1, Math.max(0, v.volume)) };
  } catch {
    return null;
  }
}

export function saveSoundPref(pref: { on: boolean; volume: number }) {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(pref));
  } catch {
    /* private mode / blocked storage: preference just isn't remembered */
  }
}
