import { useEffect, useRef, useState } from 'react';
import { PRESETS, PRESET_ORDER, type PresetId } from '../render/presets.ts';
import { IconCapture, IconEye, IconPlay, IconRecord, IconReset, IconSliders, IconStill } from './icons.tsx';

interface Props {
  preset: PresetId;
  studioOpen: boolean;
  canRecord: boolean;
  onPreset: (id: PresetId) => void;
  onToggleStudio: () => void;
  onReset: () => void;
  onScreenshot: () => void;
  onRecord: () => void;
  onRecordDemo: () => void;
  onCleanView: () => void;
}

export function PlayBar(p: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  const pick = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <nav className="playbar" aria-label="Controls">
      <div className="materials" role="radiogroup" aria-label="Material">
        {PRESET_ORDER.map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={p.preset === id}
            aria-label={PRESETS[id].label}
            className={`material ${p.preset === id ? 'is-active' : ''}`}
            onClick={() => p.onPreset(id)}
            title={PRESETS[id].label}
          >
            <span className="material__dot" style={{ background: PRESETS[id].swatch }} />
          </button>
        ))}
        <span className="materials__name" aria-hidden>{PRESETS[p.preset].label}</span>
      </div>
      <span className="playbar__rule" aria-hidden />
      <button className={`bar-btn ${p.studioOpen ? 'is-active' : ''}`} onClick={p.onToggleStudio} aria-expanded={p.studioOpen} aria-label="Customize">
        <IconSliders /> <span>Customize</span>
      </button>
      <button className="bar-btn" onClick={p.onReset} aria-label="Reset">
        <IconReset /> <span>Reset</span>
      </button>
      <div className="capture" ref={menuRef}>
        <button className={`bar-btn ${menuOpen ? 'is-active' : ''}`} onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Capture">
          <IconCapture /> <span>Capture</span>
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button role="menuitem" onClick={pick(p.onScreenshot)}><IconStill /> Screenshot <kbd>PNG</kbd></button>
            <button role="menuitem" onClick={pick(p.onRecord)} disabled={!p.canRecord}><IconRecord /> Record 8s clip</button>
            <button role="menuitem" onClick={pick(p.onRecordDemo)} disabled={!p.canRecord}><IconPlay /> Record demo</button>
            <button role="menuitem" onClick={pick(p.onCleanView)}><IconEye /> Clean view <kbd>H</kbd></button>
          </div>
        )}
      </div>
    </nav>
  );
}
