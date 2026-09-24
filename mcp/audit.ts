import type { Pixels } from './png';
import type { AuditResult, TextInfo, TextSample } from './runtime';

export interface Issue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

function parseColor(css: string): Rgba | null {
  const match = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?/i);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
}

/** A translucent text color as it lands on a background. */
const over = ([r, g, b, a]: Rgba, bg: Rgb): Rgb => [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Is this pixel a blend of the background and the ink (a glyph or its anti-aliased edge)? */
function onTheWay(sample: Rgb, background: Rgb, ink: Rgb): boolean {
  const v = [ink[0] - background[0], ink[1] - background[1], ink[2] - background[2]];
  const length = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  if (length < 1) return false;
  const t = ((sample[0] - background[0]) * v[0] + (sample[1] - background[1]) * v[1] + (sample[2] - background[2]) * v[2]) / length;
  if (t < 0.2) return false;
  const k = Math.min(1, t);
  return distance(sample, [background[0] + v[0] * k, background[1] + v[1] * k, background[2] + v[2] * k]) < 36;
}

/**
 * Contrast of a text block measured on the rendered pixels: the background is
 * whatever under the text box is not text-colored, so photos and gradients count.
 * Returns the contrast against the darkest-for-this-text fifth of the background.
 */
export function measureContrast(text: TextInfo, pixels: Pixels, cssWidth: number): { ratio: number; busy: boolean } | null {
  const color = parseColor(text.color);
  if (!color) return null;
  const colors = [color, ...(text.colors ?? []).map(parseColor).filter((c): c is Rgba => c !== null)];
  const scale = pixels.width / cssWidth;
  const [x, y, w, h] = text.rect.map((v) => v * scale);
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(pixels.width - 1, x + w);
  const bottom = Math.min(pixels.height - 1, y + h);
  if (right - left < 2 || bottom - top < 2) return null;
  // Long lines are judged in stretches about four letters high, so a shape behind
  // just the end of a line still counts.
  const slices = Math.max(1, Math.min(6, Math.floor((right - left) / Math.max(1, text.fontSize * scale * 4))));
  let worst: { ratio: number; busy: boolean } | null = null;
  for (let s = 0; s < slices; s++) {
    const sliceLeft = left + ((right - left) * s) / slices;
    const sliceRight = left + ((right - left) * (s + 1)) / slices;
    const cols = Math.max(6, Math.min(40, Math.round((sliceRight - sliceLeft) / 3)));
    const rows = Math.max(4, Math.min(40, Math.round((bottom - top) / 3)));
    const samples: Rgb[] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        samples.push(pixels.at(sliceLeft + ((sliceRight - sliceLeft) * (i + 0.5)) / cols, top + ((bottom - top) * (j + 0.5)) / rows));
      }
    }
    // Letters cover less than half of their box, so the median sample is the background;
    // translucent text is judged as it looks on it.
    const background: Rgb = [0, 1, 2].map((c) => median(samples.map((sample) => sample[c]))) as Rgb;
    const ink = over(color, background);
    if (distance(background, ink) < 40) {
      // The text has almost the color of what is behind it.
      const faint = { ratio: ratio(background, ink), busy: false };
      if (!worst || faint.ratio < worst.ratio) worst = faint;
      continue;
    }
    // Glyphs and their anti-aliased edges lie between the background and a text color;
    // everything else in the box is background.
    const inks = colors.map((c) => over(c, background));
    const ratios = samples.filter((sample) => !inks.some((c) => onTheWay(sample, background, c))).map((sample) => ratio(sample, ink));
    if (ratios.length < 8) continue;
    ratios.sort((a, b) => a - b);
    const low = ratios[Math.floor(ratios.length * 0.2)];
    const high = ratios[Math.floor(ratios.length * 0.9)];
    if (!worst || low < worst.ratio) worst = { ratio: low, busy: high / low > 2.5 };
  }
  return worst;
}

type Point = [number, number];

/**
 * The part of a text box the letters actually cover, as a polygon: line boxes of
 * big type carry a lot of empty ascent and descent, and tilted text is a tilted box.
 */
function ink(text: TextInfo): Point[] {
  const [x, y, w, h] = text.rect;
  const corners: Point[] = text.quad ?? [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const height = Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1]) || 1;
  const t = Math.min(0.16 * text.fontSize, height * 0.25) / height;
  const toward = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const [tl, tr, br, bl] = corners;
  return [toward(tl, bl), toward(tr, br), toward(br, tr), toward(bl, tl)];
}

function area(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Intersection of two convex polygons (Sutherland–Hodgman). */
function intersect(subject: Point[], clip: Point[]): Point[] {
  const orientation = Math.sign(
    clip.reduce((sum, [x1, y1], i) => {
      const [x2, y2] = clip[(i + 1) % clip.length];
      return sum + (x1 * y2 - x2 * y1);
    }, 0),
  );
  let output = subject;
  for (let i = 0; i < clip.length && output.length; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const inside = ([px, py]: Point) => orientation * ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) >= 0;
    const cross = ([px, py]: Point, [qx, qy]: Point): Point => {
      const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      const d2 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      const k = d1 / (d1 - d2 || 1);
      return [px + (qx - px) * k, py + (qy - py) * k];
    };
    const input = output;
    output = [];
    input.forEach((current, j) => {
      const previous = input[(j + input.length - 1) % input.length];
      if (inside(current)) {
        if (!inside(previous)) output.push(cross(previous, current));
        output.push(current);
      } else if (inside(previous)) {
        output.push(cross(previous, current));
      }
    });
  }
  return output;
}

const overlapShare = (a: Point[], b: Point[]) => {
  const shared = intersect(a, b);
  return shared.length < 3 ? 0 : area(shared) / Math.max(1, Math.min(area(a), area(b)));
};

const nested = (a: string, b: string) => a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Problems visible in one rendered frame. */
export function frameIssues(audit: AuditResult, pixels: Pixels | null, where: string, video: boolean): Issue[] {
  const issues: Issue[] = [];
  const shorter = Math.min(audit.width, audit.height);
  const minFont = (video ? 0.022 : 0.014) * shorter;
  const shown = audit.texts.filter((t) => t.opacity >= 0.5);

  for (const text of shown) {
    if (text.inside < 0.995) {
      issues.push({ level: 'error', where, message: `Text runs off the canvas (${Math.round(text.inside * 100)}% inside): ${text.desc}` });
    } else if (text.clippedBy === 'self') {
      issues.push({ level: 'error', where, message: `Text overflows its own box and is cut off (overflow hidden): ${text.desc}` });
    } else if (text.clippedBy) {
      issues.push({ level: 'error', where, message: `Text is cut off by ${text.clippedBy}: ${text.desc}` });
    }
    if (text.accentClash) {
      const [letter, leading] = text.accentClash.split('|');
      issues.push({
        level: 'warning',
        where,
        message: `The mark on "${letter}" can run into the line above at line-height ${leading}; give lines with accented capitals at least 1.0: ${text.desc}`,
      });
    }
    if (text.fontSize < minFont) {
      issues.push({
        level: 'warning',
        where,
        message: `Text is too small to read at ${Math.round(text.fontSize)}px (aim for at least ${Math.ceil(minFont)}px here): ${text.desc}`,
      });
    }
    if (pixels && text.opacity >= 0.9) {
      const measured = measureContrast(text, pixels, audit.width);
      if (measured) {
        const large = text.fontSize >= 0.035 * shorter || (text.fontWeight >= 700 && text.fontSize >= 0.026 * shorter);
        const need = large ? 3 : 4.5;
        if (measured.ratio < need) {
          issues.push({
            level: measured.ratio < need * 0.7 ? 'error' : 'warning',
            where,
            message: `Low contrast ${measured.ratio.toFixed(1)}:1 (needs ${need}:1${measured.busy ? ', busy background behind it' : ''}): ${text.desc}`,
          });
        }
      }
    }
  }

  const solid = shown.filter((t) => t.opacity >= 0.8 && t.inside > 0.5);
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (nested(solid[i].key, solid[j].key)) continue;
      if (overlapShare(ink(solid[i]), ink(solid[j])) > 0.12) {
        issues.push({ level: 'warning', where, message: `Text collides with other text: ${solid[i].desc} ↔ ${solid[j].desc}` });
      }
    }
  }

  for (const src of audit.brokenImages) issues.push({ level: 'error', where, message: `Image failed to load: ${src || '(empty src)'}` });
  for (const family of audit.missingFonts) {
    issues.push({
      level: 'warning',
      where,
      message: `Font "${family}" is not available, a fallback is shown. Use a bundled family (see the assets tool) or embed it with @font-face and a local file.`,
    });
  }
  for (const url of audit.external.slice(0, 5)) {
    issues.push({ level: 'warning', where, message: `Loads ${url} from the network; renders may differ offline. Save it into the project instead.` });
  }
  for (const error of audit.errors.slice(0, 5)) issues.push({ level: 'error', where, message: `Script error: ${error}` });
  return issues;
}

export interface Readability {
  text: string;
  words: number;
  need: number;
  /** Longest stretch the text is fully visible, inside the canvas and not moving. */
  seconds: number;
  appearsAt: number | null;
}

export interface TimelineReport {
  issues: Issue[];
  texts: Readability[];
  /** The moment the most text is settled on screen; a good poster frame. */
  posterTime: number;
}

/** Reading time per text block over the whole video (roughly 0.3 s per word, at least 0.8 s). */
export function timelineIssues(
  samples: { t: number; texts: TextSample[] }[],
  step: number,
  size: { width: number; height: number },
  duration: number,
): TimelineReport {
  const shorter = Math.min(size.width, size.height);
  const moveTolerance = Math.max(2, 0.004 * shorter);
  type Track = { text: string; words: number; runs: number; best: number; visibleFor: number; appearsAt: number | null };
  const tracks = new Map<string, Track>();
  const previous = new Map<string, TextSample>();
  const settledArea = samples.map(() => 0);

  samples.forEach(({ t, texts }, index) => {
    const seen = new Set<string>();
    for (const sample of texts) {
      const [key, words, opacity, inside, x, y, w, h, text, fontSize] = sample;
      seen.add(key);
      const track = tracks.get(key) ?? { text, words, runs: 0, best: 0, visibleFor: 0, appearsAt: null };
      tracks.set(key, track);
      const visible = opacity >= 0.9 && inside >= 0.98;
      const before = previous.get(key);
      const still =
        before !== undefined &&
        Math.abs(before[4] - x) <= moveTolerance &&
        Math.abs(before[5] - y) <= moveTolerance &&
        Math.abs(before[6] - w) <= Math.max(1, w * 0.01) &&
        Math.abs(before[7] - h) <= Math.max(1, h * 0.01);
      if (opacity >= 0.5 && inside >= 0.5) {
        track.visibleFor += step;
        track.appearsAt ??= t;
      }
      if (visible && still) {
        track.runs += 1;
        track.best = Math.max(track.best, track.runs);
        // Big type makes the poster: settled text counts by its area times its size.
        settledArea[index] += w * h * ((fontSize ?? 16) / shorter);
      } else {
        track.runs = 0;
      }
      previous.set(key, sample);
    }
    for (const [key, track] of tracks) {
      if (!seen.has(key)) {
        track.runs = 0;
        previous.delete(key);
      }
    }
  });

  const issues: Issue[] = [];
  const texts: Readability[] = [];
  for (const track of tracks.values()) {
    if (track.appearsAt === null) continue;
    const need = Math.max(0.8, 0.3 * track.words);
    // A text needs one extra sample to count as settled, so the run is measured from its second sample.
    const seconds = (track.best + (track.best > 0 ? 1 : 0)) * step;
    texts.push({ text: track.text, words: track.words, need, seconds, appearsAt: track.appearsAt });
    const where = `${Number(track.appearsAt.toFixed(1))}s`;
    const label = `"${track.text.length > 60 ? `${track.text.slice(0, 57)}…` : track.text}"`;
    if (track.visibleFor < 0.4) {
      issues.push({ level: 'warning', where, message: `${label} flashes by (${track.visibleFor.toFixed(1)}s). Hold it or drop it.` });
    } else if (seconds < need) {
      issues.push({
        level: seconds < need * 0.5 ? 'error' : 'warning',
        where,
        message: `${label} is readable for ${seconds.toFixed(1)}s but needs ~${need.toFixed(1)}s (${track.words} words). Land it faster and hold it, or shorten it.`,
      });
    }
  }

  // Poster: the moment with the most big, settled type (a little bias towards the payoff at the end),
  // taken from the middle of that hold so nothing else is still moving in.
  const score = samples.map(({ t }, index) => (t < 0.3 || t > duration - 0.05 ? -1 : settledArea[index] * (1 + (0.25 * t) / duration)));
  const best = Math.max(...score, 0);
  let posterTime = duration * 0.6;
  if (best > 0) {
    let run: [number, number] = [0, -1];
    let start = -1;
    score.forEach((value, i) => {
      if (value >= best * 0.97) {
        if (start < 0) start = i;
        if (i - start > run[1] - run[0]) run = [start, i];
      } else {
        start = -1;
      }
    });
    posterTime = samples[Math.round((run[0] + run[1]) / 2)].t;
  }
  return { issues, texts, posterTime };
}

/** Standard deviation of luminance: close to zero means an empty, flat frame. */
export function flatness(pixels: Pixels): number {
  const values: number[] = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      values.push(luminance(pixels.at(((i + 0.5) * pixels.width) / 24, ((j + 0.5) * pixels.height) / 24)) * 255);
    }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

export function formatIssues(issues: Issue[]): string {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const unique = (list: Issue[]) => [...new Map(list.map((i) => [`${i.where}|${i.message}`, i])).values()];
  const lines: string[] = [];
  if (!issues.length) lines.push('PASS: no problems found.');
  else lines.push(`${errors.length ? 'FAIL' : 'PASS with warnings'}: ${errors.length} error(s), ${warnings.length} warning(s).`);
  for (const issue of unique(errors)) lines.push(`  ✗ [${issue.where}] ${issue.message}`);
  for (const issue of unique(warnings)) lines.push(`  ! [${issue.where}] ${issue.message}`);
  return lines.join('\n');
}
