import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { GUIDE_TOPICS, readGuide } from './guide';
import { MUSIC_STYLES, type MusicStyle } from './music';
import type { Progress, TilecastService, ToolResult } from './service';
import { VERSION } from './version';

export const INSTRUCTIONS = `Tilecast turns HTML/CSS you write into posters, flyers, announcements, social posts and videos. No templates: compose each piece from scratch as one web page for this message; headless Chrome renders it pixel-exact.

Loop: write tilecast/<slug>/<slug>.html → preview (look, fix) → check (the design critic; fix every ✗) → render_image (PNG, print PDF) or render_video (MP4, best frame as frame 0). Call guide (workflow, design, motion, tones, audio, runtime) for the full playbook.

Contract:
- The viewport is the canvas: poster-a4 1240×1754 (exported ×2 = 300 dpi), square 1080×1080, portrait 1080×1350, story 1080×1920, landscape 1920×1080, og 1200×630, or "WxH". Size relative to it (vmin, %, clamp), switch layouts with @media (aspect-ratio …); html, body fill it with overflow hidden.
- <meta name="tilecast:formats" content="poster-a4 square story">. Video: tilecast:duration (s), optional tilecast:fps, tilecast:scenes (start times), tilecast:poster.
- Time is virtual; each frame is a pure function of time. Schedule CSS animations with absolute delays; rAF, timers, Date follow the clock; tilecast.onFrame(t => …) for computed motion; tilecast.tween/progress/random helpers.
- Bundled fonts by name, offline (assets list_fonts). Local files only: no CDNs or remote images. Icons: assets find_icons/get_icons.
- Sound: <audio data-tilecast src="…" data-start="2.4" data-volume="0.5">; assets make_music (beat grid, cues), make_sfx, add_sfx.

Bar: one idea, a huge headline, a deliberate grid, few colors, only facts the user gave. Video: hook in 2 s, 15–25 s, ~0.3 s per word held on screen, every frame postable.`;

const file = z.string().describe('The composition: an .html file inside the project, e.g. "promo/launch/launch.html".');
const formats = z
  .array(z.string())
  .optional()
  .describe(
    'Format ids (poster-a4, poster-a3, flyer-a5, square, portrait, story, landscape, og) or custom "WIDTHxHEIGHT". ' +
      'Default: the composition\'s tilecast:formats meta, else landscape for videos and poster-a4 otherwise.',
  );

function withProgress(extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: any) => Promise<void> }): Progress | undefined {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  let last = 0;
  return (done, total, message) => {
    const now = Date.now();
    if (done < total && now - last < 500) return;
    last = now;
    void extra
      .sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message } })
      .catch(() => undefined);
  };
}

function toResult(result: ToolResult): CallToolResult {
  return result as CallToolResult;
}

function failure(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
}

export function createTilecastServer(service: TilecastService): McpServer {
  const server = new McpServer({ name: 'tilecast', version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'preview',
    {
      title: 'Preview a composition',
      description:
        'Render stills of a composition and look at them. Static pieces: every format side by side at its settled moment. ' +
        'Videos (tilecast:duration) or when times are given: a filmstrip with every scene once it has settled and every cut mid-transition. ' +
        'Includes a quick critic pass on the frames shown. Use it after every meaningful edit.',
      inputSchema: {
        file,
        formats,
        time: z.number().min(0).optional().describe('Moment for the stills of a static piece, in seconds. Default: when its entrance animations have finished.'),
        times: z.array(z.number().min(0)).max(16).optional().describe('Exact moments to show as a filmstrip, in seconds.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return toResult(await service.preview(args));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'check',
    {
      title: 'Check a composition',
      description:
        'The design critic and the gate before rendering. For each format it finds text off the canvas or cut off, colliding text, text too small to read, ' +
        'low contrast measured on the rendered pixels (photos and gradients count), missing fonts, broken images, network resources and script errors. ' +
        'For videos it also follows every text through the whole timeline and flags lines not held long enough to read (~0.3 s per word, 0.8 s minimum) or flashing by, ' +
        'an empty opening or ending, and missing audio; it suggests the poster frame. Fix every ✗ before rendering.',
      inputSchema: {
        file,
        formats,
        time: z.number().min(0).optional().describe('Moment to check for a static piece. Default: when its entrance animations have finished.'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return toResult(await service.check(args));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'render_image',
    {
      title: 'Render images',
      description:
        'Render full-resolution PNGs of every format: A4/A3/A5 posters at 300 dpi plus a print PDF of the exact paper size, social formats 1:1, og at 2×; ' +
        'with html, also one self-contained web page of the piece. ' +
        'Default folder: export/ next to the composition.',
      inputSchema: {
        file,
        formats,
        time: z.number().min(0).optional().describe('Moment to capture, in seconds. Default: tilecast:poster, else when the entrance animations have finished.'),
        out_dir: z.string().optional().describe('Folder inside the project, e.g. "public/promo".'),
        pdf: z.boolean().optional().describe('Write print PDFs for print formats (default true).'),
        html: z
          .boolean()
          .optional()
          .describe('Also write one self-contained .html page (fonts and local images inlined, animations playing live) to put on a website.'),
      },
    },
    async (args) => {
      try {
        return toResult(await service.renderImage(args));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'render_video',
    {
      title: 'Render a video',
      description:
        'Render a timed composition to MP4 (H.264 + AAC). Every frame is captured deterministically, the <audio data-tilecast> tracks are mixed, and the best settled frame ' +
        '(or poster_time) becomes frame 0 so every platform\'s thumbnail shows it; the poster is also saved as .jpg. Reports lines that are too fast to read. ' +
        'Downloads a static ffmpeg into a cache on first use if none is installed. Default file: export/<name>-<format>.mp4 next to the composition.',
      inputSchema: {
        file,
        format: z.string().optional().describe('One format id or "WIDTHxHEIGHT". Default: the first of tilecast:formats, else landscape.'),
        duration: z.number().positive().optional().describe('Seconds. Default: tilecast:duration.'),
        fps: z.number().int().min(1).max(60).optional().describe('Default: tilecast:fps, else 30.'),
        poster_time: z.number().min(0).optional().describe('Moment used as frame 0 and the .jpg thumbnail. Default: tilecast:poster, else the most settled moment.'),
        quality: z.enum(['final', 'draft']).optional().describe('draft: half size and fast encoding, for checking motion and sound.'),
        out: z.string().optional().describe('Output .mp4 path inside the project.'),
        loudness: z
          .union([z.number().min(-30).max(-8), z.literal('off')])
          .optional()
          .describe('Target loudness in LUFS: the mix is measured and brought to it with peaks kept under -1 dBTP. Default -14, the level YouTube, Instagram and TikTok play at; "off" keeps the mix as it is.'),
      },
    },
    async (args, extra) => {
      try {
        return toResult(await service.renderVideo(args, withProgress(extra)));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'assets',
    {
      title: 'Fonts, icons, sounds and formats',
      description:
        'list_fonts: bundled font families and pairings. find_icons (query) and get_icons (names, size, stroke_width): Lucide icons as inline SVG. ' +
        'make_music (style, duration, dir, optional bpm, key, seed, name): a generated music bed as WAV with its beat grid and strong cues, free to use. ' +
        'make_sfx (names, dir, duration for risers): generated whoosh, swipe, riser, impact, sub-drop, pop, tick, shimmer. ' +
        'analyze_music (file): tempo, beats, bar starts, energy and strong cues of the user\'s own track, saved as .cues.json. ' +
        'list_sfx and add_sfx (names, dir): recorded CC0 effects copied into the project. list_formats: canvas sizes.',
      inputSchema: {
        action: z.enum(['list_fonts', 'find_icons', 'get_icons', 'make_music', 'make_sfx', 'analyze_music', 'list_sfx', 'add_sfx', 'list_formats']),
        file: z.string().optional().describe('analyze_music: the audio file inside the project (mp3, wav, ogg, m4a…).'),
        query: z.string().optional().describe('find_icons: what the icon shows, in English, e.g. "coffee", "rocket launch".'),
        names: z.array(z.string()).optional().describe('get_icons: icon names. add_sfx: effect names.'),
        dir: z.string().optional().describe('add_sfx: folder inside the project to copy into, usually next to the composition.'),
        size: z.number().int().min(8).max(2048).optional().describe('get_icons: width and height attributes (default 24).'),
        stroke_width: z.number().min(0.5).max(4).optional().describe('get_icons: line weight (default 2; 1.5 looks refined at large sizes).'),
        style: z
          .enum(Object.keys(MUSIC_STYLES) as [MusicStyle, ...MusicStyle[]])
          .optional()
          .describe(`make_music: ${Object.entries(MUSIC_STYLES).map(([k, v]) => `${k} (${v.bpm} BPM) ${v.feel}`).join('; ')}.`),
        duration: z.number().positive().max(300).optional().describe('make_music: the video length in seconds. make_sfx: riser length.'),
        bpm: z.number().int().min(60).max(180).optional().describe('make_music: tempo; the style sets a good default.'),
        key: z.string().optional().describe('make_music: e.g. "C", "F#", "Bb minor", "Am".'),
        seed: z.number().int().optional().describe('make_music and make_sfx: another seed gives another variation.'),
        name: z.string().optional().describe('make_music: file name without extension (default music-<style>).'),
      },
    },
    async (args) => {
      try {
        return toResult(await service.assets(args));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'guide',
    {
      title: 'Read the Tilecast playbook',
      description:
        'The craft behind great pieces: workflow (read first if the tilecast skill is not loaded), design (posters and layouts), motion (video pacing, transitions, kinetic type), ' +
        'tones (seven presets), audio (music, effects, mixing) and runtime (the composition contract in detail, with examples).',
      inputSchema: { topic: z.enum(GUIDE_TOPICS) },
      annotations: { readOnlyHint: true },
    },
    async ({ topic }) => {
      try {
        return { content: [{ type: 'text', text: readGuide(topic) }] };
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
