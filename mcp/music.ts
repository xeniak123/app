/**
 * A small deterministic music and sound-effect synthesizer. Videos need a
 * music bed whose beats the edit can land on; generating it means every
 * render ships with sound that is free to use, and with an exact beat grid
 * (no detection) the composition can lock its reveals to.
 */

export const SAMPLE_RATE = 48_000;
const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;

export type MusicStyle = 'upbeat' | 'chill' | 'cinematic' | 'driving' | 'minimal';

export const MUSIC_STYLES: Record<MusicStyle, { bpm: number; mode: 'major' | 'minor'; feel: string }> = {
  upbeat: { bpm: 118, mode: 'major', feel: 'bright four-on-the-floor pop groove with a plucked arpeggio; launches, products, default tone' },
  chill: { bpm: 88, mode: 'major', feel: 'warm electric piano, soft swung beat and sub bass; polished, calm, lifestyle, food' },
  cinematic: { bpm: 90, mode: 'minor', feel: 'big drums, pulsing strings, risers and booms; trailers, dramatic reveals' },
  driving: { bpm: 124, mode: 'minor', feel: 'dark rolling bass and tight hats; tech, speed, chaotic tone' },
  minimal: { bpm: 100, mode: 'major', feel: 'sparse soft kick, ticks and a marimba motif; deadpan, explainers, understated' },
};

export interface MusicOptions {
  style: MusicStyle;
  duration: number;
  bpm?: number;
  /** "C", "F#", "Bb minor", "Am". */
  key?: string;
  seed?: number;
}

export interface Cue {
  t: number;
  what: string;
}

export interface MusicResult {
  wav: Buffer;
  bpm: number;
  key: string;
  duration: number;
  beats: number[];
  downbeats: number[];
  strong: Cue[];
  sections: { name: string; start: number; end: number }[];
  /** The final hit: the moment for the logo or payoff. */
  hit: number;
}

// ---- building blocks ---------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class Bus {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(readonly length: number) {
    this.l = new Float32Array(length);
    this.r = new Float32Array(length);
  }
  /** Adds a mono sample at index i with an equal-power pan (-1 left … 1 right). */
  add(i: number, value: number, pan = 0) {
    if (i < 0 || i >= this.length) return;
    const angle = ((pan + 1) * Math.PI) / 4;
    this.l[i] += value * Math.cos(angle) * Math.SQRT2;
    this.r[i] += value * Math.sin(angle) * Math.SQRT2;
  }
  mix(other: Bus, gain = 1, envelope?: Float32Array) {
    for (let i = 0; i < this.length; i++) {
      const g = envelope ? gain * envelope[i] : gain;
      this.l[i] += other.l[i] * g;
      this.r[i] += other.r[i] * g;
    }
  }
}

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type?: 'lp' | 'hp' | 'bp', f?: number, q = 0.707) {
    if (type && f) this.set(type, f, q);
  }

  set(type: 'lp' | 'hp' | 'bp', f: number, q = 0.707) {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lp') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (type === 'hp') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Zavalishin's state-variable low-pass, stable under fast cutoff sweeps. */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  lowpass(x: number, cutoff: number, q: number): number {
    const g = Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
}

/** Band-limited sawtooth step (polyBLEP). */
function saw(phase: number, dt: number): number {
  let value = 2 * phase - 1;
  if (phase < dt) {
    const t = phase / dt;
    value -= t + t - t * t - 1;
  } else if (phase > 1 - dt) {
    const t = (phase - 1) / dt;
    value -= t * t + t + t + 1;
  }
  return value;
}

/** Freeverb-style stereo reverb. */
function reverb(input: Bus, room: number, damp: number): Bus {
  const out = new Bus(input.length);
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const feedback = 0.7 + 0.28 * room;
  for (const [channel, spread] of [
    [0, 0],
    [1, 23],
  ] as const) {
    const source = channel === 0 ? input.l : input.r;
    const target = channel === 0 ? out.l : out.r;
    const acc = new Float32Array(input.length);
    for (const base of combs) {
      const size = Math.round((base + spread) * scale);
      const buffer = new Float32Array(size);
      let index = 0;
      let store = 0;
      for (let i = 0; i < input.length; i++) {
        const y = buffer[index];
        store = y * (1 - damp) + store * damp;
        buffer[index] = source[i] * 0.015 + store * feedback;
        acc[i] += y;
        if (++index >= size) index = 0;
      }
    }
    for (const base of allpasses) {
      const size = Math.round((base + spread) * scale);
      const buffer = new Float32Array(size);
      let index = 0;
      for (let i = 0; i < input.length; i++) {
        const buffered = buffer[index];
        const y = -acc[i] + buffered;
        buffer[index] = acc[i] + buffered * 0.5;
        acc[i] = y;
        if (++index >= size) index = 0;
      }
    }
    target.set(acc);
  }
  return out;
}

/** Ping-pong echo with a darkening feedback loop. */
function echo(input: Bus, seconds: number, feedback: number): Bus {
  const out = new Bus(input.length);
  const size = Math.max(1, Math.round(seconds * SR));
  const left = new Float32Array(size);
  const right = new Float32Array(size);
  const lpL = new Biquad('lp', 3200);
  const lpR = new Biquad('lp', 3200);
  let index = 0;
  for (let i = 0; i < input.length; i++) {
    const dl = left[index];
    const dr = right[index];
    out.l[i] = dl;
    out.r[i] = dr;
    left[index] = lpL.run((input.l[i] + input.r[i]) * 0.5 + dr * feedback);
    right[index] = lpR.run(dl * feedback);
    if (++index >= size) index = 0;
  }
  return out;
}

// ---- instruments ---------------------------------------------------------------

interface Kit {
  bus: Bus;
  noise: () => number;
}

function kick({ bus, noise }: Kit, t: number, vel: number, punch = 1) {
  const start = Math.round(t * SR);
  const length = Math.round(0.5 * SR);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const s = i / SR;
    phase += (TAU * (44 + 115 * punch * Math.exp(-s * 36))) / SR;
    let v = Math.sin(phase) * Math.exp(-s * 7) * Math.min(1, i / 20);
    if (s < 0.004) v += (noise() * 2 - 1) * 0.2 * (1 - s / 0.004);
    bus.add(start + i, Math.tanh(v * 1.7) * 0.85 * vel);
  }
}

function clap({ bus, noise }: Kit, t: number, vel: number, pan = 0) {
  const start = Math.round(t * SR);
  const bp = new Biquad('bp', 1250, 0.9);
  const hp = new Biquad('hp', 600);
  for (let i = 0; i < Math.round(0.3 * SR); i++) {
    const s = i / SR;
    let env = 0;
    for (let k = 0; k < 3; k++) if (s >= k * 0.011) env += Math.exp(-(s - k * 0.011) / 0.0035);
    if (s >= 0.022) env += 0.85 * Math.exp(-(s - 0.022) / 0.09);
    bus.add(start + i, hp.run(bp.run(noise() * 2 - 1)) * env * 1.4 * vel, pan);
  }
}

function snare({ bus, noise }: Kit, t: number, vel: number) {
  const start = Math.round(t * SR);
  const hp = new Biquad('hp', 1400);
  let phase = 0;
  for (let i = 0; i < Math.round(0.28 * SR); i++) {
    const s = i / SR;
    phase += (TAU * (175 + 30 * Math.exp(-s * 40))) / SR;
    const body = Math.sin(phase) * Math.exp(-s * 26) * 0.55;
    const rattle = hp.run(noise() * 2 - 1) * Math.exp(-s * 15) * 0.6;
    bus.add(start + i, (body + rattle) * vel);
  }
}

function hat({ bus, noise }: Kit, t: number, vel: number, open = false, pan = 0.25) {
  const start = Math.round(t * SR);
  const hp = new Biquad('hp', 7600, 0.8);
  const decay = open ? 9 : 58;
  for (let i = 0; i < Math.round((open ? 0.4 : 0.07) * SR); i++) {
    const s = i / SR;
    bus.add(start + i, hp.run(noise() * 2 - 1) * Math.exp(-s * decay) * 0.42 * vel, pan);
  }
}

function shaker({ bus, noise }: Kit, t: number, vel: number) {
  const start = Math.round(t * SR);
  const bp = new Biquad('bp', 6800, 1.1);
  for (let i = 0; i < Math.round(0.09 * SR); i++) {
    const s = i / SR;
    const env = Math.min(1, s / 0.006) * Math.exp(-s * 38);
    bus.add(start + i, bp.run(noise() * 2 - 1) * env * 0.8 * vel, -0.3);
  }
}

function tom({ bus, noise }: Kit, t: number, vel: number, pitch = 1) {
  const start = Math.round(t * SR);
  const lp = new Biquad('lp', 700);
  let phase = 0;
  for (let i = 0; i < Math.round(0.9 * SR); i++) {
    const s = i / SR;
    phase += (TAU * pitch * (62 + 45 * Math.exp(-s * 18))) / SR;
    const v = Math.sin(phase) * Math.exp(-s * 5.5) + lp.run(noise() * 2 - 1) * Math.exp(-s * 30) * 0.5;
    bus.add(start + i, Math.tanh(v * 1.4) * 0.8 * vel);
  }
}

function boom({ bus, noise }: Kit, t: number, vel: number) {
  const start = Math.round(t * SR);
  const lp = new Biquad('lp', 1800);
  let phase = 0;
  for (let i = 0; i < Math.round(2.4 * SR); i++) {
    const s = i / SR;
    phase += (TAU * (38 + 50 * Math.exp(-s * 9))) / SR;
    const v = Math.sin(phase) * Math.exp(-s * 2.1) * Math.min(1, i / 30) + lp.run(noise() * 2 - 1) * Math.exp(-s * 12) * 0.35;
    bus.add(start + i, Math.tanh(v * 1.5) * 0.9 * vel);
  }
}

function crash({ bus, noise }: Kit, t: number, vel: number, seconds = 2.2) {
  const start = Math.round(t * SR);
  const hpL = new Biquad('hp', 3800, 0.6);
  const hpR = new Biquad('hp', 4100, 0.6);
  for (let i = 0; i < Math.round(seconds * SR); i++) {
    const s = i / SR;
    const env = Math.min(1, s / 0.002) * Math.exp(-s * (2.6 / (seconds / 2.2)));
    bus.l[start + i] += hpL.run(noise() * 2 - 1) * env * 0.3 * vel;
    bus.r[start + i] += hpR.run(noise() * 2 - 1) * env * 0.3 * vel;
  }
}

function riser({ bus, noise }: Kit, end: number, seconds: number, vel: number) {
  const start = Math.round((end - seconds) * SR);
  const length = Math.round(seconds * SR);
  const bpL = new Biquad();
  const bpR = new Biquad();
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const p = i / length;
    if (i % 64 === 0) {
      const center = 280 * (7200 / 280) ** p;
      bpL.set('bp', center, 1.6);
      bpR.set('bp', center * 1.04, 1.6);
    }
    phase += (TAU * (180 * 2 ** (p * 2.6))) / SR;
    const env = p ** 2.2 * Math.min(1, (length - i) / (0.006 * SR));
    const tone = Math.sin(phase) * 0.12;
    bus.l[start + i] += (bpL.run(noise() * 2 - 1) * 1.3 + tone) * env * vel;
    bus.r[start + i] += (bpR.run(noise() * 2 - 1) * 1.3 + tone) * env * vel;
  }
}

function bass(bus: Bus, t: number, seconds: number, midi: number, vel: number, bright = 1) {
  const start = Math.round(t * SR);
  const length = Math.round(seconds * SR);
  const f = freq(midi);
  const dt = f / SR;
  const svf = new Svf();
  let phase = 0;
  let sub = 0;
  for (let i = 0; i < length + Math.round(0.05 * SR); i++) {
    const s = i / SR;
    phase = (phase + dt) % 1;
    sub += TAU * dt;
    const cutoff = 150 + 1000 * bright * Math.exp(-s * 11) * vel;
    const amp = Math.min(1, i / 120) * (i < length ? 0.75 + 0.25 * Math.exp(-s * 6) : Math.exp(-(i - length) / (0.012 * SR)) * 0.75);
    const v = svf.lowpass(saw(phase, dt), cutoff, 0.9) * 0.55 + Math.sin(sub) * 0.55;
    bus.add(start + i, Math.tanh(v * 1.3) * amp * 0.7 * vel);
  }
}

function subBass(bus: Bus, t: number, seconds: number, midi: number, vel: number) {
  const start = Math.round(t * SR);
  const length = Math.round(seconds * SR);
  const dt = freq(midi) / SR;
  let phase = 0;
  for (let i = 0; i < length + Math.round(0.08 * SR); i++) {
    phase += TAU * dt;
    const amp = Math.min(1, i / 200) * (i < length ? 1 : Math.exp(-(i - length) / (0.02 * SR)));
    bus.add(start + i, Math.tanh(Math.sin(phase) * 1.6) * 0.5 * amp * vel);
  }
}

/** Detuned saw pad (or string section): slow attack, long release. */
function pad(bus: Bus, t: number, seconds: number, midi: number, vel: number, brightness: number, attack = 0.25, release = 0.7) {
  const start = Math.round(t * SR);
  const length = Math.round(seconds * SR);
  const tail = Math.round(release * SR);
  const voices = [-9, 0, 9].map((cents, v) => ({
    dt: (freq(midi) * 2 ** (cents / 1200)) / SR,
    phase: (v * 0.37) % 1,
    pan: (v - 1) * 0.55,
  }));
  const lp = [new Biquad('lp', brightness, 0.6), new Biquad('lp', brightness, 0.6), new Biquad('lp', brightness, 0.6)];
  for (let i = 0; i < length + tail; i++) {
    const s = i / SR;
    const amp = Math.min(1, s / attack) * (i < length ? 1 : Math.exp(-((i - length) / tail) * 4.5));
    voices.forEach((voice, v) => {
      voice.phase = (voice.phase + voice.dt) % 1;
      bus.add(start + i, lp[v].run(saw(voice.phase, voice.dt)) * amp * 0.1 * vel, voice.pan);
    });
  }
}

function pluck(bus: Bus, t: number, midi: number, vel: number, pan: number, decay = 9) {
  const start = Math.round(t * SR);
  const dt = freq(midi) / SR;
  const svf = new Svf();
  let phase = 0;
  for (let i = 0; i < Math.round(0.45 * SR); i++) {
    const s = i / SR;
    phase = (phase + dt) % 1;
    const cutoff = 420 + 3600 * Math.exp(-s * 20);
    const v = svf.lowpass(saw(phase, dt) * 0.7 + (phase < 0.5 ? 0.3 : -0.3), cutoff, 1.1);
    bus.add(start + i, v * Math.exp(-s * decay) * Math.min(1, i / 40) * 0.33 * vel, pan);
  }
}

/** FM electric piano with a tine and a slow autopan. */
function keys(bus: Bus, t: number, seconds: number, midi: number, vel: number) {
  const start = Math.round(t * SR);
  const f = freq(midi);
  const length = Math.round((seconds + 0.4) * SR);
  let carrier = 0;
  let modulator = 0;
  let tine = 0;
  for (let i = 0; i < length; i++) {
    const s = i / SR;
    modulator += (TAU * f) / SR;
    tine += (TAU * f * 14) / SR;
    const index = 1.6 * Math.exp(-s * 3.2) + 0.25;
    carrier += (TAU * f) / SR;
    const release = s > seconds ? Math.exp(-(s - seconds) * 14) : 1;
    const amp = Math.min(1, i / 90) * Math.exp(-s * 1.5) * release;
    const v = Math.sin(carrier + index * Math.sin(modulator)) + Math.sin(tine) * 0.12 * Math.exp(-s * 28);
    bus.add(start + i, v * amp * 0.2 * vel, Math.sin(TAU * 0.35 * (t + s)) * 0.35);
  }
}

function marimba(bus: Bus, t: number, midi: number, vel: number, pan: number) {
  const start = Math.round(t * SR);
  const f = freq(midi);
  const partials: [number, number, number][] = [
    [1, 1, 3.4],
    [3.99, 0.3, 11],
    [10.7, 0.07, 26],
  ];
  const phases = partials.map(() => 0);
  for (let i = 0; i < Math.round(1.2 * SR); i++) {
    const s = i / SR;
    let v = 0;
    partials.forEach(([ratio, gain, decay], k) => {
      phases[k] += (TAU * f * ratio) / SR;
      v += Math.sin(phases[k]) * gain * Math.exp(-s * decay);
    });
    bus.add(start + i, v * Math.min(1, i / 60) * 0.3 * vel, pan);
  }
}

// ---- harmony --------------------------------------------------------------------

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

export function parseKey(key: string | undefined, fallbackMode: 'major' | 'minor', seed: number): { root: number; mode: 'major' | 'minor'; name: string } {
  let root: number;
  let mode = fallbackMode;
  if (key) {
    const match = key.trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|maj|major|moll|dur)?$/i);
    if (!match) throw new Error(`Cannot read key "${key}". Use e.g. "C", "F#", "Bb minor" or "Am".`);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase() as 'C'];
    root = (base + (/[#♯]/.test(match[2]) ? 1 : /[b♭]/.test(match[2]) ? -1 : 0) + 12) % 12;
    if (match[3]) mode = /^(m|min|minor|moll)$/i.test(match[3]) ? 'minor' : 'major';
  } else {
    root = [0, 2, 3, 5, 7, 9][Math.floor(rng(seed + 7)() * 6)];
  }
  return { root, mode, name: `${NOTE_NAMES[root]} ${mode}` };
}

/** Chord tones (midi, around the middle of the keyboard) for a scale degree. */
function chord(root: number, mode: 'major' | 'minor', degree: number, sevenths: boolean): number[] {
  const scale = SCALES[mode];
  const tones = [0, 2, 4, ...(sevenths ? [6] : [])].map((step) => {
    const index = degree + step;
    return root + scale[index % 7] + 12 * Math.floor(index / 7);
  });
  // Close voicing between G3 and G4 for smooth movement from chord to chord.
  return tones.map((note) => {
    let n = note + 48;
    while (n < 55) n += 12;
    while (n > 67) n -= 12;
    return n;
  }).sort((a, b) => a - b);
}

const PROGRESSIONS: Record<MusicStyle, { degrees: number[]; barsPerChord: number; sevenths: boolean }> = {
  upbeat: { degrees: [0, 4, 5, 3], barsPerChord: 1, sevenths: false },
  chill: { degrees: [1, 4, 0, 5], barsPerChord: 1, sevenths: true },
  cinematic: { degrees: [0, 5, 2, 6], barsPerChord: 1, sevenths: false },
  driving: { degrees: [0, 5, 3, 6], barsPerChord: 1, sevenths: false },
  minimal: { degrees: [0, 3], barsPerChord: 2, sevenths: true },
};

// ---- arrangement ------------------------------------------------------------------

export function makeMusic(options: MusicOptions): MusicResult {
  const style = MUSIC_STYLES[options.style];
  if (!style) throw new Error(`Unknown style "${options.style}". Use one of: ${Object.keys(MUSIC_STYLES).join(', ')}.`);
  const seed = options.seed ?? 1;
  const bpm = Math.round(Math.min(180, Math.max(60, options.bpm ?? style.bpm)));
  const key = parseKey(options.key, style.mode, seed);
  const beat = 60 / bpm;
  const barLength = beat * 4;
  const step = beat / 4;
  const duration = options.duration;
  const bars = Math.floor((duration - 1.4) / barLength);
  if (bars < 1) throw new Error(`${duration}s is too short for music at ${bpm} BPM: it needs at least ${(barLength + 1.4).toFixed(1)}s.`);
  if (duration > 300) throw new Error('Music is limited to 5 minutes.');
  const hit = bars * barLength;
  // The drop (the reveal) should come 2–3.5 s in: one bar, or two when bars are short.
  const intro = bars < 2 ? 0 : barLength < 1.75 && bars >= 6 ? 2 : 1;
  const breakdown = bars >= 8 ? Math.floor(bars * 0.62) : -1;
  const length = Math.ceil(duration * SR);

  const random = rng(seed);
  const noise = rng(seed * 7919 + 1);
  const drums = new Bus(length);
  const kit: Kit = { bus: drums, noise };
  const bassBus = new Bus(length);
  const padBus = new Bus(length);
  const leadBus = new Bus(length);
  const fx = new Bus(length);
  const fxKit: Kit = { bus: fx, noise };
  const send = new Bus(length);
  const kicks: number[] = [];
  const humanize = (amount = 0.004) => (random() * 2 - 1) * amount;
  const vary = (v: number) => v * (0.92 + random() * 0.16);
  const progression = PROGRESSIONS[options.style];
  const chordAt = (bar: number) => {
    const degree = progression.degrees[Math.floor(bar / progression.barsPerChord) % progression.degrees.length];
    return { degree, notes: chord(key.root, key.mode, degree, progression.sevenths) };
  };
  const bassNote = (degree: number) => {
    let n = key.root + SCALES[key.mode][degree % 7] + 36;
    if (n > 45) n -= 12;
    return n;
  };
  const swing = options.style === 'chill' ? 0.16 : 0;
  const at = (bar: number, s: number) => bar * barLength + s * step + (s % 2 === 1 ? swing * step : 0);

  // A short motif for the minimal style, repeated so it reads as a tune.
  const pentatonic = [0, 2, 4, 7, 9];
  const motif = Array.from({ length: 6 }, () => ({
    step: Math.floor(random() * 8) * 2 + (random() < 0.3 ? 1 : 0),
    note: pentatonic[Math.floor(random() * pentatonic.length)] + (random() < 0.3 ? 12 : 0),
  })).sort((a, b) => a.step - b.step);

  for (let bar = 0; bar < bars; bar++) {
    const { degree, notes } = chordAt(bar);
    const isIntro = bar < intro;
    const isBreak = bar === breakdown;
    const isFill = bar === bars - 1 && bars >= 2;
    const full = !isIntro && !isBreak;
    const barStart = bar * barLength;

    // Harmony
    const chordStart = bar % progression.barsPerChord === 0;
    if (options.style === 'chill') {
      for (const [s, len] of [
        [0, 5],
        [6, 2],
        [10, 5],
      ] as const) {
        for (const note of notes) keys(padBus, at(bar, s) + humanize(0.006), len * step, note, vary(isIntro ? 0.7 : 0.9));
      }
    } else if (chordStart) {
      const span = barLength * progression.barsPerChord;
      const bright = { upbeat: 1500, cinematic: 1100, driving: 900, minimal: 1200, chill: 1000 }[options.style];
      for (const note of notes) pad(padBus, barStart, span, note, isIntro ? 0.8 : 1, isIntro ? bright * 0.55 : bright, options.style === 'cinematic' ? 0.5 : 0.2);
    }

    // Bass
    const root = bassNote(degree);
    if (!isIntro || options.style === 'cinematic') {
      if (options.style === 'upbeat') {
        for (const s of [2, 6, 10, 14]) bass(bassBus, at(bar, s), step * 1.6, root, vary(isBreak ? 0.5 : 0.9));
        bass(bassBus, at(bar, 0), step * 1.2, root, vary(0.7));
      } else if (options.style === 'driving') {
        for (let s = 0; s < 16; s++) if (s % 4 !== 0) bass(bassBus, at(bar, s), step * 0.8, root + (s % 8 === 7 ? 12 : 0), vary(isBreak ? 0.4 : 0.8), 0.8);
      } else if (options.style === 'chill') {
        subBass(bassBus, at(bar, 0), step * 6, root, 0.9);
        subBass(bassBus, at(bar, 10), step * 5, root + (bar % 2 ? 7 : 0), 0.75);
      } else if (options.style === 'cinematic') {
        for (let s = 0; s < 16; s += 2) bass(bassBus, at(bar, s), step * 1.5, root, vary(isIntro ? 0.5 : 0.8), 0.6);
      } else {
        subBass(bassBus, at(bar, 0), step * 7, root, 0.8);
        subBass(bassBus, at(bar, 8), step * 7, root, 0.7);
      }
    }

    // Lead: arpeggio, strings, motif
    if (options.style === 'upbeat' && !isIntro) {
      const tones = [...notes, notes[0] + 12];
      const order = [0, 2, 1, 3, 0, 2, 1, 2];
      for (let s = 0; s < 16; s++) pluck(leadBus, at(bar, s), tones[order[s % 8]] + 12, vary(s % 4 === 0 ? 1 : 0.7), s % 2 ? 0.3 : -0.3);
    } else if (options.style === 'driving' && full) {
      for (const s of [2, 6, 11, 14]) for (const note of notes) pluck(leadBus, at(bar, s), note + 12, vary(0.55), 0, 16);
    } else if (options.style === 'cinematic') {
      for (let s = 0; s < 16; s += 2) {
        for (const note of [notes[0] + 12, notes[2] + 12]) pluck(leadBus, at(bar, s), note, vary(isIntro ? 0.5 : 0.8), s % 4 ? 0.4 : -0.4, 6);
      }
    } else if (options.style === 'minimal' && !isIntro) {
      for (const { step: s, note } of motif) marimba(leadBus, at(bar, s), key.root + 60 + note, vary(0.8), (note % 5) / 5 - 0.4);
    }

    // Drums
    const kickSteps = { upbeat: [0, 4, 8, 12], driving: [0, 4, 8, 12], chill: [0, 7, 10], cinematic: [], minimal: [0, 8] }[options.style];
    if (full || (isIntro && options.style !== 'cinematic' && bar === intro - 1)) {
      for (const s of kickSteps) {
        if (isFill && s >= 12) continue;
        const t = at(bar, s);
        kick(kit, t, isIntro ? 0.6 : options.style === 'chill' ? 0.75 : 1, options.style === 'chill' || options.style === 'minimal' ? 0.7 : 1);
        kicks.push(t);
      }
    }
    if (full) {
      if (options.style === 'upbeat' || options.style === 'driving') for (const s of [4, 12]) clap(kit, at(bar, s) + humanize(0.002), vary(0.75));
      if (options.style === 'chill') for (const s of [4, 12]) snare(kit, at(bar, s) + humanize(0.006), vary(0.55));
      if (options.style === 'minimal') clap(kit, at(bar, 12), 0.35, 0.2);
      if (options.style === 'cinematic') {
        for (const [s, v, p] of [
          [0, 1, 1],
          [3, 0.55, 1.3],
          [6, 0.7, 1],
          [8, 0.9, 0.8],
          [11, 0.5, 1.3],
          [14, 0.65, 1],
        ] as const) {
          tom(kit, at(bar, s), vary(v), p);
          if (s === 0 || s === 8) kicks.push(at(bar, s));
        }
        clap(kit, at(bar, 8), 0.6);
      }
    }
    // Hats and shakers run through intro and breakdown too, to keep time.
    for (let s = 0; s < 16; s++) {
      const t = at(bar, s) + humanize(0.003);
      if (options.style === 'upbeat') {
        if (s % 2 === 0) hat(kit, t, vary(s % 4 === 2 ? 0.8 : 0.35));
        if (s % 4 === 2 && full && bar % 2 === 1 && s === 14) hat(kit, t, 0.5, true);
      } else if (options.style === 'driving') {
        hat(kit, t, vary([0.5, 0.3, 0.85, 0.3][s % 4]));
        if (s % 4 === 2 && full) hat(kit, t, 0.35, true, -0.2);
      } else if (options.style === 'chill') {
        shaker(kit, t, vary(s % 2 ? 0.45 : 0.75));
      } else if (options.style === 'minimal') {
        if (s % 4 === 2) hat(kit, t, vary(0.4), false, 0.4);
      } else if (options.style === 'cinematic' && full && s % 2 === 0) {
        hat(kit, t, vary(s % 4 === 0 ? 0.35 : 0.2), false, 0.1);
      }
    }

    // Transitions: a riser into the drop, into the return after the breakdown and into the final hit.
    if ((intro > 0 && bar === intro - 1) || isBreak || isFill) {
      riser(fxKit, barStart + barLength, barLength * (isFill ? 1 : 0.9), options.style === 'minimal' || options.style === 'chill' ? 0.35 : 0.6);
    }
    if (isFill && options.style !== 'minimal' && options.style !== 'chill') {
      for (let s = 12; s < 16; s++) {
        if (options.style === 'cinematic') tom(kit, at(bar, s), 0.35 + (s - 12) * 0.15, 1.2);
        else snare(kit, at(bar, s), 0.35 + (s - 12) * 0.15);
      }
    }
    if (bar === intro && intro > 0) crash(fxKit, barStart, options.style === 'minimal' ? 0.4 : 0.8);
    if (bar === breakdown + 1 && breakdown > 0) crash(fxKit, barStart, 0.7);
  }

  // Opening accent and the final hit, which rings out to the end.
  if (options.style === 'cinematic') boom(fxKit, 0, 0.8);
  else crash(fxKit, 0, 0.35, 1.4);
  const ring = duration - hit;
  const last = chordAt(0).notes;
  kick(kit, hit, 1);
  kicks.push(hit);
  crash(fxKit, hit, 1, Math.min(2.6, ring + 0.4));
  if (options.style === 'cinematic' || options.style === 'driving') boom(fxKit, hit, 0.9);
  for (const note of last) {
    if (options.style === 'chill') keys(padBus, hit, ring, note, 1);
    else pad(padBus, hit, ring - 0.3, note, 1, options.style === 'cinematic' ? 1400 : 1700, 0.02, 0.5);
  }
  (options.style === 'chill' || options.style === 'minimal' ? subBass : (b: Bus, t: number, s: number, m: number, v: number) => bass(b, t, s, m, v, 0.4))(
    bassBus,
    hit,
    Math.min(ring - 0.3, 1.8),
    bassNote(PROGRESSIONS[options.style].degrees[0]),
    0.9,
  );
  if (options.style === 'minimal' || options.style === 'upbeat') {
    for (const [i, note] of last.entries()) (options.style === 'minimal' ? marimba : (b: Bus, t: number, m: number, v: number, p: number) => pluck(b, t, m, v, p, 4))(leadBus, hit + i * 0.03, note + 12, 0.8, i * 0.3 - 0.3);
  }

  // Sidechain: music ducks under every kick, so the groove pumps and the kick stays clear.
  const depth = { upbeat: 0.45, driving: 0.55, chill: 0.2, cinematic: 0.25, minimal: 0.15 }[options.style];
  const duck = new Float32Array(length).fill(1);
  for (const t of kicks) {
    const start = Math.round(t * SR);
    for (let i = 0; i < Math.round(0.3 * SR) && start + i < length; i++) {
      duck[start + i] = Math.min(duck[start + i], 1 - depth * Math.exp(-i / (0.09 * SR)));
    }
  }

  // Effects sends and the mix.
  send.mix(padBus, 0.6);
  send.mix(leadBus, 0.5);
  send.mix(fx, 0.35);
  send.mix(drums, options.style === 'cinematic' ? 0.25 : 0.08);
  const room = reverb(send, options.style === 'cinematic' ? 0.88 : 0.78, options.style === 'chill' ? 0.5 : 0.3);
  const echoes = options.style === 'upbeat' || options.style === 'minimal' ? echo(leadBus, beat * 0.75, 0.38) : null;

  const master = new Bus(length);
  master.mix(drums, 0.9);
  master.mix(bassBus, 0.85, duck);
  master.mix(padBus, options.style === 'chill' ? 0.9 : 0.75, duck);
  master.mix(leadBus, 0.7, duck);
  if (echoes) master.mix(echoes, 0.22, duck);
  master.mix(fx, 0.7);
  master.mix(room, { upbeat: 0.5, chill: 0.6, cinematic: 0.8, driving: 0.4, minimal: 0.6 }[options.style]);

  finish(master, duration);
  const beats: number[] = [];
  for (let t = 0; t <= hit + 1e-6; t += beat) beats.push(Number(t.toFixed(3)));
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const strong: Cue[] = [{ t: 0, what: 'start: the hook lands here' }];
  if (intro > 0) strong.push({ t: intro * barLength, what: 'drop: the full beat comes in; put the reveal here' });
  if (breakdown > 0) strong.push({ t: (breakdown + 1) * barLength, what: 'back in after the breakdown; a highlight or scene change' });
  strong.push({ t: hit, what: 'final hit: land the logo or payoff here; the music rings out after it' });
  const sections = [
    ...(intro > 0 ? [{ name: 'intro', start: 0, end: intro * barLength }] : []),
    { name: 'groove', start: intro * barLength, end: (breakdown > 0 ? breakdown : bars) * barLength },
    ...(breakdown > 0
      ? [
          { name: 'breakdown', start: breakdown * barLength, end: (breakdown + 1) * barLength },
          { name: 'groove', start: (breakdown + 1) * barLength, end: hit },
        ]
      : []),
    { name: 'ending', start: hit, end: duration },
  ].map((s) => ({ ...s, start: Number(s.start.toFixed(3)), end: Number(s.end.toFixed(3)) }));
  return {
    wav: encodeWav(master),
    bpm,
    key: key.name,
    duration,
    beats,
    downbeats,
    strong: strong.map((c) => ({ ...c, t: Number(c.t.toFixed(3)) })),
    sections,
    hit: Number(hit.toFixed(3)),
  };
}

/** Rumble filter, level, gentle peak control and fades. */
function finish(bus: Bus, duration: number) {
  const hpL = new Biquad('hp', 28);
  const hpR = new Biquad('hp', 28);
  let sum = 0;
  for (let i = 0; i < bus.length; i++) {
    bus.l[i] = hpL.run(bus.l[i]);
    bus.r[i] = hpR.run(bus.r[i]);
    sum += bus.l[i] ** 2 + bus.r[i] ** 2;
  }
  const rms = Math.sqrt(sum / (bus.length * 2)) || 1;
  const gain = 0.16 / rms; // about -16 dBFS RMS before the peak control
  const soft = (x: number) => {
    const a = Math.abs(x);
    return a < 0.75 ? x : Math.sign(x) * (0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25));
  };
  let peak = 0;
  for (let i = 0; i < bus.length; i++) {
    bus.l[i] = soft(bus.l[i] * gain);
    bus.r[i] = soft(bus.r[i] * gain);
    peak = Math.max(peak, Math.abs(bus.l[i]), Math.abs(bus.r[i]));
  }
  const ceiling = peak > 0.89 ? 0.89 / peak : 1;
  const fadeIn = Math.round(0.004 * SR);
  const fadeOut = Math.round(Math.min(0.35, duration / 4) * SR);
  for (let i = 0; i < bus.length; i++) {
    const edge = Math.min(1, i / fadeIn, (bus.length - 1 - i) / fadeOut);
    bus.l[i] *= ceiling * edge;
    bus.r[i] *= ceiling * edge;
  }
}

export function encodeWav(bus: Bus): Buffer {
  const data = Buffer.alloc(bus.length * 4);
  for (let i = 0; i < bus.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, bus.l[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, bus.r[i])) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---- sound effects ------------------------------------------------------------------

export const SFX_KINDS = {
  whoosh: 'airy swoosh (0.8 s) for a camera move, a push or a big transition; peaks at 60%, so start it ~0.45 s before the cut',
  swipe: 'short fast swoosh (0.35 s) for a card, panel or word sliding in; peaks at 45%',
  riser: 'tension build that ends exactly at its end: place it so it finishes on the hit (length = duration, default 1.5 s)',
  impact: 'deep boom with a crack and a tail (2 s) for the title slam or the logo hit',
  'sub-drop': 'falling sub-bass (1.2 s) under a reveal or a drop',
  pop: 'round bubbly pop (0.15 s) for an element popping in, a badge, a like',
  tick: 'tiny clock tick (0.05 s) for counters, typing or list items (keep volume low)',
  shimmer: 'sparkling bell cluster (1.6 s) for a magic moment, success or a logo glint',
} as const;

export type SfxKind = keyof typeof SFX_KINDS;

export function makeSfx(kind: SfxKind, options: { duration?: number; seed?: number } = {}): Buffer {
  const noise = rng((options.seed ?? 3) * 104729 + 17);
  const seconds = {
    whoosh: 0.8,
    swipe: 0.35,
    riser: options.duration ?? 1.5,
    impact: 2,
    'sub-drop': 1.2,
    pop: 0.15,
    tick: 0.05,
    shimmer: 1.6,
  }[kind];
  if (!seconds) throw new Error(`Unknown sound "${kind}". Use one of: ${Object.keys(SFX_KINDS).join(', ')}.`);
  const tail = kind === 'impact' || kind === 'shimmer' ? 0.6 : 0.1;
  const bus = new Bus(Math.ceil((seconds + tail) * SR));
  const kit: Kit = { bus, noise };
  switch (kind) {
    case 'whoosh':
    case 'swipe': {
      const length = Math.round(seconds * SR);
      const peak = kind === 'whoosh' ? 0.6 : 0.45;
      const bpL = new Biquad();
      const bpR = new Biquad();
      for (let i = 0; i < length; i++) {
        const p = i / length;
        const shape = p < peak ? (p / peak) ** 2 : ((1 - p) / (1 - peak)) ** 1.6;
        if (i % 32 === 0) {
          const center = 350 + (kind === 'whoosh' ? 2600 : 4200) * shape;
          bpL.set('bp', center, 1.1);
          bpR.set('bp', center * 1.08, 1.1);
        }
        const pan = (p - 0.5) * 1.2;
        bus.l[i] += bpL.run(noise() * 2 - 1) * shape * (1 - pan * 0.5) * 1.6;
        bus.r[i] += bpR.run(noise() * 2 - 1) * shape * (1 + pan * 0.5) * 1.6;
      }
      break;
    }
    case 'riser':
      riser(kit, seconds, seconds, 1);
      break;
    case 'impact':
      boom(kit, 0, 1);
      crash(kit, 0, 0.5, 1.6);
      clap(kit, 0, 0.5);
      break;
    case 'sub-drop': {
      let phase = 0;
      for (let i = 0; i < Math.round(seconds * SR); i++) {
        const s = i / SR;
        phase += (TAU * (30 + 45 * Math.exp(-s * 3))) / SR;
        bus.add(i, Math.tanh(Math.sin(phase) * 1.8) * Math.min(1, i / 100) * Math.exp(-s * 2.2) * 0.9);
      }
      break;
    }
    case 'pop': {
      let phase = 0;
      for (let i = 0; i < Math.round(seconds * SR); i++) {
        const s = i / SR;
        phase += (TAU * (340 + 900 * Math.exp(-s * 45))) / SR;
        bus.add(i, Math.sin(phase) * Math.min(1, i / 30) * Math.exp(-s * 32) * 0.9);
      }
      break;
    }
    case 'tick': {
      const bp = new Biquad('bp', 3200, 3);
      for (let i = 0; i < Math.round(seconds * SR); i++) {
        const s = i / SR;
        bus.add(i, bp.run(noise() * 2 - 1) * Math.exp(-s * 160) * 2.5 + Math.sin(TAU * 1800 * s) * Math.exp(-s * 220) * 0.4, 0.1);
      }
      break;
    }
    case 'shimmer': {
      const notes = [84, 88, 91, 95, 96, 100];
      notes.forEach((note, k) => marimba(bus, k * 0.06, note, 0.55, k / notes.length - 0.5));
      const wet = reverb(bus, 0.85, 0.2);
      bus.mix(wet, 0.9);
      break;
    }
  }
  // Every effect peaks at -3 dBFS; set the level in the composition with data-volume.
  let peak = 0;
  for (let i = 0; i < bus.length; i++) peak = Math.max(peak, Math.abs(bus.l[i]), Math.abs(bus.r[i]));
  const gain = peak > 0 ? 0.708 / peak : 1;
  const fade = Math.round(0.01 * SR);
  for (let i = 0; i < bus.length; i++) {
    const edge = Math.min(1, (bus.length - 1 - i) / fade);
    bus.l[i] *= gain * edge;
    bus.r[i] *= gain * edge;
  }
  return encodeWav(bus);
}
