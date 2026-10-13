import { describe, expect, test } from 'vitest';
import { extensionFor, pickVideoMimeType } from '../../src/engine/capture.ts';

const supports = (...types: string[]) => (t: string) => types.includes(t);

describe('clip format', () => {
  test('prefers MP4 with AAC when the clip carries sound', () => {
    const all = supports('video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm');
    expect(pickVideoMimeType(all, true)).toBe('video/mp4;codecs=avc1.640028,mp4a.40.2');
  });

  test('falls back to WebM + Opus where MP4 audio is unavailable (Firefox)', () => {
    const ff = supports('video/webm;codecs=vp8,opus', 'video/webm');
    expect(pickVideoMimeType(ff, true)).toBe('video/webm;codecs=vp8,opus');
  });

  test('silent clips never pick an audio container', () => {
    const all = supports('video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9');
    expect(pickVideoMimeType(all, false)).toBe('video/webm;codecs=vp9');
  });

  test('returns null when nothing can be recorded', () => {
    expect(pickVideoMimeType(supports(), true)).toBeNull();
  });

  test('file extension always matches the real container', () => {
    expect(extensionFor('video/mp4;codecs=avc1.640028,mp4a.40.2')).toBe('mp4');
    expect(extensionFor('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionFor('video/x-matroska;codecs=avc1')).toBe('mkv');
  });
});
