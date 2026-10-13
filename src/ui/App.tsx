import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlimeApp, type SlimeSettings } from '../engine/SlimeApp.ts';
import { ClipRecorder, downloadBlob, timestampedName } from '../engine/capture.ts';
import { DEMO_DURATION } from '../engine/demo.ts';
import { BACKDROPS, type PresetId } from '../render/presets.ts';
import { loadSoundPref, readPageOptions, saveSoundPref, settingsForPreset } from './settings.ts';
import { PlayBar } from './PlayBar.tsx';
import { StudioPanel } from './StudioPanel.tsx';

const CLIP_SECONDS = 8;
const TOAST_MS = 3200;

export function App() {
  const page = useMemo(() => readPageOptions(window.location.search), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<SlimeApp | null>(null);
  const [settings, setSettings] = useState<SlimeSettings>(page.initial);
  const [studioOpen, setStudioOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [clean, setClean] = useState(false);
  const [recording, setRecording] = useState<{ started: number; kind: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [sound, setSound] = useState(() => {
    const saved = loadSoundPref();
    return { on: page.soundOff ? false : (saved?.on ?? true), volume: saved?.volume ?? 0.8 };
  });
  const canRecord = useMemo(() => ClipRecorder.isSupported(), []);
  const touchFirst = useMemo(() => window.matchMedia?.('(pointer: coarse)').matches ?? false, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let app: SlimeApp;
    try {
      app = new SlimeApp(host, page.initial, { adaptiveQuality: !page.fixedResolution });
    } catch (err) {
      console.error('Iris: could not start WebGL', err);
      setFailed('This experiment needs WebGL 2. Try a recent desktop or mobile browser.');
      return;
    }
    appRef.current = app;
    app.setSound(sound.on);
    app.setVolume(sound.volume);
    app.onFirstTouch = () => setHintVisible(false);
    app.onDemoChange = (running) => setDemoRunning(running);
    (window as unknown as { __iris?: SlimeApp }).__iris = app;
    return () => {
      app.dispose();
      appRef.current = null;
    };
  }, [page]);

  useEffect(() => {
    appRef.current?.apply(settings);
  }, [settings]);

  useEffect(() => {
    appRef.current?.setSound(sound.on);
    appRef.current?.setVolume(sound.volume);
    if (!page.soundOff) saveSoundPref(sound);
  }, [sound, page]);

  useEffect(() => {
    appRef.current?.setPanelOpen(studioOpen && !clean && !recording);
  }, [studioOpen, clean, recording]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((performance.now() - recording.started) / 1000), 100);
    return () => clearInterval(id);
  }, [recording]);

  const choosePreset = useCallback((id: PresetId) => {
    setSettings((s) => settingsForPreset(id, s.background));
  }, []);

  const reset = useCallback(() => appRef.current?.reset(), []);

  const screenshot = useCallback(async () => {
    const app = appRef.current;
    if (!app) return;
    try {
      const blob = await app.screenshot();
      const name = timestampedName('still', 'png');
      downloadBlob(blob, name);
      setToast(`Saved ${name}`);
    } catch (err) {
      console.error(err);
      setToast('Screenshot failed');
    }
  }, []);

  const record = useCallback(async (kind: 'clip' | 'demo') => {
    const app = appRef.current;
    if (!app || app.recording) return;
    setStudioOpen(false);
    const seconds = kind === 'demo' ? DEMO_DURATION + 0.6 : CLIP_SECONDS;
    try {
      const done = app.startRecording(seconds, kind);
      setRecording({ started: performance.now(), kind });
      setElapsed(0);
      if (kind === 'demo') app.playDemo();
      const clip = await done;
      downloadBlob(clip.blob, clip.filename);
      setToast(`Saved ${clip.filename}`);
    } catch (err) {
      console.error(err);
      setToast(err instanceof Error ? err.message : 'Recording failed');
    } finally {
      setRecording(null);
    }
  }, []);

  const playDemo = useCallback(() => {
    setStudioOpen(false);
    setHintVisible(false);
    appRef.current?.playDemo();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'Escape':
          if (clean) setClean(false);
          else setStudioOpen(false);
          break;
        case 'h': case 'H':
          setClean((c) => !c);
          break;
        case 'r': case 'R':
          reset();
          break;
        case 'd': case 'D':
          playDemo();
          break;
        case 'm': case 'M':
          setSound((v) => ({ ...v, on: !v.on }));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clean, reset, playDemo]);

  const ink = BACKDROPS[settings.background].ink;
  const chrome = !clean && !recording;
  const showBar = chrome && (!page.embed || page.controls);

  return (
    <div className={`stage-root ink-${ink} ${page.embed ? 'is-embed' : ''}`} data-clean={clean || undefined}>
      <div className="canvas-host" ref={hostRef} />

      {failed && <p className="fallback">{failed}</p>}

      {chrome && !page.embed && (
        <header className="wordmark">
          <h1>
            <span>IRIS</span>
            <span className="wordmark__slash" aria-hidden>/</span>
            <span>SOFT MATTER</span>
          </h1>
          <p>An experiment in digital tactility.</p>
        </header>
      )}

      <p className={`hint ${hintVisible && !demoRunning && chrome ? '' : 'is-hidden'}`} aria-live="polite">
        {touchFirst ? 'Drag to stretch. Tap to poke.' : 'Drag to stretch. Click to poke.'}
      </p>

      {showBar && (
        <PlayBar
          preset={settings.preset}
          studioOpen={studioOpen}
          canRecord={canRecord}
          onPreset={choosePreset}
          onToggleStudio={() => setStudioOpen((o) => !o)}
          onReset={reset}
          onScreenshot={screenshot}
          onRecord={() => record('clip')}
          onRecordDemo={() => record('demo')}
          onCleanView={() => setClean(true)}
          soundOn={sound.on}
          onToggleSound={() => setSound((v) => ({ ...v, on: !v.on }))}
        />
      )}

      {!page.embed && (
        <StudioPanel
          open={studioOpen && chrome}
          settings={settings}
          onChange={setSettings}
          onPreset={choosePreset}
          onClose={() => setStudioOpen(false)}
          onDemo={playDemo}
          soundOn={sound.on}
          volume={sound.volume}
          onSound={(on) => setSound((v) => ({ ...v, on }))}
          onVolume={(volume) => setSound((v) => ({ ...v, volume, on: volume > 0 ? true : v.on }))}
        />
      )}

      {recording && (
        <div className="rec" role="status">
          <span className="rec__dot" aria-hidden />
          REC {elapsed.toFixed(1)}s
          <button className="text-btn" onClick={() => appRef.current?.stopRecording()}>Stop</button>
        </div>
      )}

      {clean && !recording && (
        <button className="clean-exit" onClick={() => setClean(false)}>Show interface</button>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
