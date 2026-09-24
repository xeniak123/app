import { describe, expect, it } from 'vitest';
import { analyzeBeats, ANALYSIS_RATE, energyBar } from './beats';
import { makeMusic, MUSIC_STYLES, SAMPLE_RATE, type MusicStyle } from './music';

/** 48 kHz stereo WAV → 22.05 kHz mono, as ffmpeg would hand it over. */
function toAnalysis(wav: Buffer): Float32Array {
  const frames = (wav.length - 44) / 4;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = (wav.readInt16LE(44 + i * 4) + wav.readInt16LE(46 + i * 4)) / 65536;
  const out = new Float32Array(Math.floor((frames * ANALYSIS_RATE) / SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    const x = (i * SAMPLE_RATE) / ANALYSIS_RATE;
    const j = Math.floor(x);
    out[i] = mono[j] + (mono[Math.min(frames - 1, j + 1)] - mono[j]) * (x - j);
  }
  return out;
}

describe('beat tracking', () => {
  it.each(Object.keys(MUSIC_STYLES) as MusicStyle[])('finds the tempo and beats of a %s track', (style) => {
    const music = makeMusic({ style, duration: 20, seed: 9 });
    const found = analyzeBeats(toAnalysis(music.wav));
    expect(Math.abs(found.bpm - music.bpm)).toBeLessThan(1.5);
    // Most real beats have a detected beat within 35 ms.
    const truth = music.beats.filter((t) => t > 0.3 && t < music.hit - 0.1);
    const hits = truth.filter((t) => found.beats.some((b) => Math.abs(b - t) < 0.035));
    expect(hits.length / truth.length).toBeGreaterThan(0.85);
    expect(found.energy.every((e) => e >= 0 && e <= 9)).toBe(true);
    expect(found.strong.length).toBeGreaterThan(0);
  });

  it('draws the energy curve', () => {
    expect(energyBar([0, 3, 6, 9])).toBe('▁▃▆█');
  });

  it('refuses a clip too short to have a beat', () => {
    expect(() => analyzeBeats(new Float32Array(ANALYSIS_RATE))).toThrow(/shorter than 3 seconds/);
  });
});
