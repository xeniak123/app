import type { Pixels } from './png';
import type { AuditResult, TextInfo, TextSample } from './runtime';

export interface Issue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

type Rgb = [number, number, number];

function parseColor(css: string): Rgb | null {
  const match = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
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

/**
 * Contrast of a text block measured on the rendered pixels: the background is
 * whatever under the text box is not text-colored, so photos and gradients count.
 * Returns the contrast against the darkest-for-this-text fifth of the background.
 */
export function measureContrast(text: TextInfo, pixels: Pixels, cssWidth: number): { ratio: number; busy: boolean } | null {
  const color = parseColor(text.color);
  if (!color) return null;
  const scale = pixels.width / cssWidth;
  const [x, y, w, h] = text.rect.map((v) => v * scale);
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(pixels.width - 1, x + w);
  const bottom = Math.min(pixels.height - 1, y + h);
  if (right - left < 2 || bottom - top < 2) return null;
  const cols = Math.max(6, Math.min(70, Math.round((right - left) / 3)));
  const rows = Math.max(4, Math.min(40, Math.round((bottom - top) / 3)));
  const ratios: number[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const sample = pixels.at(left + ((right - left) * (i + 0.5)) / cols, top + ((bottom - top) * (j + 0.5)) / rows);
      if (distance(sample, color) > 48) ratios.push(ratio(sample, color));
    }
  }
  if (ratios.length < 8) return null;
  ratios.sort((a, b) => a - b);
  const low = ratios[Math.floor(ratios.length * 0.2)];
  const high = ratios[Math.floor(ratios.length * 0.9)];
  return { ratio: low, busy: high / low > 2.5 };
}

const overlapShare = (a: TextInfo['rect'], b: TextInfo['rect']) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  return (x * y) / Math.max(1, Math.min(a[2] * a[3], b[2] * b[3]));
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
      if (overlapShare(solid[i].rect, solid[j].rect) > 0.12) {
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
