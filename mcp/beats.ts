/**
 * Beat tracking for the user's own music, so an edit can land on a real
 * track the way it lands on a generated one: tempo from the autocorrelation
 * of a spectral-flux onset envelope, beats by dynamic programming (Ellis
 * 2007), bar starts from where the low end hits, and strong cues where the
 * energy jumps or the biggest hits are.
 */

export const ANALYSIS_RATE = 22_050;
const HOP = 256;
const WINDOW = 1024;
const FPS = ANALYSIS_RATE / HOP;

export interface TrackCue {
  t: number;
  what: string;
}

export interface BeatAnalysis {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  strong: TrackCue[];
  /** Relative loudness of each bar, 0–9. */
  energy: number[];
  /** How clearly the track pulses, 0–1: low means free-time or ambient music with an unreliable grid. */
  confidence: number;
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Log-spaced band edges (in FFT bins) between 30 Hz and 8 kHz. */
function bandEdges(count: number): number[] {
  const binHz = ANALYSIS_RATE / WINDOW;
  const edges: number[] = [];
  for (let i = 0; i <= count; i++) edges.push(Math.max(1, Math.round((30 * (8000 / 30) ** (i / count)) / binHz)));
  return edges;
}

/** Onset strength per frame (all bands, and the low end alone) plus frame loudness. */
function onsetEnvelope(samples: Float32Array) {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const bands = 36;
  const edges = bandEdges(bands);
  const lowBands = edges.findIndex((bin) => bin * (ANALYSIS_RATE / WINDOW) > 180);
  const hann = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));
  const onset = new Float64Array(frames);
  const low = new Float64Array(frames);
  const loudness = new Float64Array(frames);
  let previous = new Float64Array(bands);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  for (let f = 0; f < frames; f++) {
    let power = 0;
    for (let i = 0; i < WINDOW; i++) {
      const v = samples[f * HOP + i];
      re[i] = v * hann[i];
      im[i] = 0;
      power += v * v;
    }
    loudness[f] = Math.sqrt(power / WINDOW);
    fft(re, im);
    const current = new Float64Array(bands);
    for (let b = 0; b < bands; b++) {
      let sum = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) sum += re[k] * re[k] + im[k] * im[k];
      current[b] = Math.log1p(1000 * Math.sqrt(sum));
      const rise = Math.max(0, current[b] - previous[b]);
      onset[f] += rise;
      if (b < lowBands) low[f] += rise;
    }
    previous = current;
  }
  // Remove the slow trend so only sudden rises count.
  const detrend = (x: Float64Array) => {
    const out = new Float64Array(x.length);
    const half = Math.round(FPS * 0.25);
    let sum = 0;
    for (let i = 0; i < Math.min(x.length, half); i++) sum += x[i];
    for (let i = 0; i < x.length; i++) {
      if (i + half < x.length) sum += x[i + half];
      if (i - half - 1 >= 0) sum -= x[i - half - 1];
      const count = Math.min(x.length - 1, i + half) - Math.max(0, i - half) + 1;
      out[i] = Math.max(0, x[i] - sum / count);
    }
    return out;
  };
  return { onset: detrend(onset), low: detrend(low), loudness };
}

function estimatePeriod(onset: Float64Array): { period: number; confidence: number } {
  const minLag = Math.floor((FPS * 60) / 190);
  const maxLag = Math.ceil((FPS * 60) / 55);
  const ac = new Float64Array(maxLag * 4 + 2);
  const mean = onset.reduce((s, v) => s + v, 0) / Math.max(1, onset.length);
  for (let lag = 1; lag < ac.length && lag < onset.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < onset.length; i++) sum += (onset[i] - mean) * (onset[i + lag] - mean);
    ac[lag] = sum / (onset.length - lag);
  }
  let zero = 0;
  for (let i = 0; i < onset.length; i++) zero += (onset[i] - mean) ** 2;
  zero /= Math.max(1, onset.length);
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    // Prefer tempos near 115 BPM, and periods whose multiples also line up (fewer octave mistakes).
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
    const comb = ac[lag] + 0.5 * (ac[2 * lag] ?? 0) + 0.25 * (ac[4 * lag] ?? 0);
    const score = comb * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement between neighbouring lags.
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return { period: best + Math.max(-0.5, Math.min(0.5, shift)), confidence: zero > 0 ? Math.max(0, Math.min(1, ac[best] / zero)) : 0 };
}

function trackBeats(onset: Float64Array, period: number): number[] {
  const n = onset.length;
  const std = Math.sqrt(onset.reduce((s, v) => s + v * v, 0) / Math.max(1, n)) || 1;
  const local = Float64Array.from(onset, (v) => v / std);
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const tightness = 100;
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    for (let p = t - Math.round(2 * period); p <= t - Math.round(period / 2); p++) {
      if (p < 0) continue;
      const s = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (s > best || from < 0) {
        best = s;
        from = p;
      }
    }
    score[t] = local[t] + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }
  let t = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t);
    t = back[t];
  }
  beats.reverse();
  // Extend the grid back to the start of the music at the same period.
  while (beats.length && beats[0] - period > period * 0.25) beats.unshift(Math.round(beats[0] - period));
  return beats;
}

/** Nudges a beat frame to the strongest onset within a couple of frames. */
function refine(frame: number, onset: Float64Array): number {
  let best = frame;
  for (let f = Math.max(0, frame - 2); f <= Math.min(onset.length - 1, frame + 2); f++) if (onset[f] > onset[best]) best = f;
  const [a, b, c] = [onset[best - 1] ?? 0, onset[best], onset[best + 1] ?? 0];
  const shift = a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

const round = (t: number) => Number(t.toFixed(3));

export function analyzeBeats(samples: Float32Array): BeatAnalysis {
  const duration = samples.length / ANALYSIS_RATE;
  if (duration < 3) throw new Error('The track is shorter than 3 seconds; there is no beat to find.');
  const { onset, low, loudness } = onsetEnvelope(samples);
  const { period, confidence } = estimatePeriod(onset);
  const frames = trackBeats(onset, period);
  // Time of a frame = the center of its analysis window.
  const toTime = (frame: number) => (frame * HOP + WINDOW / 2) / ANALYSIS_RATE;
  const beats = frames.map((f) => toTime(refine(f, onset))).filter((t) => t >= 0 && t < duration);

  // Bar starts: the phase of four where the low end (kick, bass) hits hardest.
  const lowAt = (t: number) => {
    const f = Math.round((t * ANALYSIS_RATE - WINDOW / 2) / HOP);
    let peak = 0;
    for (let i = Math.max(0, f - 2); i <= Math.min(low.length - 1, f + 2); i++) peak = Math.max(peak, low[i] + 0.25 * onset[i]);
    return peak;
  };
  const phaseScore = [0, 1, 2, 3].map((phase) => beats.filter((_, i) => i % 4 === phase).reduce((s, t) => s + lowAt(t), 0));
  const phase = phaseScore.indexOf(Math.max(...phaseScore));
  const downbeats = beats.filter((_, i) => i % 4 === phase);

  // Loudness per beat, then per bar.
  const beatLoudness = beats.map((t, i) => {
    const from = Math.max(0, Math.round((t * ANALYSIS_RATE) / HOP));
    const to = Math.min(loudness.length, Math.round(((beats[i + 1] ?? t + period / FPS) * ANALYSIS_RATE) / HOP));
    let sum = 0;
    for (let f = from; f < to; f++) sum += loudness[f] ** 2;
    return Math.sqrt(sum / Math.max(1, to - from));
  });
  const bars = downbeats.map((t) => {
    const i = beats.indexOf(t);
    const slice = beatLoudness.slice(i, i + 4);
    return slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length);
  });
  const loudest = Math.max(...bars, 1e-9);
  const energy = bars.map((v) => Math.round((v / loudest) * 9));

  // Strong cues: where the energy steps up (a drop, the beat coming back) and the hardest hits on bar starts.
  const candidates: (TrackCue & { score: number })[] = [];
  const mean = beatLoudness.reduce((s, v) => s + v, 0) / Math.max(1, beatLoudness.length) || 1;
  beats.forEach((t, i) => {
    if (i < 4 || i + 4 > beats.length) return;
    const before = beatLoudness.slice(i - 4, i).reduce((s, v) => s + v, 0) / 4;
    const after = beatLoudness.slice(i, i + 4).reduce((s, v) => s + v, 0) / 4;
    const jump = (after - before) / mean;
    if (jump > 0.25) candidates.push({ t, what: 'energy jumps up (a drop or an entry); put a reveal or a scene change here', score: jump * 2 });
  });
  for (const t of downbeats) {
    const hit = lowAt(t);
    candidates.push({ t, what: 'a hard hit on a bar start; good for a slam or a cut', score: hit / (Math.max(...downbeats.map(lowAt)) || 1) });
  }
  const strong: TrackCue[] = [];
  const minGap = (period / FPS) * 4 * 1.5;
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (strong.length >= 5) break;
    if (strong.every((s) => Math.abs(s.t - c.t) >= minGap)) strong.push({ t: round(c.t), what: c.what });
  }
  strong.sort((a, b) => a.t - b.t);

  return {
    duration: round(duration),
    bpm: Number(((60 * FPS) / period).toFixed(1)),
    beats: beats.map(round),
    downbeats: downbeats.map(round),
    strong,
    energy,
    confidence: Number(confidence.toFixed(2)),
  };
}

export function energyBar(levels: number[]): string {
  const blocks = '▁▂▃▄▅▆▇█';
  return levels.map((v) => blocks[Math.min(7, Math.round((v / 9) * 7))]).join('');
}
