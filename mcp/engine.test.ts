import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool, findChrome } from './browser';
import { loadComposition, Stage } from './composition';
import { customFormat, getFormat } from './formats';
import { familiesUsedIn } from './fonts';
import { decodePng, pngSize } from './png';

const chrome = findChrome();
let root: string;
let pool: BrowserPool;

const composition = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="tilecast:duration" content="4">
<meta name="tilecast:scenes" content="0 2">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #101010; }
  h1 { font-family: 'Anton', sans-serif; font-size: 12vw; color: #ffd400; margin: 0; position: absolute; left: 5vw; top: 10vh;
       animation: rise 1s ease-out 1s both; }
  #bar { position: absolute; left: 0; bottom: 0; height: 10vh; width: 100%; background: #00ff00; }
  @keyframes rise { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
</style></head>
<body><h1>Zażółć</h1><div id="bar"></div><p id="clock"></p>
<script>
  const clock = document.getElementById('clock');
  setTimeout(() => { clock.textContent = 'timer fired'; }, 2500);
  let frames = 0;
  (function loop(t) { frames++; document.body.dataset.raf = String(Math.round(t)); requestAnimationFrame(loop); })(0);
  tilecast.onFrame((t) => {
    document.body.dataset.hook = t.toFixed(2);
    document.body.dataset.tween = tilecast.tween(1, 2, 0, 100, 'linear').toFixed(1);
    document.body.dataset.random = String(tilecast.random(7)());
  });
</script>
</body></html>`;

// The scene-window pattern the motion guide teaches.
const scenes = `<!doctype html><html><head><meta charset="utf-8">
<meta name="tilecast:duration" content="9">
<style>
  .scene { position: absolute; inset: 0; opacity: 0; }
  #a { opacity: 1; animation: out .3s 2.7s forwards; }
  #b { animation: in .3s 3s both, out .3s 5.7s forwards; }
  #c { animation: in .3s 6s both; }
  #b h2 { animation: rise .6s ease-out 3.2s both; }
  @keyframes in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes out { from { opacity: 1 } to { opacity: 0 } }
  @keyframes rise { from { transform: translateY(100px) } }
</style></head>
<body><section class="scene" id="a"></section><section class="scene" id="b"><h2>B</h2></section><section class="scene" id="c"></section></body></html>`;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tilecast-engine-'));
  await writeFile(path.join(root, 'comp.html'), composition);
  await writeFile(path.join(root, 'scenes.html'), scenes);
  pool = new BrowserPool(() => chrome);
});

afterAll(async () => {
  await pool?.shutdown();
  await rm(root, { recursive: true, force: true });
});

describe('fonts', () => {
  it('detects which bundled families a composition uses', () => {
    const names = (css: string) => familiesUsedIn(css).map((f) => f.family);
    expect(names(`h1 { font-family: 'Anton', sans-serif }`)).toEqual(['Anton']);
    expect(names(`p { font: 700 20px/1.2 Inter, system-ui }`)).toEqual(['Inter']);
    expect(names(`p { font-family: "Instrument Serif" }`)).toEqual(['Instrument Serif']);
    expect(names(`<p>interactive international</p>`)).toEqual([]);
  });
});

describe.skipIf(!chrome)('stage', () => {
  it('renders any moment as a pure function of time', async () => {
    await pool.use(async (browser) => {
      const comp = await loadComposition(root, 'comp.html');
      expect(comp.fonts.map((f) => f.family)).toContain('Anton');
      const stage = await Stage.open(browser, comp, customFormat(400, 300));
      try {
        const info = await stage.info();
        expect(info).toMatchObject({ duration: 4, scenes: [0, 2], animations: 1 });
        expect(info.animationEnd).toBeCloseTo(2, 3);

        const opacity = () => stage.page.evaluate<number>("Number(getComputedStyle(document.querySelector('h1')).opacity)");
        await stage.seek(0.5);
        expect(await opacity()).toBe(0);
        await stage.seek(3);
        expect(await opacity()).toBe(1);
        await stage.seek(1.5);
        expect(await opacity()).toBeGreaterThan(0.2);
        expect(await opacity()).toBeLessThan(1);

        const state = await stage.page.evaluate<{ clock: string; raf: string; hook: string; now: number }>(
          '({ clock: document.getElementById("clock").textContent, raf: document.body.dataset.raf, hook: document.body.dataset.hook, now: performance.now() })',
        );
        // The timer at 2.5 s fired when we jumped to 3 s; rAF and hooks see virtual time.
        expect(state.clock).toBe('timer fired');
        expect(state.raf).toBe('1500');
        expect(state.hook).toBe('1.50');
        expect(await stage.page.evaluate('document.body.dataset.tween')).toBe('25.0');
        expect(await stage.page.evaluate('tilecast.ease.outBack(1)')).toBeCloseTo(1, 6);
        const random = await stage.page.evaluate<string>('document.body.dataset.random');
        await stage.seek(1.6);
        expect(await stage.page.evaluate('document.body.dataset.random')).toBe(random);
        expect(state.now).toBe(1500);

        const audit = await stage.audit();
        expect(audit.missingFonts).toEqual([]);
        expect(audit.texts.find((t) => t.text === 'Zażółć')?.family).toBe('Anton');
      } finally {
        await stage.close();
      }
    });
  }, 60_000);

  it('shows exactly one scene at a time, however time is reached', async () => {
    await pool.use(async (browser) => {
      const comp = await loadComposition(root, 'scenes.html');
      const state = async (stage: Stage) =>
        stage.page.evaluate<string>(
          `['a','b','c'].map((id) => Number(getComputedStyle(document.getElementById(id)).opacity).toFixed(2)).join(' ') + ' ' + new DOMMatrix(getComputedStyle(document.querySelector('h2')).transform).m42.toFixed(0)`,
        );
      const expected: [number, string][] = [
        [0, '1.00 0.00 0.00 100'],
        [1.5, '1.00 0.00 0.00 100'],
        [2.85, '0.20 0.00 0.00 100'], // halfway through a 0.3 s fade with the default ease
        [4, '0.00 1.00 0.00 0'],
        [5.85, '0.00 0.20 0.00 0'],
        [7.5, '0.00 0.00 1.00 0'],
      ];
      // Stepping forward through time…
      const walker = await Stage.open(browser, comp, customFormat(320, 180));
      for (const [t, want] of expected) {
        await walker.seek(t);
        expect(await state(walker), `walk ${t}`).toBe(want);
      }
      await walker.close();
      // …and jumping straight to each moment in a fresh page give the same frames.
      for (const [t, want] of expected) {
        const jumper = await Stage.open(browser, comp, customFormat(320, 180));
        await jumper.seek(t);
        expect(await state(jumper), `jump ${t}`).toBe(want);
        await jumper.close();
      }
    });
  }, 60_000);

  it('captures at the format scale, down to the last row', async () => {
    await pool.use(async (browser) => {
      const comp = await loadComposition(root, 'comp.html');
      const format = { ...getFormat('og'), width: 300, height: 200 };
      const stage = await Stage.open(browser, comp, format);
      try {
        const png = await stage.capture();
        expect(pngSize(png)).toEqual({ width: 600, height: 400 });
        const pixels = decodePng(png);
        expect(pixels.at(599, 399)).toEqual([0, 255, 0]);
        const small = await stage.capture({ zoom: 0.25 });
        expect(pngSize(small)).toEqual({ width: 150, height: 100 });
      } finally {
        await stage.close();
      }
    });
  }, 60_000);
});
