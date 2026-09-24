import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timelineIssues, type TimelineReport } from './audit';
import type { Browser } from './browser';
import { Stage, type Composition } from './composition';
import { run } from './ffmpeg';
import type { Format } from './formats';
import type { AudioTrack, TextSample } from './runtime';

export interface VideoOptions {
  composition: Composition;
  format: Format;
  duration: number;
  fps: number;
  out: string;
  /** Frame 0 and the .jpg thumbnail; picked from the timeline when not given. */
  posterTime?: number;
  draft: boolean;
  audio: AudioTrack[];
  ffmpeg: string;
  /** Target loudness in LUFS (default -14); null keeps the mix as it is. */
  loudness?: number | null;
  onProgress?: (done: number, total: number) => void;
}

export interface VideoResult {
  out: string;
  poster: string;
  posterTime: number;
  width: number;
  height: number;
  frames: number;
  audio: string[];
  skippedAudio: string[];
  /** Integrated loudness of the mix before and of the MP4 after normalization (LUFS), and its true peak (dBTP). */
  loudness: { before: number; after: number; peak: number } | null;
  timeline: TimelineReport;
  captureSeconds: number;
  encodeSeconds: number;
}

/** ffmpeg filter graph that places, trims, fades and mixes the composition's <audio data-tilecast> tracks. */
export function audioGraph(
  tracks: AudioTrack[],
  duration: number,
  firstInput = 1,
): { inputs: string[]; filter: string | null; used: string[]; skipped: string[] } {
  const inputs: string[] = [];
  const chains: string[] = [];
  const used: string[] = [];
  const skipped: string[] = [];
  for (const track of tracks) {
    const file = track.src.startsWith('file:') ? fileURLToPath(track.src) : null;
    if (!file || !existsSync(file)) {
      skipped.push(track.src || '(no src)');
      continue;
    }
    const playFor = Math.min(track.duration ?? Infinity, duration - track.start);
    if (playFor <= 0.01) continue;
    const index = used.length + firstInput;
    if (track.loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', file);
    const chain = [
      `atrim=start=${track.trim.toFixed(3)}${Number.isFinite(playFor) ? `:duration=${playFor.toFixed(3)}` : ''}`,
      'asetpts=PTS-STARTPTS',
      'aformat=sample_rates=48000:channel_layouts=stereo',
    ];
    if (track.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${track.fadeIn.toFixed(3)}`);
    if (track.fadeOut > 0 && Number.isFinite(playFor)) {
      chain.push(`afade=t=out:st=${Math.max(0, playFor - track.fadeOut).toFixed(3)}:d=${track.fadeOut.toFixed(3)}`);
    }
    chain.push(`volume=${track.volume.toFixed(3)}`);
    const delay = Math.round(track.start * 1000);
    if (delay > 0) chain.push(`adelay=${delay}|${delay}`);
    // Every track runs the full length, so the mix level stays constant as short effects end.
    chain.push('apad', `atrim=duration=${duration.toFixed(3)}`);
    chains.push(`[${index}:a]${chain.join(',')}[a${index}]`);
    used.push(file);
  }
  if (!used.length) return { inputs, filter: null, used, skipped };
  const labels = used.map((_, i) => `[a${i + firstInput}]`).join('');
  const mix = used.length > 1 ? `${labels}amix=inputs=${used.length}:duration=longest:dropout_transition=0,volume=${used.length}` : `${labels}anull`;
  return { inputs, filter: `${chains.join(';')};${mix}[aout]`, used, skipped };
}

/** Integrated loudness (LUFS) and true peak (dBTP) of an audio file, by EBU R128. */
export async function measureLoudness(ffmpeg: string, file: string): Promise<{ lufs: number; peak: number }> {
  const log = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const last = (pattern: RegExp) => {
    const values = [...log.matchAll(pattern)].map((m) => (m[1] === '-inf' ? -Infinity : Number(m[1])));
    return values.length ? values[values.length - 1] : -Infinity;
  };
  return { lufs: last(/I:\s+(-?[\d.]+|-inf) LUFS/g), peak: last(/Peak:\s+(-?[\d.]+|-inf) dBFS/g) };
}

/** Peak ceiling after the gain: -1.4 dBFS on samples keeps true peaks under -1 dBTP after AAC. */
const CEILING = 0.85;

/**
 * Mixes the tracks to one file, measures it and returns the gain that brings it
 * to `target` LUFS (the level social platforms play at), with a limiter guarding
 * the peaks. Silence and near-silence are left alone.
 */
async function mixAndMeasure(ffmpeg: string, tracks: AudioTrack[], duration: number, dir: string, target: number | null) {
  const graph = audioGraph(tracks, duration, 0);
  if (!graph.filter) return { ...graph, file: null, before: null, gain: 0 };
  const file = path.join(dir, 'mix.wav');
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...graph.inputs, '-filter_complex', graph.filter, '-map', '[aout]', '-c:a', 'pcm_f32le', '-ar', '48000', file], {
    timeoutMs: 600_000,
  });
  const before = await measureLoudness(ffmpeg, file);
  const gain = target === null || !Number.isFinite(before.lufs) || before.lufs < -60 ? 0 : Math.max(-20, Math.min(12, target - before.lufs));
  return { ...graph, file, before, gain };
}

/** How many parallel capture workers suit a clip of this many frames on this machine. */
export function captureWorkers(frames: number): number {
  return Math.max(1, Math.min(4, os.cpus().length, Math.ceil(frames / 24)));
}

/**
 * Captures every frame as a pure function of time in parallel, one worker per
 * browser process (tabs of one browser share its compositor), then encodes
 * H.264 + AAC. Frame 0 is the poster frame, so every platform's thumbnail
 * shows the best settled moment rather than a blank first frame.
 */
export async function renderVideo(browserOrBrowsers: Browser | Browser[], options: VideoOptions): Promise<VideoResult> {
  const browsers = Array.isArray(browserOrBrowsers) ? browserOrBrowsers : [browserOrBrowsers];
  const browser = browsers[0];
  const { fps, format } = options;
  const frames = Math.max(2, Math.round(options.duration * fps));
  const zoom = options.draft ? 0.5 : 1;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tilecast-frames-'));
  const frameFile = (i: number) => path.join(dir, `f${String(i).padStart(6, '0')}.jpg`);
  const quality = options.draft ? 82 : 94;
  // The timeline is sampled ten times a second while capturing, for reading time and the poster pick.
  const sampleEvery = Math.max(1, Math.round(fps / 10));
  const samples: { t: number; texts: TextSample[] }[] = [];
  const started = Date.now();
  let done = 0;
  try {
    const workers = browsers.length > 1 ? browsers.length : captureWorkers(frames - 1);
    const perWorker = Math.ceil((frames - 1) / workers);
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        const first = 1 + worker * perWorker;
        const last = Math.min(frames - 1, first + perWorker - 1);
        if (first > last) return;
        const stage = await Stage.open(browsers[worker % browsers.length], options.composition, format, 1);
        try {
          if (worker === 0) samples.push({ t: 0, texts: await stage.sample() });
          for (let i = first; i <= last; i++) {
            await stage.seek(i / fps);
            if (i % sampleEvery === 0) samples.push({ t: i / fps, texts: await stage.sample() });
            await writeFile(frameFile(i), await stage.capture({ type: 'jpeg', quality, zoom }));
            options.onProgress?.(++done, frames);
          }
        } finally {
          await stage.close();
        }
      }),
    );
    samples.sort((a, b) => a.t - b.t);
    const timeline = timelineIssues(samples, sampleEvery / fps, format, frames / fps);
    const posterTime = Math.min(Math.max(0, options.posterTime ?? timeline.posterTime), frames / fps);

    const poster = await Stage.open(browser, options.composition, format, 1);
    try {
      await poster.seek(posterTime);
      await writeFile(frameFile(0), await poster.capture({ type: 'jpeg', quality: 95, zoom }));
    } finally {
      await poster.close();
    }
    options.onProgress?.(frames, frames);
    const captureSeconds = (Date.now() - started) / 1000;

    const audio = await mixAndMeasure(options.ffmpeg, options.audio, frames / fps, dir, options.loudness === undefined ? -14 : options.loudness);
    await mkdir(path.dirname(options.out), { recursive: true });
    const width = Math.floor((format.width * zoom) / 2) * 2;
    const height = Math.floor((format.height * zoom) / 2) * 2;
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      String(fps),
      '-i',
      path.join(dir, 'f%06d.jpg'),
      ...(audio.file
        ? ['-i', audio.file, '-map', '0:v', '-map', '1:a', '-af', `volume=${audio.gain.toFixed(2)}dB,alimiter=limit=${CEILING}:level=false`, '-c:a', 'aac', '-b:a', '192k']
        : ['-an']),
      // Screenshots are sRGB; convert with the BT.709 matrix and tag it, so players show the same colors.
      '-vf',
      `scale=${width}:${height}:in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      options.draft ? 'veryfast' : 'medium',
      '-crf',
      options.draft ? '26' : '18',
      '-profile:v',
      'high',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      '-r',
      String(fps),
      '-t',
      (frames / fps).toFixed(3),
      '-movflags',
      '+faststart',
      options.out,
    ];
    const encodeStart = Date.now();
    await run(options.ffmpeg, args, { timeoutMs: 1_800_000 });
    const after = audio.file ? await measureLoudness(options.ffmpeg, options.out) : null;
    const posterFile = options.out.replace(/\.mp4$/i, '') + '.jpg';
    await copyFile(frameFile(0), posterFile);
    return {
      out: options.out,
      poster: posterFile,
      posterTime,
      width,
      height,
      frames,
      audio: audio.used,
      skippedAudio: audio.skipped,
      loudness: audio.before && after ? { before: audio.before.lufs, after: after.lufs, peak: after.peak } : null,
      timeline,
      captureSeconds,
      encodeSeconds: (Date.now() - encodeStart) / 1000,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
