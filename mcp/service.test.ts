import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChrome } from './browser';
import { loadComposition } from './composition';
import { findFfmpeg, run } from './ffmpeg';
import { decodePng, pngSize } from './png';
import type { CompositionInfo } from './runtime';
import { filmstripMoments, metaContent, parseFormat, resolveFormats, TilecastService, type ToolResult } from './service';
import { createTilecastServer } from './tools';

const chrome = findChrome();
const ffmpeg = findFfmpeg();
let root: string;
let service: TilecastService;

const poster = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="tilecast:formats" content="poster-a4 square">
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #14213d; color: #fff; }
  h1 { font-family: 'Bricolage Grotesque'; font-weight: 800; font-size: 14vmin; margin: 0; position: absolute; left: 6vw; top: 30vh;
       animation: rise .8s ease-out .2s both; }
  p { font-family: 'Inter'; font-size: 3.4vmin; position: absolute; left: 6vw; bottom: 8vh; margin: 0; }
  @keyframes rise { from { opacity: 0; transform: translateY(4vh) } }
</style></head>
<body><h1>Zażółć<br>gęślą</h1><p>Sobota 14.06 · Park Miejski</p></body></html>`;

const flawed = `<!doctype html><html><head><meta charset="utf-8">
<meta name="tilecast:formats" content="square">
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #fafafa; }
  h1 { font-family: 'Inter'; font-size: 200px; margin: 0; position: absolute; left: 40px; top: 80px; white-space: nowrap; }
  .pale { color: #d8d8d8; font-family: 'Inter'; font-size: 30px; position: absolute; left: 40px; top: 400px; }
  .box { position: absolute; left: 40px; top: 600px; width: 200px; height: 60px; overflow: hidden; font: 28px 'Inter'; }
  .under { position: absolute; left: 600px; top: 600px; font: 40px 'Inter'; }
  .cover { position: absolute; left: 560px; top: 560px; width: 500px; height: 200px; background: #222; }
  small { position: absolute; left: 40px; bottom: 30px; font: 9px 'Inter'; }
  .odd { position: absolute; left: 40px; top: 800px; font: 40px 'Comic Neue'; }
</style></head>
<body>
  <h1>Wyprzedaż totalna</h1>
  <p class="pale">Jasnoszary tekst na białym tle</p>
  <div class="box">Ten tekst jest za długi na to pudełko</div>
  <p class="under">Schowany pod kartą</p><div class="cover"></div>
  <small>drobny druk</small>
  <div aria-hidden="true" style="position:absolute;left:900px;top:300px;font:300px 'Inter';color:#f4f4f4">DEKOR</div>
  <p class="odd">Nieznany font</p>
  <div style="position:absolute;left:600px;top:80px;font:60px/.88 'Anton';text-transform:uppercase">17–19<br>paź</div>
  <div style="position:absolute;left:800px;top:80px;font:60px/1.1 'Anton';text-transform:uppercase">17–19<br>lis</div>
  <img src="missing.png">
</body></html>`;

const video = `<!doctype html><html><head><meta charset="utf-8">
<meta name="tilecast:duration" content="4">
<meta name="tilecast:scenes" content="0 2">
<meta name="tilecast:formats" content="640x360">
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: #fff; font-family: 'Inter'; }
  .scene { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; }
  #a { animation: on 2s linear; }
  #b { animation: on 2s linear 2s forwards; background: #ff5a1f; }
  h1 { font: 64px 'Anton'; margin: 0; animation: slam .3s ease-out .1s both; }
  .flash { position: absolute; top: 20px; font-size: 24px; animation: on .3s linear 1.2s; opacity: 0; }
  #b p { font-size: 26px; max-width: 520px; text-align: center; }
  @keyframes on { from, to { opacity: 1 } }
  @keyframes slam { from { opacity: 0; transform: scale(1.4) } }
</style></head>
<body>
  <section class="scene" id="a"><h1>TILECAST</h1><p class="flash">Szybki błysk</p></section>
  <section class="scene" id="b"><p>Każda linijka musi zostać na ekranie wystarczająco długo, żeby dało się ją przeczytać spokojnie</p></section>
  <audio data-tilecast src="sfx/soft-hit.ogg" data-start="0.1" data-volume="0.8"></audio>
  <audio data-tilecast src="sfx/bell-short.ogg" data-start="2" data-volume="0.6"></audio>
</body></html>`;

const textOf = (result: ToolResult) =>
  result.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
const imageOf = (result: ToolResult) => result.content.find((c) => c.type === 'image') as { data: string; mimeType: string } | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tilecast-service-'));
  await mkdir(path.join(root, 'promo'), { recursive: true });
  await writeFile(path.join(root, 'promo/poster.html'), poster);
  await writeFile(path.join(root, 'promo/flawed.html'), flawed);
  await writeFile(path.join(root, 'promo/clip.html'), video);
  service = new TilecastService(root);
});

afterAll(async () => {
  await service?.shutdown();
  await rm(root, { recursive: true, force: true });
});

describe('composition settings', () => {
  it('reads tilecast meta tags in any attribute order', () => {
    const source = `<meta content="4.5" name="tilecast:duration"><meta name='tilecast:formats' content='story 1500x500'>`;
    expect(metaContent(source, 'duration')).toBe('4.5');
    expect(metaContent(source, 'formats')).toBe('story 1500x500');
    expect(metaContent(source, 'poster')).toBeNull();
  });

  it('parses format ids and custom sizes', () => {
    expect(parseFormat('story')).toMatchObject({ width: 1080, height: 1920 });
    expect(parseFormat('1500x500')).toMatchObject({ width: 1500, height: 500, scale: 1 });
    expect(() => parseFormat('billboard')).toThrow(/Unknown format/);
  });

  it('takes formats from the request, the composition, or a sensible default', async () => {
    const comp = await loadComposition(root, 'promo/poster.html');
    expect(resolveFormats(comp).map((f) => f.id)).toEqual(['poster-a4', 'square']);
    expect(resolveFormats(comp, ['story', 'story']).map((f) => f.id)).toEqual(['story']);
    const bare = { ...comp, source: '<meta name="tilecast:duration" content="3">' };
    expect(resolveFormats(bare).map((f) => f.id)).toEqual(['landscape']);
    expect(resolveFormats({ ...comp, source: '' }).map((f) => f.id)).toEqual(['poster-a4']);
  });

  it('shows every scene settled and every cut', () => {
    const info = { scenes: [0, 2, 5] } as CompositionInfo;
    const moments = filmstripMoments(info, 8);
    expect(moments.map((m) => m.label)).toEqual(['1.24s · scene 1', '2.15s · cut 1→2', '3.86s · scene 2', '5.15s · cut 2→3', '6.86s · scene 3']);
    expect(filmstripMoments({ scenes: [] as number[] } as CompositionInfo, 6)).toHaveLength(4);
  });

  it('refuses files outside the project', async () => {
    await expect(service.preview({ file: '../outside.html' })).rejects.toThrow(/outside the project/);
  });
});

describe.skipIf(!chrome)('tools', () => {
  it('previews every format side by side', async () => {
    const result = await service.preview({ file: 'promo/poster.html' });
    const out = textOf(result);
    expect(out).toContain('Poster A4 1240×1754');
    expect(out).toContain('Square 1:1 1080×1080');
    expect(out).toMatch(/fonts: .*Bricolage Grotesque/);
    expect(out).toMatch(/still at 1s/);
    expect(out).toContain('PASS');
    expect(imageOf(result)?.mimeType).toBe('image/jpeg');
  }, 60_000);

  it('finds layout, contrast, font and image problems', async () => {
    const out = textOf(await service.check({ file: 'promo/flawed.html' }));
    expect(out).toContain('FAIL');
    expect(out).toMatch(/✗ .*runs off the canvas.*Wyprzedaż totalna/);
    expect(out).toMatch(/✗ .*Low contrast 1\.\d:1.*Jasnoszary/);
    expect(out).toMatch(/✗ .*overflows its own box.*za długi/);
    expect(out).toMatch(/✗ .*Image failed to load: missing\.png/);
    expect(out).toMatch(/! .*too small to read at 9px/);
    expect(out).toMatch(/! .*Font "Comic Neue" is not available/);
    // A Polish capital under tight leading: its mark can hide behind the line above.
    expect(out).toMatch(/! .*The mark on "Ź" can run into the line above at line-height 0\.88/);
    expect(out.match(/The mark on/g)).toHaveLength(1);
    // Text under an opaque card is not on screen, so it is not judged.
    expect(out).not.toContain('Schowany');
    // Decorative text bleeding off the edge is marked aria-hidden and not judged.
    expect(out).not.toContain('DEKOR');
  }, 60_000);

  it('follows text through a video for reading time', async () => {
    const out = textOf(await service.check({ file: 'promo/clip.html' }));
    expect(out).toMatch(/! \[1\.2s\] "Szybki błysk" flashes by/);
    expect(out).toMatch(/! \[2s\] "Każda linijka musi zostać.*readable for 2\.\ds but needs ~4\.2s \(14 words\)/);
    expect(out).toMatch(/✓ +0\.\ds +1\.\ds held \/ 0\.8s needed +"TILECAST"/);
    expect(out).toMatch(/Poster frame: \d+(\.\d+)?s suggested/);
    expect(out).toContain('Audio file not found');
  }, 60_000);

  it('previews a video as a filmstrip', async () => {
    const result = await service.preview({ file: 'promo/clip.html' });
    expect(textOf(result)).toContain('Stills at: 1.24s · scene 1, 2.15s · cut 1→2, 3.24s · scene 2');
    expect(imageOf(result)).toBeDefined();
  }, 60_000);

  it('renders print-ready images', async () => {
    const out = textOf(await service.renderImage({ file: 'promo/poster.html' }));
    expect(out).toContain('promo/export/poster-poster-a4.png  2480×3508');
    expect(out).toContain('promo/export/poster-poster-a4.pdf  210×297 mm, 300 dpi');
    expect(out).toContain('promo/export/poster-square.png  1080×1080');
    expect(pngSize(await readFile(path.join(root, 'promo/export/poster-poster-a4.png')))).toEqual({ width: 2480, height: 3508 });
    const pdf = (await readFile(path.join(root, 'promo/export/poster-poster-a4.pdf'))).toString('latin1');
    const box = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(Number(box?.[1])).toBeCloseTo(595.3, 0);
    expect(Number(box?.[2])).toBeCloseTo(841.9, 0);
  }, 60_000);

  it('serves fonts, icons and sound effects', async () => {
    expect(textOf(await service.assets({ action: 'list_fonts' }))).toContain('"Instrument Serif"');
    expect(textOf(await service.assets({ action: 'find_icons', query: 'coffee' }))).toMatch(/: coffee\b/);
    expect(textOf(await service.assets({ action: 'find_icons', query: 'music note' }))).toMatch(/: music\b/);
    const icons = textOf(await service.assets({ action: 'get_icons', names: ['rocket', 'nope'], size: 48 }));
    expect(icons).toMatch(/<svg [^>]*width="48"[^>]*stroke="currentColor"/);
    expect(icons).toContain('Unknown: nope');
    await service.assets({ action: 'add_sfx', names: ['soft-hit', 'bell-short'], dir: 'promo/sfx' });
    expect((await readFile(path.join(root, 'promo/sfx/soft-hit.ogg'))).subarray(0, 4).toString()).toBe('OggS');
    await expect(service.assets({ action: 'add_sfx', names: ['boom'], dir: 'promo/sfx' })).rejects.toThrow(/Unknown sound effect/);
  });

  it('writes generated music with its cues, and generated effects', async () => {
    const out = textOf(await service.assets({ action: 'make_music', style: 'upbeat', duration: 8, dir: 'promo/audio', name: 'bed' }));
    expect(out).toContain('Wrote promo/audio/bed.wav (8s, upbeat, 118 BPM');
    expect(out).toMatch(/final hit: land the logo/);
    const cues = JSON.parse(await readFile(path.join(root, 'promo/audio/bed.cues.json'), 'utf8'));
    expect(cues).toMatchObject({ file: 'bed.wav', bpm: 118, beat: 0.5085 });
    expect(cues.strong.at(-1).t).toBeLessThanOrEqual(6.6);
    await service.assets({ action: 'make_sfx', names: ['whoosh', 'riser'], dir: 'promo/audio', duration: 1.2 });
    expect((await readFile(path.join(root, 'promo/audio/riser.wav'))).length).toBeGreaterThan(1.2 * 48000 * 4);
    await expect(service.assets({ action: 'make_sfx', names: ['laser'], dir: 'promo/audio' })).rejects.toThrow(/Unknown sound "laser"/);
    await expect(service.assets({ action: 'make_music', style: 'polka', duration: 8, dir: 'promo/audio' })).rejects.toThrow(/Unknown style/);
  });

  it.skipIf(!ffmpeg)('finds the beat of the user\'s own track', async () => {
    await service.assets({ action: 'make_music', style: 'driving', duration: 12, dir: 'promo/own', name: 'song', seed: 4 });
    const out = textOf(await service.assets({ action: 'analyze_music', file: 'promo/own/song.wav' }));
    expect(out).toMatch(/about 12[34](\.\d)? BPM/);
    expect(out).toContain('Wrote promo/own/song.cues.json');
    expect(out).toMatch(/Energy by bar: [▁▂▃▄▅▆▇█]+/);
    const cues = JSON.parse(await readFile(path.join(root, 'promo/own/song.cues.json'), 'utf8'));
    expect(cues).toMatchObject({ file: 'song.wav', analyzed: true });
    expect(Math.abs(cues.bpm - 124)).toBeLessThan(1.5);
    await expect(service.assets({ action: 'analyze_music', file: 'promo/own/missing.mp3' })).rejects.toThrow(/Cannot find/);
  }, 60_000);

  it.skipIf(!ffmpeg)(
    'renders a video with its sound, the poster baked in as frame 0',
    async () => {
      await service.assets({ action: 'add_sfx', names: ['soft-hit', 'bell-short'], dir: 'promo/sfx' });
      const result = await service.renderVideo({ file: 'promo/clip.html', poster_time: 3 });
      const out = textOf(result);
      expect(out).toContain('Rendered promo/export/clip-640x360.mp4  640×360 · 4s · 30 fps');
      expect(out).toContain('frame 0 = 3s');
      expect(out).toContain('Audio: soft-hit.ogg, bell-short.ogg');
      expect(out).toContain('"Szybki błysk" flashes by');
      expect(imageOf(result)?.mimeType).toBe('image/jpeg');
      const probe = spawnSync(ffmpeg!, ['-hide_banner', '-i', path.join(root, 'promo/export/clip-640x360.mp4')], { encoding: 'utf8' }).stderr;
      expect(probe).toMatch(/Duration: 00:00:04\.0/);
      expect(probe).toMatch(/Video: h264 .*yuv420p\(tv, bt709.*640x360/);
      expect(probe).toMatch(/Audio: aac .*48000 Hz, stereo/);
      // Frame 0 is the poster (scene 2, orange #ff5a1f); frame 1 is the dark opening.
      const pixel = async (n: number) => {
        const png = path.join(root, `frame-${n}.png`);
        await run(ffmpeg!, ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'promo/export/clip-640x360.mp4'), '-vf',
          `select=eq(n\\,${n}),scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24`, '-frames:v', '1', png]);
        return decodePng(await readFile(png)).at(8, 8);
      };
      const [r, g, b] = await pixel(0);
      expect(Math.abs(r - 255) + Math.abs(g - 90) + Math.abs(b - 31)).toBeLessThan(18);
      expect(Math.max(...(await pixel(1)))).toBeLessThan(30);
      expect((await readFile(path.join(root, 'promo/export/clip-640x360.jpg'))).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    },
    120_000,
  );
});

describe('MCP server', () => {
  it('lists the from-scratch tools and serves the playbook', async () => {
    const server = createTilecastServer(service);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    try {
      expect(client.getInstructions()).toContain('No templates: compose each piece from scratch');
      expect(client.getInstructions()!.length).toBeLessThan(2000);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['preview', 'check', 'render_image', 'render_video', 'assets', 'guide']);
      const guide = (await client.callTool({ name: 'guide', arguments: { topic: 'workflow' } })) as { content: { text: string }[] };
      expect(guide.content[0].text).toContain('preview');
      const failed = (await client.callTool({ name: 'preview', arguments: { file: 'nope.html' } })) as { isError?: boolean; content: { text: string }[] };
      expect(failed.isError).toBe(true);
      expect(failed.content[0].text).toContain('Cannot read "nope.html"');
    } finally {
      await client.close();
    }
  });
});
