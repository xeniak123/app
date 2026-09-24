import { describe, expect, it } from 'vitest';
import { makeMusic, makeSfx, MUSIC_STYLES, parseKey, SAMPLE_RATE, SFX_KINDS, type MusicStyle, type SfxKind } from './music';

function samples(wav: Buffer) {
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
  expect(wav.readUInt16LE(22)).toBe(2);
  const count = (wav.length - 44) / 4;
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < count * 2; i++) {
    const v = wav.readInt16LE(44 + i * 2) / 32768;
    peak = Math.max(peak, Math.abs(v));
    energy += v * v;
  }
  return { seconds: count / SAMPLE_RATE, peak, rms: Math.sqrt(energy / (count * 2)) };
}

describe('music', () => {
  it('reads keys', () => {
    expect(parseKey('F#', 'major', 1)).toMatchObject({ root: 6, mode: 'major', name: 'F# major' });
    expect(parseKey('Bb minor', 'major', 1)).toMatchObject({ root: 10, mode: 'minor' });
    expect(parseKey('Am', 'major', 1)).toMatchObject({ root: 9, mode: 'minor', name: 'A minor' });
    expect(() => parseKey('H7', 'major', 1)).toThrow(/Cannot read key/);
  });

  it.each(Object.keys(MUSIC_STYLES) as MusicStyle[])('writes a mastered %s bed with its beat grid', (style) => {
    const music = makeMusic({ style, duration: 12, seed: 2 });
    const audio = samples(music.wav);
    expect(audio.seconds).toBeCloseTo(12, 2);
    expect(audio.peak).toBeLessThanOrEqual(0.9);
    expect(audio.rms).toBeGreaterThan(0.08);
    const beat = 60 / music.bpm;
    expect(music.bpm).toBe(MUSIC_STYLES[style].bpm);
    expect(music.beats[1] - music.beats[0]).toBeCloseTo(beat, 3);
    expect(music.downbeats[1]).toBeCloseTo(beat * 4, 2);
    // The final hit is on a downbeat and leaves at least 1.4 s to ring out.
    expect(music.downbeats).toContain(music.hit);
    expect(12 - music.hit).toBeGreaterThanOrEqual(1.4);
    expect(music.strong.at(-1)).toMatchObject({ t: music.hit });
    // The drop lands where a reveal belongs: 2–3.5 s in.
    expect(music.strong[1].t).toBeGreaterThanOrEqual(1.9);
    expect(music.strong[1].t).toBeLessThanOrEqual(3.5);
    expect(music.sections.at(-1)).toMatchObject({ name: 'ending', start: music.hit, end: 12 });
  });

  it('is deterministic and varies with the seed', () => {
    const a = makeMusic({ style: 'upbeat', duration: 6, seed: 5 });
    const b = makeMusic({ style: 'upbeat', duration: 6, seed: 5 });
    const c = makeMusic({ style: 'upbeat', duration: 6, seed: 6 });
    expect(a.wav.equals(b.wav)).toBe(true);
    expect(a.wav.equals(c.wav)).toBe(false);
  });

  it('refuses a video too short for one bar', () => {
    expect(() => makeMusic({ style: 'chill', duration: 3 })).toThrow(/too short/);
  });

  it.each(Object.keys(SFX_KINDS) as SfxKind[])('makes a %s', (kind) => {
    const audio = samples(makeSfx(kind, { duration: 1 }));
    expect(audio.peak).toBeGreaterThan(0.69);
    expect(audio.peak).toBeLessThan(0.72);
  });
});
