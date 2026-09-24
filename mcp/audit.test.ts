import { describe, expect, it } from 'vitest';
import { flatness, formatIssues, frameIssues, measureContrast, timelineIssues } from './audit';
import type { Pixels } from './png';
import type { AuditResult, TextInfo, TextSample } from './runtime';

const text = (over: Partial<TextInfo>): TextInfo => ({
  key: 'div0',
  desc: '<p>',
  text: 'Hello',
  words: 1,
  rect: [100, 100, 200, 50],
  quad: null,
  opacity: 1,
  inside: 1,
  clippedBy: null,
  color: 'rgb(0, 0, 0)',
  colors: ['rgb(0, 0, 0)'],
  fontSize: 40,
  fontWeight: 400,
  family: 'Inter',
  ...over,
});

const audit = (texts: TextInfo[]): AuditResult => ({ width: 1000, height: 1000, texts, brokenImages: [], missingFonts: [], external: [], errors: [] });

/** A white canvas with a dark box painted where `dark` says. */
const canvas = (dark: (x: number, y: number) => boolean): Pixels => ({
  width: 1000,
  height: 1000,
  at: (x, y) => (dark(x, y) ? [40, 30, 20] : [255, 255, 255]),
});

describe('frame critic', () => {
  it('sees tilted text by its real shape, not its bounding box', () => {
    // Two words tilted 45° whose bounding boxes overlap but whose letters don't.
    const tilted = (cx: number, cy: number, key: string) => {
      const [w, h] = [300, 40];
      const cos = Math.SQRT1_2;
      const corners = [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ].map(([x, y]) => [cx + x * cos - y * cos, cy + x * cos + y * cos] as [number, number]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      return text({ key, desc: key, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], quad: corners });
    };
    const apart = frameIssues(audit([tilted(300, 300, 'a'), tilted(420, 180, 'b')]), null, 'x', false);
    expect(apart.filter((i) => i.message.includes('collides'))).toEqual([]);
    const crossing = frameIssues(audit([tilted(300, 300, 'a'), text({ key: 'c', desc: 'c', rect: [150, 280, 300, 40] })]), null, 'x', false);
    expect(crossing.some((i) => i.message.includes('collides'))).toBe(true);
  });

  it('ignores the empty ascent of big type when judging collisions', () => {
    const headline = text({ key: 'h', desc: 'h', rect: [100, 100, 600, 240], fontSize: 240 });
    const subline = text({ key: 's', desc: 's', rect: [100, 300, 600, 60], fontSize: 50 });
    expect(frameIssues(audit([headline, subline]), null, 'x', false).some((i) => i.message.includes('collides'))).toBe(false);
  });

  it('finds low contrast at the end of a line only', () => {
    const line = text({ rect: [100, 100, 800, 50], fontSize: 40, color: 'rgb(60, 45, 30)' });
    const clean = measureContrast(line, canvas(() => false), 1000)!;
    expect(clean.ratio).toBeGreaterThan(9);
    // A dark shape behind the last fifth of the line.
    const partly = measureContrast(line, canvas((x) => x > 740), 1000)!;
    expect(partly.ratio).toBeLessThan(1.5);
  });

  it('judges translucent text as it looks on its background', () => {
    const dark: Pixels = { width: 1000, height: 1000, at: (x) => (Math.floor(x) % 7 === 0 ? [184, 184, 184] : [20, 20, 20]) };
    const dim = text({ color: 'rgba(255, 255, 255, 0.7)', colors: ['rgba(255, 255, 255, 0.7)'] });
    expect(measureContrast(dim, dark, 1000)!.ratio).toBeGreaterThan(8);
  });

  it('reports what a person would notice', () => {
    const issues = frameIssues(
      {
        ...audit([
          text({ inside: 0.8 }),
          text({ key: 'b', clippedBy: 'self', rect: [100, 300, 200, 50] }),
          text({ key: 'c', fontSize: 9, rect: [100, 500, 200, 12] }),
        ]),
        missingFonts: ['Comic Neue'],
      },
      null,
      'square',
      false,
    );
    const report = formatIssues(issues);
    expect(report).toMatch(/^FAIL: 2 error\(s\), 2 warning\(s\)\./);
    expect(report).toContain('✗ [square] Text runs off the canvas (80% inside)');
    expect(report).toContain('✗ [square] Text overflows its own box');
    expect(report).toContain('! [square] Text is too small to read at 9px');
    expect(report).toContain('! [square] Font "Comic Neue" is not available');
  });
});

describe('timeline critic', () => {
  const sample = (key: string, words: number, opacity: number, x: number, t: string): TextSample => [key, words, opacity, 1, x, 100, 300, 60, t, 48];

  it('measures how long each line is held still', () => {
    const samples = Array.from({ length: 60 }, (_, i) => {
      const t = i / 10;
      const texts: TextSample[] = [];
      // A headline slides in for 0.3 s, then holds from 0.4 to 2.9 s.
      if (t >= 0.1 && t < 3) {
        const x = t < 0.4 ? 400 - t * 800 : 80;
        texts.push(['h', 3, t < 0.2 ? 0.5 : 1, 1, x, 100, 900, 200, 'Big launch today', 180]);
      }
      // A ten-word sentence shows for one second.
      if (t >= 3 && t < 4) texts.push(sample('s', 10, 1, 80, 'ten words that nobody could ever read in one second'));
      // A label that flashes.
      if (t >= 4.5 && t < 4.7) texts.push(sample('f', 1, 1, 80, 'Flash'));
      return { t, texts };
    });
    const report = timelineIssues(samples, 0.1, { width: 1920, height: 1080 }, 6);
    const held = Object.fromEntries(report.texts.map((r) => [r.text.split(' ')[0], r.seconds]));
    expect(held.Big).toBeCloseTo(2.6, 1);
    expect(held.ten).toBeCloseTo(1, 1);
    expect(report.issues.map((i) => `${i.level} ${i.where}`)).toEqual(['error 3s', 'warning 4.5s']);
    expect(report.issues[0].message).toContain('needs ~3.0s (10 words)');
    // The poster frame is in the middle of the headline's hold, not on the sentence.
    expect(report.posterTime).toBeGreaterThan(1);
    expect(report.posterTime).toBeLessThan(2.6);
  });

  it('knows an empty frame', () => {
    expect(flatness(canvas(() => false))).toBe(0);
    expect(flatness(canvas((x) => x < 500))).toBeGreaterThan(50);
  });
});
