import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { GUIDE_TOPICS, readGuide } from './guide';
import { MUSIC_STYLES, type MusicStyle } from './music';
import type { Progress, TilecastService, ToolResult } from './service';
import { VERSION } from './version';

export const INSTRUCTIONS = `Tilecast turns HTML and CSS that you write into posters, flyers, announcements, social posts and videos. There are no templates: each piece is a small web page composed from scratch for this one message, rendered pixel-exact by headless Chrome.

Workflow: (1) Write one self-contained .html composition per piece (e.g. promo/launch/launch.html) with its images and sounds beside it. (2) preview: look at the stills and fix what you see. (3) check: the design critic; fix every ✗ it reports. (4) render_image (PNG, print PDF) or render_video (MP4 whose frame 0 is the best frame). For the full playbook (design, motion, tones, audio), call guide.

Composition contract:
- The viewport is the canvas: poster-a4 1240×1754 CSS px (exported ×2 = 300 dpi), poster-a3, flyer-a5, square 1080×1080, portrait 1080×1350, story 1080×1920, landscape 1920×1080, og 1200×630, or any "WIDTHxHEIGHT". Size everything relative to the canvas (vw, vh, vmin, %, clamp) so one file serves several formats; switch layouts with @media (aspect-ratio …). html and body fill the canvas with overflow: hidden.
- <meta name="tilecast:formats" content="poster-a4 square story"> sets the default formats.
- Video: <meta name="tilecast:duration" content="18"> in seconds, optional tilecast:fps (default 30), tilecast:scenes (scene start times, e.g. "0 2.5 6 11 15") and tilecast:poster (thumbnail time).
- Time is virtual; every frame is a pure function of time. CSS animations and transitions (schedule them with animation-delay), the Web Animations API, requestAnimationFrame, timers, Date and performance.now all follow the render clock. tilecast.onFrame((t) => …) runs on every frame with t in seconds; tilecast.time reads the clock. Use a fixed seed for any randomness.
- Fonts: bundled families work offline by name (assets list_fonts), e.g. Inter, Bricolage Grotesque, Fraunces, Unbounded, Syne, Instrument Serif, Anton, Bebas Neue, Space Grotesk, JetBrains Mono. Other fonts need a local file and @font-face. No network fonts, CDNs or remote images.
- Media: local files by relative path. <video> elements follow the timeline (data-start offsets them). Icons: assets find_icons and get_icons (Lucide SVG).
- Sound (video): <audio data-tilecast src="sfx/soft-hit.ogg" data-start="2.4" data-volume="0.5"> with optional data-fade-in, data-fade-out, data-trim, data-duration and loop. assets make_music writes a music bed with its beat grid; list_sfx and add_sfx give effects.

The bar: design like a top studio, never like a template. One idea, one focal point, a huge headline, a deliberate grid, few colors, real content only (never invent prices, dates, addresses or links). Video: the hook lands in the first 2 seconds, 15–25 seconds total, every line held long enough to read (~0.3 s per word), pace from motion and cuts, every frame postable.`;

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
        'Render full-resolution PNGs of every format: A4/A3/A5 posters at 300 dpi plus a print PDF of the exact paper size, social formats 1:1, og at 2×. ' +
        'Default folder: export/ next to the composition.',
      inputSchema: {
        file,
        formats,
        time: z.number().min(0).optional().describe('Moment to capture, in seconds. Default: tilecast:poster, else when the entrance animations have finished.'),
        out_dir: z.string().optional().describe('Folder inside the project, e.g. "public/promo".'),
        pdf: z.boolean().optional().describe('Write print PDFs for print formats (default true).'),
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
        'list_sfx and add_sfx (names, dir): recorded CC0 effects copied into the project. list_formats: canvas sizes.',
      inputSchema: {
        action: z.enum(['list_fonts', 'find_icons', 'get_icons', 'make_music', 'make_sfx', 'list_sfx', 'add_sfx', 'list_formats']),
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
