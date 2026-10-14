import { useEffect, useRef } from 'react';
import type { SlimeSettings } from '../engine/SlimeApp.ts';
import type { SlimeBehavior } from '../sim/params.ts';
import { BACKDROPS, BACKDROP_ORDER, PRESETS, PRESET_ORDER, type BackgroundId, type PresetId } from '../render/presets.ts';
import { IconClose, IconPlay } from './icons.tsx';

interface Props {
  open: boolean;
  settings: SlimeSettings;
  onChange: (next: SlimeSettings) => void;
  onPreset: (id: PresetId) => void;
  onClose: () => void;
  onDemo: () => void;
  soundOn: boolean;
  volume: number;
  onSound: (on: boolean) => void;
  onVolume: (v: number) => void;
}

const BEHAVIOR_CONTROLS: { key: keyof SlimeBehavior; label: string; low: string; high: string }[] = [
  { key: 'stretchiness', label: 'Stretchiness', low: 'Firm', high: 'Taffy' },
  { key: 'viscosity', label: 'Viscosity', low: 'Runny', high: 'Thick' },
  { key: 'softness', label: 'Softness', low: 'Bouncy', high: 'Squishy' },
  { key: 'wobble', label: 'Wobble', low: 'Calm', high: 'Jiggly' },
  { key: 'recovery', label: 'Recovery speed', low: 'Lazy', high: 'Snappy' },
];

const SWATCHES = ['#a58cff', '#8fb8ff', '#7fe6ff', '#ff9fd6', '#f3b9cf', '#f7e7a3', '#d7dbe6', '#bfeaff', '#c6f7c9'];

export function StudioPanel({ open, settings, onChange, onPreset, onClose, onDemo, soundOn, volume, onSound, onVolume }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const setBehavior = (key: keyof SlimeBehavior, v: number) =>
    onChange({ ...settings, behavior: { ...settings.behavior, [key]: v } });

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <aside
      ref={panelRef}
      className={`studio ${open ? 'is-open' : ''}`}
      aria-label="Studio controls"
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
    >
      <header className="studio__head">
        <div>
          <p className="eyebrow">Studio</p>
          <h2 className="studio__title">{PRESETS[settings.preset].label}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close studio">
          <IconClose />
        </button>
      </header>

      <section className="studio__section">
        <h3 className="label">Material</h3>
        <div className="chips">
          {PRESET_ORDER.map((id) => (
            <button
              key={id}
              className={`chip ${settings.preset === id ? 'is-active' : ''}`}
              onClick={() => onPreset(id)}
              aria-pressed={settings.preset === id}
            >
              <span className="chip__swatch" style={{ background: PRESETS[id].swatch }} />
              {PRESETS[id].label}
            </button>
          ))}
        </div>
      </section>

      <section className="studio__section">
        <h3 className="label">Color</h3>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {SWATCHES.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={settings.color.toLowerCase() === c}
              aria-label={c}
              className={`swatch ${settings.color.toLowerCase() === c ? 'is-active' : ''}`}
              style={{ background: c }}
              onClick={() => onChange({ ...settings, color: c })}
            />
          ))}
          <label className="swatch swatch--custom" title="Custom color">
            <input
              type="color"
              value={settings.color}
              onChange={(e) => onChange({ ...settings, color: e.target.value })}
              aria-label="Custom color"
            />
          </label>
        </div>
      </section>

      <section className="studio__section">
        <h3 className="label">Behavior</h3>
        {BEHAVIOR_CONTROLS.map((c) => (
          <Slider
            key={c.key}
            id={`b-${c.key}`}
            label={c.label}
            low={c.low}
            high={c.high}
            value={settings.behavior[c.key]}
            onChange={(v) => setBehavior(c.key, v)}
          />
        ))}
      </section>

      <section className="studio__section">
        <h3 className="label">Surface</h3>
        <Slider id="l-irid" label="Iridescence" low="Plain" high="Holo" value={settings.iridescence}
          onChange={(v) => onChange({ ...settings, iridescence: v })} />
        <Slider id="l-gloss" label="Gloss" low="Satin" high="Wet" value={settings.gloss}
          onChange={(v) => onChange({ ...settings, gloss: v })} />
      </section>

      <section className="studio__section">
        <h3 className="label">Sound</h3>
        <label className="toggle">
          <input type="checkbox" checked={soundOn} onChange={(e) => onSound(e.target.checked)} />
          <span>Slime sounds</span>
        </label>
        <Slider id="s-volume" label="Volume" low="Quiet" high="Loud" value={volume} onChange={onVolume} />
      </section>

      <section className="studio__section">
        <h3 className="label">Background</h3>
        <div className="chips chips--bg">
          {BACKDROP_ORDER.map((id: BackgroundId) => (
            <button
              key={id}
              className={`chip ${settings.background === id ? 'is-active' : ''}`}
              onClick={() => onChange({ ...settings, background: id })}
              aria-pressed={settings.background === id}
            >
              <span className="chip__swatch" style={{ background: `linear-gradient(${BACKDROPS[id].top}, ${BACKDROPS[id].bottom})` }} />
              {BACKDROPS[id].label}
            </button>
          ))}
        </div>
      </section>

      <footer className="studio__foot">
        <button className="text-btn" onClick={() => onPreset(settings.preset)}>Restore preset</button>
        <button className="text-btn text-btn--accent" onClick={onDemo}>
          <IconPlay /> Show demo
        </button>
      </footer>
    </aside>
  );
}

interface SliderProps {
  id: string;
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (v: number) => void;
}

function Slider({ id, label, low, high, value, onChange }: SliderProps) {
  const pct = Math.round(value * 100);
  return (
    <div className="slider">
      <div className="slider__row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{pct}</output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-valuetext={`${pct} — ${value < 0.5 ? low : high}`}
      />
      <div className="slider__ends" aria-hidden>
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}
