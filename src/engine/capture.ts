/**
 * Stills and clips straight from the WebGL canvas. Video uses MediaRecorder
 * with whatever container the browser can actually encode — MP4 where
 * supported (Safari, recent Chromium), otherwise WebM — and the file gets
 * the matching extension, never a mislabeled one.
 */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickVideoMimeType(
  isSupported: (t: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
): string | null {
  return VIDEO_TYPES.find((t) => isSupported(t)) ?? null;
}

export function extensionFor(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export function timestampedName(kind: string, ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `iris-soft-matter-${kind}-${stamp}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png');
  });
}

export interface ClipResult {
  blob: Blob;
  mimeType: string;
  filename: string;
}

export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopTimer: number | null = null;
  private resolveDone: ((r: ClipResult) => void) | null = null;
  private rejectDone: ((e: Error) => void) | null = null;

  static isSupported() {
    return typeof MediaRecorder !== 'undefined' && pickVideoMimeType() !== null &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get recording() {
    return this.recorder !== null;
  }

  /** Starts recording; the promise settles once the clip is finalised. */
  start(canvas: HTMLCanvasElement, maxSeconds: number, kind = 'clip'): Promise<ClipResult> {
    if (this.recorder) return Promise.reject(new Error('Already recording'));
    const mimeType = pickVideoMimeType();
    if (!mimeType) return Promise.reject(new Error('Video recording is not supported in this browser'));
    const stream = canvas.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 14_000_000 });
    this.chunks = [];
    this.recorder = rec;
    const done = new Promise<ClipResult>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    rec.ondataavailable = (e) => {
      if (this.recorder === rec && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onerror = () => {
      if (this.recorder !== rec) return;
      stream.getTracks().forEach((t) => t.stop());
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      this.finish(new Error('Recording failed'));
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (this.recorder !== rec) return; // a stale recorder must not settle a newer clip
      const type = rec.mimeType || mimeType;
      const blob = new Blob(this.chunks, { type });
      this.finish(blob.size > 0 ? null : new Error('Recording produced no data'), {
        blob,
        mimeType: type,
        filename: timestampedName(kind, extensionFor(type)),
      });
    };
    rec.start(250);
    this.stopTimer = window.setTimeout(() => this.stop(), maxSeconds * 1000);
    return done;
  }

  stop() {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private finish(err: Error | null, result?: ClipResult) {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.recorder = null;
    if (err) this.rejectDone?.(err);
    else if (result) this.resolveDone?.(result);
    this.resolveDone = null;
    this.rejectDone = null;
  }
}
