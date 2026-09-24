import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flatness, formatIssues, frameIssues, timelineIssues, type Issue, type Readability } from './audit';
import { BrowserPool, findChrome, type Browser } from './browser';
import { loadComposition, resolveInside, Stage, stillTime, type Composition } from './composition';
import { analyzeBeats, ANALYSIS_RATE, energyBar } from './beats';
import { decodeAudio, ensureFfmpeg } from './ffmpeg';
import { FONT_FAMILIES } from './fonts';
import { customFormat, FORMATS, getFormat, outputSize, type Format } from './formats';
import { findIcons, iconSvg, ICON_COUNT } from './icons';
import { decodePng } from './png';
import type { CompositionInfo, TextSample } from './runtime';
import { makeMusic, makeSfx, SFX_KINDS, type MusicStyle, type SfxKind } from './music';
import { soundEffectFile, SOUND_EFFECTS } from './sfx';
import { contactSheet, SHEET_GAP, SHEET_PAD, type SheetItem } from './sheet';
import { captureWorkers, renderVideo } from './video';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export type Progress = (done: number, total: number, message?: string) => void;

const text = (value: string): Content => ({ type: 'text', text: value });
const image = (data: Buffer, mimeType: 'image/png' | 'image/jpeg'): Content => ({ type: 'image', data: data.toString('base64'), mimeType });
const seconds = (t: number) => `${Number(t.toFixed(2))}s`;

/** Largest image side worth sending to a vision model; bigger images are downscaled anyway. */
const SHEET_WIDTH = 1568;

/** Content of <meta name="tilecast:NAME" content="..."> in the composition source. */
export function metaContent(source: string, name: string): string | null {
  for (const tag of source.matchAll(/<meta\b[^>]*>/gi)) {
    const metaName = tag[0].match(/\bname\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (metaName?.toLowerCase() !== `tilecast:${name}`) continue;
    const content = tag[0].match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return content ? (content[1] ?? content[2] ?? content[3] ?? '') : null;
  }
  return null;
}

/** A format id ("story") or a custom size ("1500x500"). */
export function parseFormat(spec: string): Format {
  const custom = spec.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  return custom ? customFormat(Number(custom[1]), Number(custom[2])) : getFormat(spec.trim());
}

function isVideo(comp: Composition): boolean {
  return metaContent(comp.source, 'duration') !== null;
}

/** Requested formats, else the composition's tilecast:formats, else landscape for video and A4 for print. */
export function resolveFormats(comp: Composition, requested?: string[]): Format[] {
  const specs = requested?.length ? requested : (metaContent(comp.source, 'formats') ?? '').split(/[\s,]+/).filter(Boolean);
  const formats = specs.length ? specs.map(parseFormat) : [getFormat(isVideo(comp) ? 'landscape' : 'poster-a4')];
  return [...new Map(formats.map((f) => [f.id, f])).values()];
}

interface Moment {
  t: number;
  label: string;
}

/** Stills that show a video: every scene once it has settled, and each cut while it happens. */
export function filmstripMoments(info: CompositionInfo, duration: number, limit = 12): Moment[] {
  const starts = info.scenes.filter((s) => s < duration - 0.1);
  if (!starts.length || starts[0] > 0.05) starts.unshift(0);
  if (starts.length < 2) {
    const count = Math.min(limit, Math.max(4, Math.round(duration / 2)));
    return Array.from({ length: count }, (_, i) => {
      const t = ((i + 0.6) * duration) / count;
      return { t, label: seconds(t) };
    });
  }
  const holds: Moment[] = [];
  const cuts: Moment[] = [];
  starts.forEach((start, i) => {
    const end = starts[i + 1] ?? duration;
    holds.push({ t: start + (end - start) * 0.62, label: `${seconds(start + (end - start) * 0.62)} · scene ${i + 1}` });
    if (i > 0) cuts.push({ t: start + Math.min(0.15, (end - start) * 0.2), label: `${seconds(start + Math.min(0.15, (end - start) * 0.2))} · cut ${i}→${i + 1}` });
  });
  const moments = [...holds, ...cuts.slice(0, Math.max(0, limit - holds.length))].slice(0, limit);
  return moments.sort((a, b) => a.t - b.t);
}

/** Row height that fits `count` stills of one aspect ratio into a sheet about as tall as it is wide. */
function filmstripRowHeight(format: Format, count: number): number {
  const aspect = format.width / format.height;
  for (let columns = 1; columns <= count; columns++) {
    const width = (SHEET_WIDTH - SHEET_PAD * 2 - SHEET_GAP * (columns - 1)) / columns;
    const height = width / aspect;
    const rows = Math.ceil(count / columns);
    if (rows * (height + 30 + SHEET_GAP) + SHEET_PAD * 2 <= 1400) return Math.floor(height);
  }
  return 160;
}

/** Row height that puts every format side by side in one row. */
function formatsRowHeight(formats: Format[]): number {
  const aspects = formats.reduce((sum, f) => sum + f.width / f.height, 0);
  const fit = (SHEET_WIDTH - SHEET_PAD * 2 - SHEET_GAP * (formats.length - 1)) / aspects;
  return Math.floor(Math.min(formats.length === 1 ? 1400 : 1000, fit));
}

/** Zoom that captures a still big enough to measure contrast but no bigger. */
const auditZoom = (format: Format) => Math.min(1, 900 / Math.min(format.width, format.height));

async function inspectFrame(stage: Stage, where: string, video: boolean): Promise<{ issues: Issue[]; png: Buffer }> {
  const [audit, png] = await Promise.all([stage.audit(), stage.capture({ zoom: auditZoom(stage.format) })]);
  let pixels = null;
  try {
    pixels = decodePng(png);
  } catch {
    // Contrast is skipped if the capture cannot be decoded.
  }
  return { issues: frameIssues(audit, pixels, where, video), png };
}

/** Samples the text on screen every `step` seconds, in parallel pages that each only move forward in time. */
async function sampleTimeline(browsers: Browser[], comp: Composition, format: Format, duration: number, step: number) {
  const count = Math.floor(duration / step + 1e-9) + 1;
  const times = Array.from({ length: count }, (_, i) => Math.min(i * step, duration - 0.001));
  const workers = browsers.length > 1 ? browsers.length : Math.max(1, Math.min(4, os.cpus().length, Math.ceil(count / 40)));
  const per = Math.ceil(count / workers);
  const chunks = await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      const slice = times.slice(w * per, (w + 1) * per);
      if (!slice.length) return [];
      const stage = await Stage.open(browsers[w % browsers.length], comp, format, 1);
      try {
        const out: { t: number; texts: TextSample[] }[] = [];
        for (const t of slice) {
          await stage.seek(t);
          out.push({ t, texts: await stage.sample() });
        }
        return out;
      } finally {
        await stage.close();
      }
    }),
  );
  return chunks.flat();
}

function readabilityTable(texts: Readability[]): string {
  if (!texts.length) return '';
  const rows = [...texts]
    .sort((a, b) => (a.appearsAt ?? 0) - (b.appearsAt ?? 0))
    .map((r) => {
      const ok = r.seconds >= r.need ? '✓' : '✗';
      const label = r.text.length > 50 ? `${r.text.slice(0, 47)}…` : r.text;
      return `  ${ok} ${seconds(r.appearsAt ?? 0).padStart(6)}  ${r.seconds.toFixed(1)}s held / ${r.need.toFixed(1)}s needed  "${label}"`;
    });
  return `Reading time (fully visible and still):\n${rows.join('\n')}`;
}

function describeComposition(comp: Composition, info: CompositionInfo, format: Format): string {
  const parts = [`${comp.relative} · ${format.label} ${format.width}×${format.height}`];
  if (info.duration !== null) parts.push(`${seconds(info.duration)} video${info.scenes.length ? `, ${info.scenes.length} scenes` : ''}`);
  if (comp.fonts.length) parts.push(`fonts: ${[...new Set(comp.fonts.map((f) => f.family))].join(', ')}`);
  return parts.join(' · ');
}

async function fileSize(file: string): Promise<string> {
  const { size } = await stat(file);
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;
}

export class TilecastService {
  readonly pool: BrowserPool;

  constructor(
    readonly root: string,
    options: { chrome?: () => string | null; idleMs?: number } = {},
  ) {
    this.pool = new BrowserPool(options.chrome ?? (() => findChrome()), options.idleMs);
  }

  private relative(file: string): string {
    return path.relative(this.root, file) || '.';
  }

  private outputDir(comp: Composition, requested?: string): string {
    return requested ? resolveInside(this.root, requested) : path.join(path.dirname(comp.file), 'export');
  }

  /** Stills of the composition: every format side by side, or a filmstrip of a video's scenes and cuts. */
  async preview(args: { file: string; formats?: string[]; time?: number; times?: number[] }): Promise<ToolResult> {
    const comp = await loadComposition(this.root, args.file);
    const formats = resolveFormats(comp, args.formats);
    return this.pool.use(async (browser) => {
      const items: SheetItem[] = [];
      const issues: Issue[] = [];
      const lines: string[] = [];
      const filmstrip = isVideo(comp) || Boolean(args.times?.length);

      if (filmstrip) {
        const format = formats[0];
        const stage = await Stage.open(browser, comp, format, 1);
        try {
          const info = await stage.info();
          const duration = info.duration ?? Math.max(info.animationEnd, 1);
          const moments = args.times?.length
            ? [...args.times].sort((a, b) => a - b).map((t) => ({ t, label: seconds(t) }))
            : filmstripMoments(info, duration);
          lines.push(describeComposition(comp, info, format));
          const rowHeight = filmstripRowHeight(format, moments.length);
          for (const moment of moments) {
            await stage.seek(moment.t);
            const frame = await inspectFrame(stage, seconds(moment.t), true);
            issues.push(...frame.issues);
            items.push({
              label: moment.label,
              image: await stage.capture({ type: 'jpeg', quality: 85, zoom: Math.min(1, (rowHeight * 1.5) / format.height) }),
              mime: 'image/jpeg',
              width: format.width,
              height: format.height,
            });
          }
          const sheet = await contactSheet(browser, items, { rowHeight, maxWidth: SHEET_WIDTH, type: 'jpeg' });
          if (formats.length > 1) lines.push(`Showing ${format.id}; pass formats: ["${formats[1].id}"] to see another format.`);
          lines.push(`Stills at: ${moments.map((m) => m.label).join(', ')}`);
          lines.push(issues.length ? `Quick look ${formatIssues(issues)}` : 'Quick look: no layout, contrast or font problems in these stills.');
          lines.push('Run check for the full gate: it follows every text through the whole timeline for reading time.');
          return { content: [text(lines.join('\n')), image(sheet, 'image/jpeg')] };
        } finally {
          await stage.close();
        }
      }

      const rowHeight = formatsRowHeight(formats);
      for (const format of formats) {
        const stage = await Stage.open(browser, comp, format, 1);
        try {
          const info = await stage.info();
          const t = stillTime(info, args.time);
          await stage.seek(t);
          const frame = await inspectFrame(stage, format.id, false);
          issues.push(...frame.issues);
          lines.push(`${describeComposition(comp, info, format)} · still at ${seconds(t)}`);
          items.push({
            label: `${format.label} · ${format.width}×${format.height}`,
            image: await stage.capture({ type: 'jpeg', quality: 88, zoom: Math.min(1, (rowHeight * 1.5) / format.height) }),
            mime: 'image/jpeg',
            width: format.width,
            height: format.height,
          });
        } finally {
          await stage.close();
        }
      }
      const sheet = await contactSheet(browser, items, { rowHeight, maxWidth: SHEET_WIDTH, type: 'jpeg' });
      lines.push(issues.length ? formatIssues(issues) : 'PASS: no layout, contrast or font problems found.');
      return { content: [text(lines.join('\n')), image(sheet, 'image/jpeg')] };
    });
  }

  /** The design critic: layout, contrast, fonts, images and, for video, reading time over the whole timeline. */
  async check(args: { file: string; formats?: string[]; time?: number }): Promise<ToolResult> {
    const comp = await loadComposition(this.root, args.file);
    const formats = resolveFormats(comp, args.formats);
    // A video's timeline is sampled in several browser processes at once.
    const processes = isVideo(comp) ? Math.max(1, Math.min(4, os.cpus().length)) : 1;
    return this.pool.useMany(processes, async (browsers) => {
      const browser = browsers[0];
      const reports: string[] = [];
      let failed = false;
      for (const format of formats) {
        const stage = await Stage.open(browser, comp, format, 1);
        const issues: Issue[] = [];
        const lines: string[] = [];
        try {
          const info = await stage.info();
          lines.push(`CHECK ${describeComposition(comp, info, format)}`);
          if (info.duration === null) {
            const t = stillTime(info, args.time);
            await stage.seek(t);
            issues.push(...(await inspectFrame(stage, `${format.id} @ ${seconds(t)}`, false)).issues);
            lines.push(formatIssues(issues));
          } else {
            const duration = info.duration;
            // A stage only moves forward in time, so every look happens in time order.
            type Look = { t: number; label: string; kind: 'still' | 'opening' | 'ending' };
            const looks: Look[] = [
              ...filmstripMoments(info, duration).map((m): Look => ({ ...m, kind: 'still' })),
              { t: Math.min(0.5, duration / 4), label: 'opening', kind: 'opening' },
              { t: duration - 0.05, label: 'last frame', kind: 'ending' },
            ];
            looks.sort((a, b) => a.t - b.t);
            for (const look of looks) {
              await stage.seek(look.t);
              if (look.kind === 'still') {
                issues.push(...(await inspectFrame(stage, look.label, true)).issues);
              } else if (flatness(decodePng(await stage.capture({ zoom: 0.25 }))) < 2) {
                issues.push({
                  level: 'warning',
                  where: seconds(look.t),
                  message:
                    look.kind === 'opening'
                      ? 'The opening is an empty frame. The hook has to land in the first 2 seconds: start with motion or the first line already on screen.'
                      : 'The video ends on an empty frame. End on the payoff: logo, product and call to action held on screen.',
                });
              }
            }
            const step = 0.1;
            const samples = await sampleTimeline(browsers, comp, format, duration, step);
            const timeline = timelineIssues(samples, step, format, duration);
            issues.push(...timeline.issues);
            if (duration > 30) {
              issues.push({ level: 'warning', where: 'duration', message: `${seconds(duration)} is long for social video; 15–25 s holds attention best.` });
            }
            for (const track of info.audio) {
              if (!track.src.startsWith('file:')) {
                issues.push({ level: 'error', where: 'audio', message: `Audio must be a local file next to the composition, not ${track.src || '(no src)'}.` });
              } else if (!existsSync(new URL(track.src))) {
                issues.push({ level: 'error', where: 'audio', message: `Audio file not found: ${decodeURIComponent(new URL(track.src).pathname)}` });
              }
            }
            lines.push(formatIssues(issues));
            lines.push(readabilityTable(timeline.texts));
            lines.push(
              `Poster frame: ${info.poster !== null ? `${seconds(info.poster)} (tilecast:poster)` : `${seconds(timeline.posterTime)} suggested, the moment with the most settled text; set <meta name="tilecast:poster" content="${Number(timeline.posterTime.toFixed(2))}"> or pass poster_time`}.`,
            );
            lines.push(
              info.audio.length
                ? `Audio: ${info.audio.length} track(s): ${info.audio.map((a) => `${decodeURIComponent(path.basename(a.src))} @${seconds(a.start)}`).join(', ')}.`
                : 'Audio: none. A silent video feels unfinished: add a music bed and a few effects on the big moments (assets tool: make_music, list_sfx).',
            );
          }
        } finally {
          await stage.close();
        }
        failed ||= issues.some((i) => i.level === 'error');
        reports.push(lines.filter(Boolean).join('\n'));
      }
      const verdict = failed ? 'Fix every ✗ and run check again before rendering.' : 'Ready to render.';
      return { content: [text(`${reports.join('\n\n')}\n\n${verdict}`)] };
    });
  }

  /** Full-resolution PNGs (and print PDFs) of every format. */
  async renderImage(args: { file: string; formats?: string[]; time?: number; out_dir?: string; pdf?: boolean }): Promise<ToolResult> {
    const comp = await loadComposition(this.root, args.file);
    const formats = resolveFormats(comp, args.formats);
    const outDir = this.outputDir(comp, args.out_dir);
    await mkdir(outDir, { recursive: true });
    return this.pool.use(async (browser) => {
      const lines: string[] = [];
      const warnings: Issue[] = [];
      for (const format of formats) {
        const stage = await Stage.open(browser, comp, format);
        try {
          const info = await stage.info();
          const t = stillTime(info, args.time);
          await stage.seek(t);
          const png = await stage.capture();
          const audit = await stage.audit();
          warnings.push(...frameIssues(audit, null, format.id, false).filter((i) => i.level === 'error'));
          const base = path.join(outDir, `${comp.name}-${format.id}`);
          await writeFile(`${base}.png`, png);
          const size = outputSize(format);
          lines.push(`  ${this.relative(`${base}.png`)}  ${size.width}×${size.height}  ${await fileSize(`${base}.png`)}  (still at ${seconds(t)})`);
          if (format.print && args.pdf !== false) {
            const jpeg = await stage.capture({ type: 'jpeg', quality: 95 });
            await writeFile(`${base}.pdf`, await printPdf(browser, jpeg, format.print));
            lines.push(`  ${this.relative(`${base}.pdf`)}  ${format.print.width}×${format.print.height} mm, ${Math.round(size.width / (format.print.width / 25.4))} dpi  ${await fileSize(`${base}.pdf`)}`);
          }
        } finally {
          await stage.close();
        }
      }
      const note = warnings.length ? `\n\nThe critic still sees problems (run check):\n${formatIssues(warnings)}` : '';
      return { content: [text(`Rendered ${comp.relative}:\n${lines.join('\n')}${note}`)] };
    });
  }

  /** An MP4 (H.264 + AAC) with the best settled frame baked in as frame 0, plus that poster as .jpg. */
  async renderVideo(
    args: { file: string; format?: string; duration?: number; fps?: number; poster_time?: number; quality?: 'final' | 'draft'; out?: string },
    progress?: Progress,
  ): Promise<ToolResult> {
    const comp = await loadComposition(this.root, args.file);
    const format = args.format ? parseFormat(args.format) : resolveFormats(comp)[0];
    const draft = args.quality === 'draft';
    const out = args.out
      ? resolveInside(this.root, args.out.endsWith('.mp4') ? args.out : `${args.out}.mp4`)
      : path.join(this.outputDir(comp), `${comp.name}-${format.id}${draft ? '-draft' : ''}.mp4`);
    progress?.(0, 1, 'Preparing ffmpeg');
    const ffmpeg = await ensureFfmpeg();
    const planned = (args.duration ?? Number(metaContent(comp.source, 'duration'))) * (args.fps ?? (Number(metaContent(comp.source, 'fps')) || 30));
    const processes = captureWorkers(Number.isFinite(planned) ? planned : 0);
    return this.pool.useMany(processes, async (browsers) => {
      const browser = browsers[0];
      const probe = await Stage.open(browser, comp, format, 1);
      let info: CompositionInfo;
      try {
        info = await probe.info();
      } finally {
        await probe.close();
      }
      const duration = args.duration ?? info.duration;
      if (!duration || duration <= 0) {
        throw new Error('The composition has no duration. Add <meta name="tilecast:duration" content="18"> (seconds) or pass duration.');
      }
      if (duration > 600) throw new Error('Videos are limited to 10 minutes.');
      const fps = args.fps ?? info.fps ?? 30;
      const result = await renderVideo(browsers, {
        composition: comp,
        format,
        duration,
        fps,
        out,
        posterTime: args.poster_time ?? info.poster ?? undefined,
        draft,
        audio: info.audio,
        ffmpeg: ffmpeg.path,
        onProgress: (done, total) => progress?.(done, total, 'Capturing frames'),
      });
      const readable = result.timeline.issues.filter((i) => i.message.includes('readable for') || i.message.includes('flashes'));
      const lines = [
        `Rendered ${this.relative(result.out)}  ${result.width}×${result.height} · ${seconds(duration)} · ${fps} fps · ${await fileSize(result.out)}${draft ? ' · DRAFT (half size)' : ''}`,
        `Poster: ${this.relative(result.poster)} (frame 0 = ${seconds(result.posterTime)}${args.poster_time === undefined && info.poster === null ? ', picked as the most settled moment' : ''})`,
        result.audio.length
          ? `Audio: ${result.audio.map((a) => path.basename(a)).join(', ')}`
          : 'Audio: none (silent video).',
        ...(result.skippedAudio.length ? [`Skipped audio (missing or remote): ${result.skippedAudio.join(', ')}`] : []),
        `Time: ${result.captureSeconds.toFixed(1)}s capturing ${result.frames} frames, ${result.encodeSeconds.toFixed(1)}s encoding${ffmpeg.installed ? ' (ffmpeg was downloaded once into the cache)' : ''}.`,
        ...(readable.length ? ['', `Reading time ${formatIssues(readable)}`] : []),
      ];
      const thumb = await posterThumb(browser, result.poster, result.width, result.height);
      return { content: [text(lines.join('\n')), image(thumb, 'image/jpeg')] };
    });
  }

  async assets(args: {
    action: 'list_fonts' | 'find_icons' | 'get_icons' | 'list_sfx' | 'add_sfx' | 'make_music' | 'make_sfx' | 'analyze_music' | 'list_formats';
    file?: string;
    query?: string;
    names?: string[];
    dir?: string;
    size?: number;
    stroke_width?: number;
    style?: string;
    duration?: number;
    bpm?: number;
    key?: string;
    seed?: number;
    name?: string;
  }): Promise<ToolResult> {
    switch (args.action) {
      case 'make_music': {
        if (!args.dir) throw new Error('make_music needs dir: the folder to write into, usually next to the composition (e.g. "promo/launch/audio").');
        if (!args.duration) throw new Error('make_music needs duration: the video length in seconds.');
        const style = (args.style ?? 'upbeat') as MusicStyle;
        const music = makeMusic({ style, duration: args.duration, bpm: args.bpm, key: args.key, seed: args.seed });
        const dir = resolveInside(this.root, args.dir);
        await mkdir(dir, { recursive: true });
        const base = (args.name ?? `music-${style}`).replace(/\.wav$/i, '');
        const wav = path.join(dir, `${base}.wav`);
        await writeFile(wav, music.wav);
        const cues = {
          file: `${base}.wav`,
          style,
          bpm: music.bpm,
          key: music.key,
          duration: music.duration,
          beat: Number((60 / music.bpm).toFixed(4)),
          strong: music.strong,
          sections: music.sections,
          downbeats: music.downbeats,
          beats: music.beats,
        };
        await writeFile(path.join(dir, `${base}.cues.json`), `${JSON.stringify(cues, null, 2)}\n`);
        const beat = 60 / music.bpm;
        return {
          content: [
            text(
              [
                `Wrote ${this.relative(wav)} (${seconds(music.duration)}, ${style}, ${music.bpm} BPM, ${music.key}) and ${base}.cues.json.`,
                `Beat every ${beat.toFixed(3)}s; a bar every ${(beat * 4).toFixed(3)}s: ${music.downbeats.map((t) => seconds(t)).join(', ')}.`,
                'Strong cues: move the big moments to land within ±0.15s of these:',
                ...music.strong.map((c) => `  ${seconds(c.t).padEnd(8)} ${c.what}`),
                `Sections: ${music.sections.map((sec) => `${sec.name} ${seconds(sec.start)}–${seconds(sec.end)}`).join(' · ')}.`,
                'Snap sequential entrances (cards, list items, words) to consecutive beats; for lines people must read, use every other beat and hold them.',
                `Add it to the composition (path relative to the .html): <audio data-tilecast src="…/${base}.wav" data-start="0" data-volume="0.8"></audio>`,
                'Not the right feel? Try another style, bpm or seed; or use the user\'s own track instead.',
              ].join('\n'),
            ),
          ],
        };
      }
      case 'analyze_music': {
        if (!args.file) throw new Error('analyze_music needs file: the track inside the project, e.g. "promo/audio/song.mp3".');
        const track = resolveInside(this.root, args.file);
        if (!existsSync(track)) throw new Error(`Cannot find ${args.file}. Copy the track into the project first.`);
        const ffmpeg = await ensureFfmpeg();
        const found = analyzeBeats(await decodeAudio(ffmpeg.path, track, ANALYSIS_RATE));
        const cuesFile = track.replace(/\.[^./\\]+$/, '') + '.cues.json';
        const beat = 60 / found.bpm;
        await writeFile(
          cuesFile,
          `${JSON.stringify({ file: path.basename(track), analyzed: true, bpm: found.bpm, beat: Number(beat.toFixed(4)), duration: found.duration, strong: found.strong, energy: found.energy, downbeats: found.downbeats, beats: found.beats }, null, 2)}\n`,
        );
        const firstBar = found.downbeats[0] ?? found.beats[0] ?? 0;
        return {
          content: [
            text(
              [
                `${this.relative(track)}: ${seconds(found.duration)}, about ${found.bpm} BPM (a beat every ${beat.toFixed(3)}s, a bar every ${(beat * 4).toFixed(3)}s). Wrote ${this.relative(cuesFile)}.`,
                `First beat ${seconds(found.beats[0] ?? 0)}; bars start at ${seconds(firstBar)}, ${found.downbeats.slice(1, 8).map((t) => seconds(t)).join(', ')}${found.downbeats.length > 8 ? ', …' : ''}.`,
                `Energy by bar: ${energyBar(found.energy)} (quiet ▁ … loud █).`,
                'Strong cues: land the big moments within ±0.15s of these:',
                ...found.strong.map((c) => `  ${seconds(c.t).padEnd(8)} ${c.what}`),
                found.confidence < 0.05
                  ? 'The pulse is weak (free time, ambient or live playing): treat the grid as approximate and trust the energy curve more.'
                  : 'Snap sequential entrances to consecutive beats; for lines people must read, use every other beat and hold them.',
                'Trim the track to the video with data-trim (start) and data-duration, and fade it out with data-fade-out so it ends with the video.',
              ].join('\n'),
            ),
          ],
        };
      }
      case 'make_sfx': {
        if (!args.names?.length) throw new Error(`make_sfx needs names: ${Object.keys(SFX_KINDS).join(', ')}.`);
        if (!args.dir) throw new Error('make_sfx needs dir: the folder to write into, usually next to the composition.');
        const dir = resolveInside(this.root, args.dir);
        await mkdir(dir, { recursive: true });
        const written: string[] = [];
        for (const name of args.names) {
          if (!(name in SFX_KINDS)) throw new Error(`Unknown sound "${name}". Use one of: ${Object.keys(SFX_KINDS).join(', ')}.`);
          const file = path.join(dir, `${name}.wav`);
          await writeFile(file, makeSfx(name as SfxKind, { duration: args.duration, seed: args.seed }));
          written.push(`  ${this.relative(file)}  ${SFX_KINDS[name as SfxKind]}`);
        }
        return { content: [text(`Wrote:\n${written.join('\n')}\nEach peaks at -3 dBFS; set the level with data-volume (0.3–0.7 under music).`)] };
      }
      case 'list_formats':
        return {
          content: [
            text(
              [
                'Formats (design in CSS pixels at width×height; images export at ×scale):',
                ...FORMATS.map(
                  (f) =>
                    `  ${f.id.padEnd(10)} ${`${f.width}×${f.height}`.padEnd(10)} ×${f.scale} → ${outputSize(f).width}×${outputSize(f).height}  ${f.note}${f.print ? ', PDF too' : ''}`,
                ),
                '  WIDTHxHEIGHT  any custom size, e.g. "1500x500" (X header), "1200x628"',
              ].join('\n'),
            ),
          ],
        };
      case 'list_fonts':
        return {
          content: [
            text(
              [
                'Bundled fonts (OFL, work offline; just use the family name in CSS, with Latin + Polish/Central European accents):',
                ...FONT_FAMILIES.map((f) => `  ${`"${f.family}"`.padEnd(24)} ${f.category.padEnd(9)} ${f.variable ? `weights ${f.weights}` : `weight ${f.weights}`}${f.italic ? ' + italic' : ''}  ${f.note}`),
                'Pairings that work: Bricolage Grotesque + Inter · Fraunces + Inter · Instrument Serif + Instrument Sans · Anton + Space Mono · Unbounded + Manrope · Playfair Display + Manrope · Archivo Black + Archivo · Syne + Space Grotesk.',
                'Any other font needs a local file: save the .woff2 next to the composition and declare it with @font-face.',
              ].join('\n'),
            ),
          ],
        };
      case 'find_icons': {
        if (!args.query) throw new Error('find_icons needs a query, e.g. "coffee cup" or "rocket launch".');
        const names = findIcons(args.query);
        return {
          content: [
            text(
              names.length
                ? `Lucide icons for "${args.query}" (best first): ${names.join(', ')}\nGet the SVG with get_icons.`
                : `No icons match "${args.query}". Try a simpler English word (${ICON_COUNT} icons available).`,
            ),
          ],
        };
      }
      case 'get_icons': {
        if (!args.names?.length) throw new Error('get_icons needs names (from find_icons).');
        const found: string[] = [];
        const missing: string[] = [];
        for (const name of args.names) {
          const svg = iconSvg(name, { size: args.size, strokeWidth: args.stroke_width });
          if (svg) found.push(`${name}:\n${svg}`);
          else missing.push(name);
        }
        const notes = [
          'Inline these <svg> elements in the composition. They draw with currentColor, so set `color` in CSS; size with width/height or CSS.',
          ...(missing.length ? [`Unknown: ${missing.join(', ')} (use find_icons).`] : []),
        ];
        return { content: [text(`${found.join('\n\n')}\n\n${notes.join('\n')}`)] };
      }
      case 'list_sfx':
        return {
          content: [
            text(
              [
                'Sound effects (CC0, Kenney.nl). Copy the ones you use with add_sfx, then place them with <audio data-tilecast src="…" data-start="2.4" data-volume="0.5">.',
                ...SOUND_EFFECTS.map((s) => `  ${s.name.padEnd(11)} ${`${s.seconds}s`.padEnd(6)} ${s.character}; ${s.use}`),
                'Generated with make_sfx (WAV): ' + Object.entries(SFX_KINDS).map(([k, v]) => `${k}: ${v}`).join('; ') + '.',
                'Mixing: effects sit under the music (volume 0.3–0.6), land exactly on the visual hit, and repeat sparingly.',
              ].join('\n'),
            ),
          ],
        };
      case 'add_sfx': {
        if (!args.names?.length) throw new Error('add_sfx needs names (see list_sfx).');
        if (!args.dir) throw new Error('add_sfx needs dir: the folder to copy into, e.g. next to the composition ("promo/sfx").');
        const dir = resolveInside(this.root, args.dir);
        await mkdir(dir, { recursive: true });
        const written: string[] = [];
        for (const name of args.names) {
          const data = soundEffectFile(name);
          if (!data) throw new Error(`Unknown sound effect "${name}". Use one of: ${SOUND_EFFECTS.map((s) => s.name).join(', ')}.`);
          const file = path.join(dir, `${name}.ogg`);
          await writeFile(file, data);
          written.push(this.relative(file));
        }
        return { content: [text(`Copied:\n${written.map((w) => `  ${w}`).join('\n')}\nReference them with paths relative to the composition file.`)] };
      }
    }
  }

  async shutdown() {
    await this.pool.shutdown();
  }
}

/** A print PDF of exactly the paper size, with the 300 dpi render as its only content. */
async function printPdf(browser: Browser, jpeg: Buffer, paper: { width: number; height: number }): Promise<Buffer> {
  const page = await browser.newPage({ width: 800, height: 600, scale: 1 });
  try {
    const html = `<!doctype html><html><head><style>
      @page { size: ${paper.width}mm ${paper.height}mm; margin: 0 }
      html, body { margin: 0; padding: 0 }
      img { display: block; width: ${paper.width}mm; height: ${paper.height}mm }
    </style></head><body><img src="data:image/jpeg;base64,${jpeg.toString('base64')}"></body></html>`;
    const { frameTree } = await page.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    await page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await page.evaluate('document.images[0].decode()');
    return await page.pdf({ preferCSSPageSize: true, printBackground: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  } finally {
    await page.close();
  }
}

/** A smaller copy of the poster for the agent to look at. */
async function posterThumb(browser: Browser, posterFile: string, width: number, height: number): Promise<Buffer> {
  const jpeg = await readFile(posterFile);
  const scale = Math.min(1, 1000 / Math.max(width, height));
  if (scale === 1) return jpeg;
  return contactSheet(browser, [{ label: 'poster (frame 0)', image: jpeg, mime: 'image/jpeg', width, height }], {
    rowHeight: Math.round(height * scale),
    maxWidth: Math.round(width * scale) + SHEET_PAD * 2,
    type: 'jpeg',
  });
}
