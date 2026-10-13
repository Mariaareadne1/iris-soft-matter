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
    initial: settingsForPreset(isPreset(material) ? material : 'jelly', isBackdrop(bg) ? bg : 'nocturne'),
  };
}
