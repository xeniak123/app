import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from './browser';
import { fontFacesFor } from './fonts';
import type { Format } from './formats';
import { runtimeScript, type AuditResult, type CompositionInfo, type RuntimeFont, type TextSample } from './runtime';

export interface Composition {
  /** Absolute path of the HTML file. */
  file: string;
  relative: string;
  name: string;
  url: string;
  source: string;
  fonts: RuntimeFont[];
}

/** Resolves a path against the project and refuses anything outside it. */
export function resolveInside(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`"${target}" is outside the project (${root}).`);
  }
  return resolved;
}

export async function loadComposition(root: string, file: string): Promise<Composition> {
  const absolute = resolveInside(root, file);
  if (!/\.html?$/i.test(absolute)) throw new Error(`"${file}" is not an .html file. Compositions are HTML pages.`);
  let source: string;
  try {
    source = await readFile(absolute, 'utf8');
  } catch {
    throw new Error(`Cannot read "${file}". Write the composition as an HTML file first.`);
  }
  // Local stylesheets count when deciding which bundled fonts to load.
  let styles = '';
  for (const match of source.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(match[1])) continue;
    styles += await readFile(path.resolve(path.dirname(absolute), match[1]), 'utf8').catch(() => '');
  }
  return {
    file: absolute,
    relative: path.relative(root, absolute),
    name: path.basename(absolute).replace(/\.html?$/i, ''),
    url: pathToFileURL(absolute).href,
    source,
    fonts: fontFacesFor(source + styles),
  };
}

/** A composition open in a browser page at one format. */
export class Stage {
  private constructor(
    readonly page: Page,
    readonly format: Format,
    /** Device pixel ratio the page renders at. */
    readonly scale: number,
  ) {}

  static async open(browser: Browser, composition: Composition, format: Format, scale = format.scale): Promise<Stage> {
    const page = await browser.newPage({ width: format.width, height: format.height, scale });
    try {
      await page.addInitScript(runtimeScript(composition.fonts));
      await page.goto(composition.url);
      const stage = new Stage(page, format, scale);
      await stage.seek(0);
      return stage;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  seek(seconds: number): Promise<void> {
    return this.page.evaluate(`__tilecast.seek(${Number(seconds.toFixed(4))})`);
  }

  info(): Promise<CompositionInfo> {
    return this.page.evaluate('__tilecast.info()');
  }

  audit(): Promise<AuditResult> {
    return this.page.evaluate('__tilecast.audit()');
  }

  sample(): Promise<TextSample[]> {
    return this.page.evaluate('__tilecast.sample()');
  }

  /** Captures the canvas. `zoom` scales the output relative to the page's device pixel ratio. */
  capture(options: { type?: 'png' | 'jpeg'; quality?: number; zoom?: number } = {}): Promise<Buffer> {
    return this.page.screenshot({
      format: options.type ?? 'png',
      quality: options.quality,
      clip: { x: 0, y: 0, width: this.format.width, height: this.format.height, scale: options.zoom ?? 1 },
    });
  }

  close(): Promise<void> {
    return this.page.close();
  }
}

/** The moment a still (poster, preview) shows: explicit time, the composition's poster time, or the end of its entrance animations. */
export function stillTime(info: CompositionInfo, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  if (info.poster !== null) return info.poster;
  if (info.duration !== null) return Math.max(0, info.duration * 0.6);
  return Math.min(info.animationEnd, 30);
}
