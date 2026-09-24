import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Composition } from './composition';
import type { Format } from './formats';
import { fontFaceCss } from './fonts';
import { tilecastHelpers } from './runtime';

/**
 * A composition as one self-contained web page: bundled fonts as @font-face,
 * local images, stylesheets and scripts inlined, and the tilecast helpers
 * running on real time, so it can be dropped into any website or opened by
 * double-clicking. Render-only <audio data-tilecast> tracks are left out.
 */

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Files larger than this stay as links next to the page (videos, mostly). */
const MAX_INLINE = 8 * 1024 * 1024;

function liveRuntime(makeHelpers: typeof tilecastHelpers) {
  const w = window as any;
  if (w.tilecast) return;
  const started = performance.now();
  const clock = () => (performance.now() - started) / 1000;
  const hooks: ((t: number) => unknown)[] = [];
  w.tilecast = {
    get time() {
      return clock();
    },
    onFrame(fn: (t: number) => unknown) {
      hooks.push(fn);
    },
    ...makeHelpers(clock),
  };
  const loop = () => {
    const t = clock();
    for (const hook of hooks) {
      try {
        hook(t);
      } catch {
        // One failing hook must not stop the others.
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const isLocal = (ref: string) => ref !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|%23)/i.test(ref);

async function replaceAsync(text: string, pattern: RegExp, replace: (...match: string[]) => Promise<string>): Promise<string> {
  const parts: (string | Promise<string>)[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index), replace(...match));
    last = match.index! + match[0].length;
  }
  parts.push(text.slice(last));
  return (await Promise.all(parts)).join('');
}

export interface StandaloneResult {
  html: string;
  inlined: number;
  /** Local references that could not be inlined (missing or too large), left as links. */
  linked: string[];
}

export async function standaloneHtml(comp: Composition): Promise<StandaloneResult> {
  let inlined = 0;
  const linked: string[] = [];
  const baseDir = path.dirname(comp.file);

  const dataUrl = async (ref: string, from: string): Promise<string | null> => {
    const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
    const file = path.resolve(from, clean);
    const mime = MIME[path.extname(file).toLowerCase()];
    try {
      if (!mime) throw new Error('type');
      if ((await stat(file)).size > MAX_INLINE) throw new Error('size');
      inlined++;
      return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
    } catch {
      linked.push(ref);
      return null;
    }
  };

  // A quoted url() is read to its closing quote, so url(#id) references inside an
  // inlined SVG data URL are never mistaken for files.
  const inlineCssUrls = (css: string, from: string) =>
    replaceAsync(css, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi, async (whole, double, single, bare) => {
      const ref = (double ?? single ?? bare ?? '').trim();
      if (!isLocal(ref)) return whole;
      const data = await dataUrl(ref, from);
      return data ? `url("${data}")` : whole;
    });

  let html = comp.source;
  // Render-only sound: it never plays in a page.
  html = html.replace(/<audio\b[^>]*\bdata-tilecast\b[^>]*>[\s\S]*?<\/audio>/gi, '').replace(/<audio\b[^>]*\bdata-tilecast\b[^>]*\/?>/gi, '');
  // Local stylesheets become <style> blocks, with their own url()s resolved from their folder.
  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || !isLocal(href)) return tag;
    const file = path.resolve(baseDir, decodeURIComponent(href));
    try {
      const css = await inlineCssUrls(await readFile(file, 'utf8'), path.dirname(file));
      inlined++;
      return `<style>\n${css}\n</style>`;
    } catch {
      linked.push(href);
      return tag;
    }
  });
  // Local scripts are inlined.
  html = await replaceAsync(html, /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, async (whole, before, src, after) => {
    if (!isLocal(src)) return whole;
    try {
      const code = await readFile(path.resolve(baseDir, decodeURIComponent(src)), 'utf8');
      inlined++;
      return `<script${before}${after}>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    } catch {
      linked.push(src);
      return whole;
    }
  });
  // url() in <style> blocks and style attributes.
  html = await replaceAsync(html, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, async (_w, open, css, close) => `${open}${await inlineCssUrls(css, baseDir)}${close}`);
  html = await replaceAsync(html, /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi, async (_w, attr, quote, css) => `${attr}${quote}${await inlineCssUrls(css, baseDir)}${quote}`);
  // Images, video posters and sources, SVG images.
  html = await replaceAsync(html, /(<(?:img|source|video|image|use)\b[^>]*?\s(?:src|poster|href|xlink:href)\s*=\s*)(["'])([^"']+)\2/gi, async (whole, head, quote, ref) => {
    if (!isLocal(ref)) return whole;
    const data = await dataUrl(ref, baseDir);
    return data ? `${head}${quote}${data}${quote}` : whole;
  });

  const head = [
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    comp.fonts.length ? `<style>\n${fontFaceCss(comp.fonts)}\n</style>` : '',
    `<script>(${liveRuntime.toString()})(${tilecastHelpers.toString()});</script>`,
  ]
    .filter(Boolean)
    .join('\n');
  // Right after the charset declaration, which has to stay within the first bytes of the file,
  // and before any script of the composition that may call tilecast.
  const charset = /<meta\b[^>]*charset[^>]*>/i;
  if (charset.test(html)) html = html.replace(charset, (tag) => `${tag}\n${head}`);
  else if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n<meta charset="utf-8">\n${head}`);
  else html = `<meta charset="utf-8">\n${head}\n${html}`;
  return { html, inlined, linked };
}

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * The page at exactly one format's shape, scaled to fit any window or iframe:
 * the composition runs in an iframe whose viewport is the design canvas, so
 * designs in px and in vw/vh look exactly like the render; the margins take
 * the composition's own background color.
 */
export function fittedPage(inner: string, format: Format, options: { title: string; background: string }): string {
  const { width, height } = format;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title.replace(/</g, '&lt;')}</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: ${options.background}; }
  iframe { position: fixed; left: 50%; top: 50%; width: ${width}px; height: ${height}px; border: 0; transform-origin: 50% 50%; }
</style>
</head>
<body>
<iframe title="${escapeAttr(options.title)}" srcdoc="${escapeAttr(inner)}"></iframe>
<script>
  (function () {
    var frame = document.querySelector('iframe');
    function fit() {
      var k = Math.min(innerWidth / ${width}, innerHeight / ${height});
      frame.style.transform = 'translate(-50%, -50%) scale(' + k + ')';
    }
    addEventListener('resize', fit);
    fit();
  })();
</script>
</body>
</html>
`;
}
