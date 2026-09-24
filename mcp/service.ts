import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FORMATS, getFormat } from '../src/model/formats';
import { KINDS } from '../src/model/kinds';
import { designFromBrief, pickPalette, pickStyle } from '../src/model/offline';
import { MAX_TILES } from '../src/model/sanitize';
import { slugify } from '../src/model/slug';
import type { Design, FormatId, Palette, StyleId, Tile } from '../src/model/types';
import { designTitle, formatDocument, sheetDocument } from '../src/render/html';
import { CHROME_MISSING, findChrome, renderScreenshots, screenshotHtml } from './chrome';
import { applyOperations, buildTile, paletteName, tileId, type Operation, type TileInput } from './operations';
import { DesignStore, type StoredDesign } from './store';

export interface ToolResult {
  text: string;
  image?: { data: string; mimeType: 'image/png' };
}

export interface CreateInput {
  name?: string;
  tiles?: TileInput[];
  brief?: string;
  style?: StyleId;
  palette?: string;
  colors?: Partial<Palette>;
  preview?: boolean;
}

export interface ExportInput {
  id: string;
  formats?: FormatId[];
  out_dir?: string;
  png?: boolean;
  html?: boolean;
  animate?: boolean;
}

/** Copy lengths past which a tile usually reads badly on a poster. */
const LONG_COPY: Partial<Record<string, number>> = { headline: 60, text: 170, number: 12, cta: 40, info: 110, brand: 40 };

/** The tools' logic, independent of MCP so it can be tested directly. */
export class TilecastService {
  readonly store: DesignStore;
  private chromePath: string | null | undefined;

  constructor(
    readonly root: string,
    chrome?: string | null,
  ) {
    this.store = new DesignStore(root);
    this.chromePath = chrome;
  }

  private chrome(): string | null {
    if (this.chromePath === undefined) this.chromePath = findChrome();
    return this.chromePath;
  }

  async create(input: CreateInput): Promise<ToolResult> {
    let design: Design;
    if (input.tiles?.length) {
      if (input.tiles.length > MAX_TILES) throw new Error(`A design can have at most ${MAX_TILES} tiles.`);
      const tiles: Tile[] = [];
      for (const tile of input.tiles) tiles.push(await buildTile(this.root, tile, tiles.map((t) => t.id)));
      const brief = [input.brief, ...tiles.map((t) => t.text)].filter(Boolean).join(' ');
      design = { tiles, style: pickStyle(brief), palette: pickPalette(brief), seed: 0 };
    } else if (input.brief?.trim()) {
      // Rule-based draft; agents get better results by writing the tiles themselves.
      const draft = designFromBrief(input.brief);
      const ids: string[] = [];
      design = {
        ...draft,
        tiles: draft.tiles.map((tile) => {
          const id = tileId(tile.kind, ids);
          ids.push(id);
          return { ...tile, id };
        }),
      };
    } else {
      throw new Error('Pass `tiles` (recommended) or a `brief`.');
    }

    const operations: Operation[] = [];
    if (input.style) operations.push({ op: 'set_style', style: input.style });
    if (input.palette || input.colors) operations.push({ op: 'set_palette', palette: input.palette, colors: input.colors });
    design = await applyOperations(this.root, design, operations);

    const id = await this.store.freeId(slugify(input.name || designTitle(design), 'design'));
    const now = new Date().toISOString();
    const entry: StoredDesign = { id, createdAt: now, updatedAt: now, design };
    await this.store.save(entry);
    return this.report(entry, 'Created', input.preview ?? true);
  }

  async update(id: string, operations: Operation[], preview = true): Promise<ToolResult> {
    if (!operations.length) throw new Error('Pass at least one operation.');
    const entry = await this.store.load(id);
    const design = await applyOperations(this.root, entry.design, operations);
    const updated = { ...entry, design, updatedAt: new Date().toISOString() };
    await this.store.save(updated);
    return this.report(updated, 'Updated', preview);
  }

  async preview(id: string, format: FormatId | 'all' = 'all'): Promise<ToolResult> {
    return this.report(await this.store.load(id), 'Preview of', true, format);
  }

  async get(id: string): Promise<ToolResult> {
    const entry = await this.store.load(id);
    const tiles = entry.design.tiles.map(({ image, ...tile }) =>
      image ? { ...tile, image: `<${Math.round((image.length * 3) / 4 / 1024)} KB embedded image>` } : tile,
    );
    return { text: JSON.stringify({ ...entry, design: { ...entry.design, tiles } }, null, 2) };
  }

  async list(): Promise<ToolResult> {
    const entries = await this.store.list();
    if (!entries.length) return { text: 'No designs yet in tilecast/. Create one with create_design.' };
    return {
      text: entries
        .map((e) => `- ${e.id}: "${designTitle(e.design)}" (${e.design.tiles.length} tiles, ${e.design.style}, updated ${e.updatedAt})`)
        .join('\n'),
    };
  }

  async export(input: ExportInput): Promise<ToolResult> {
    const entry = await this.store.load(input.id);
    const formats = (input.formats?.length ? input.formats : FORMATS.map((f) => f.id)).map(getFormat);
    const outDir = this.resolveInside(input.out_dir ?? path.join('tilecast', 'export', entry.id));
    await mkdir(outDir, { recursive: true });
    const wantPng = input.png ?? true;
    const wantHtml = input.html ?? true;
    const files: string[] = [];
    const notes: string[] = [];

    if (wantHtml) {
      for (const format of formats) {
        const file = path.join(outDir, `${entry.id}-${format.id}.html`);
        await writeFile(file, formatDocument(entry.design, format, { animate: input.animate ?? true, fitWindow: true }));
        files.push(file);
      }
    }
    if (wantPng) {
      const chrome = this.chrome();
      if (!chrome) {
        notes.push(CHROME_MISSING);
      } else {
        const jobs = formats.map((format) => ({
          html: formatDocument(entry.design, format),
          width: format.width,
          height: format.height,
          outFile: path.join(outDir, `${entry.id}-${format.id}-${format.width}x${format.height}.png`),
        }));
        await renderScreenshots(chrome, jobs);
        files.push(...jobs.map((job) => job.outFile));
      }
    }

    const lines = await Promise.all(
      files.map(async (file) => `- ${this.store.relative(file)} (${Math.round((await stat(file)).size / 1024)} KB)`),
    );
    return {
      text: [
        `Exported "${entry.id}" (${formats.map((f) => f.label).join(', ')}):`,
        ...lines,
        wantHtml &&
          'HTML files are standalone (fonts and images inlined): open them in a browser, or embed the .canvas markup in a web page.',
        ...notes,
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  /** Output paths stay inside the project so a stray argument cannot write elsewhere. */
  private resolveInside(dir: string): string {
    const resolved = path.resolve(this.root, dir);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`out_dir must be inside the project (${this.root}).`);
    }
    return resolved;
  }

  private async report(entry: StoredDesign, verb: string, withPreview: boolean, only: FormatId | 'all' = 'all') {
    const { design } = entry;
    const palette = paletteName(design.palette);
    const lines = [
      `${verb} design "${entry.id}": style ${design.style}, palette ${palette ?? 'custom'} ` +
        `(bg ${design.palette.bg}, accent ${design.palette.accent}), layout variant ${design.seed}.`,
      'Tiles in reading order (first = top-left):',
      ...design.tiles.map((tile, i) => {
        const content = tile.kind === 'image' ? (tile.image ? '(photo)' : '(decorative pattern, no photo yet)') : JSON.stringify(tile.text);
        const logo = tile.kind === 'brand' && tile.image ? ' (logo image)' : '';
        return `  ${i + 1}. id=${tile.id} ${tile.kind} size=${tile.size} tone=${tile.tone}: ${content}${logo}`;
      }),
      `Saved: ${this.store.relative(this.store.file(entry.id))}`,
    ];

    const warnings = design.tiles.flatMap((tile) => {
      const limit = LONG_COPY[tile.kind];
      if (limit && tile.text.length > limit) {
        return [`${tile.id}: ${tile.text.length} characters is long for a ${KINDS[tile.kind].label.toLowerCase()} tile; shorter copy will render bigger.`];
      }
      if (!tile.text && tile.kind !== 'image' && !(tile.kind === 'brand' && tile.image)) return [`${tile.id} is empty.`];
      return [];
    });
    if (!design.tiles.some((t) => t.kind === 'headline')) warnings.push('There is no headline tile.');
    if (warnings.length) lines.push('Check:', ...warnings.map((w) => `  - ${w}`));

    const result: ToolResult = { text: '' };
    if (withPreview) {
      const formats = only === 'all' ? FORMATS : [getFormat(only)];
      const previewDir = path.join(this.store.dir, 'previews');
      await mkdir(previewDir, { recursive: true });
      const sheet = sheetDocument(design, only === 'all' ? 440 : 900, formats);
      const chrome = this.chrome();
      if (chrome) {
        const file = path.join(previewDir, `${entry.id}.png`);
        await screenshotHtml(chrome, sheet.html, sheet.width, sheet.height, file);
        result.image = { data: (await readFile(file)).toString('base64'), mimeType: 'image/png' };
        lines.push(`Preview: ${this.store.relative(file)} (attached). Look at it before exporting.`);
      } else {
        const file = path.join(previewDir, `${entry.id}.html`);
        await writeFile(file, sheet.html);
        lines.push(`Preview page: ${this.store.relative(file)} (open it in a browser).`, CHROME_MISSING);
      }
    }
    result.text = lines.join('\n');
    return result;
  }
}
