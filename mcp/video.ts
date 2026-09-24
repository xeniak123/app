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
  timeline: TimelineReport;
  captureSeconds: number;
  encodeSeconds: number;
}

/** ffmpeg filter graph that places, trims, fades and mixes the composition's <audio data-tilecast> tracks. */
export function audioGraph(tracks: AudioTrack[], duration: number): { inputs: string[]; filter: string | null; used: string[]; skipped: string[] } {
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
    const index = used.length + 1;
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
  const labels = used.map((_, i) => `[a${i + 1}]`).join('');
  const mix = used.length > 1 ? `${labels}amix=inputs=${used.length}:duration=longest:dropout_transition=0,volume=${used.length}` : `${labels}anull`;
  return { inputs, filter: `${chains.join(';')};${mix},alimiter=limit=0.95[aout]`, used, skipped };
}

/**
 * Captures every frame as a pure function of time in parallel tabs, then
 * encodes H.264 + AAC. Frame 0 is the poster frame, so every platform's
 * thumbnail shows the best settled moment rather than a blank first frame.
 */
export async function renderVideo(browser: Browser, options: VideoOptions): Promise<VideoResult> {
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
    const workers = Math.max(1, Math.min(4, os.cpus().length, Math.ceil((frames - 1) / 24)));
    const perWorker = Math.ceil((frames - 1) / workers);
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        const first = 1 + worker * perWorker;
        const last = Math.min(frames - 1, first + perWorker - 1);
        if (first > last) return;
        const stage = await Stage.open(browser, options.composition, format, 1);
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

    const audio = audioGraph(options.audio, frames / fps);
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
      ...audio.inputs,
      ...(audio.filter ? ['-filter_complex', audio.filter, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
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
      timeline,
      captureSeconds,
      encodeSeconds: (Date.now() - encodeStart) / 1000,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
