import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeHex } from '../src/model/color';
import { newArtSeed } from '../src/model/ids';
import { KINDS } from '../src/model/kinds';
import { hashString } from '../src/model/layout';
import { MAX_TEXT, MAX_TILES } from '../src/model/sanitize';
import { PALETTES } from '../src/model/themes';
import type { ArtMotif, Design, Palette, StyleId, Tile, TileArt, TileKind, TileSize, TileTone } from '../src/model/types';
import { ICONS } from '../src/render/icons';

export interface TileInput {
  kind: TileKind;
  text?: string;
  size?: TileSize;
  tone?: TileTone;
  image_path?: string;
  /** Image tiles without a photo: artwork motif, or "auto". */
  art?: ArtMotif | 'auto';
  /** Image tiles without a photo: icon name, "auto" (from the topic) or "none". */
  icon?: string;
}

export type Operation =
  | {
      op: 'set_tile';
      tile_id: string;
      text?: string;
      kind?: TileKind;
      size?: TileSize;
      tone?: TileTone;
      image_path?: string;
      remove_image?: boolean;
      art?: ArtMotif | 'auto';
      icon?: string;
    }
  | ({ op: 'add_tile'; position?: number } & TileInput)
  | { op: 'remove_tile'; tile_id: string }
  | { op: 'swap_tiles'; a: string; b: string }
  | { op: 'move_tile'; tile_id: string; position: number }
  | { op: 'set_style'; style: StyleId }
  | { op: 'set_palette'; palette?: string; colors?: Partial<Palette> }
  | { op: 'shuffle_art'; tile_id?: string }
  | { op: 'next_layout' }
  | { op: 'set_layout'; variant: number };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Reads a photo or logo from disk as a data URL, checking the file really is an image. */
export async function loadImage(root: string, file: string): Promise<string> {
  const absolute = path.resolve(root, file);
  const buffer = await readFile(absolute).catch(() => {
    throw new Error(`Cannot read image "${file}".`);
  });
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`Image "${file}" is larger than 8 MB; use a smaller file.`);
  const head = buffer.subarray(0, 512).toString('latin1');
  let mime: string | null = null;
  if (buffer[0] === 0x89 && head.slice(1, 4) === 'PNG') mime = 'image/png';
  else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) mime = 'image/jpeg';
  else if (head.startsWith('GIF8')) mime = 'image/gif';
  else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') mime = 'image/webp';
  else if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buffer.subarray(0, 2048).toString('utf8'))) {
    mime = 'image/svg+xml';
  }
  if (!mime) throw new Error(`"${file}" is not a PNG, JPEG, GIF, WebP or SVG image.`);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Readable, stable ids ("headline", "text-2") so agents can refer to tiles in later calls. */
export function tileId(kind: TileKind, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(kind)) return kind;
  for (let i = 2; ; i++) if (!used.has(`${kind}-${i}`)) return `${kind}-${i}`;
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function findPalette(name: string): Palette {
  const match = PALETTES.find((p) => fold(p.name) === fold(name.trim()));
  if (!match) throw new Error(`Unknown palette "${name}". Available: ${PALETTES.map((p) => p.name).join(', ')}.`);
  const { name: _name, ...colors } = match;
  return colors;
}

export function paletteName(palette: Palette): string | null {
  return (
    PALETTES.find(
      (p) =>
        p.bg === palette.bg &&
        p.surface === palette.surface &&
        p.ink === palette.ink &&
        p.accent === palette.accent &&
        p.accentInk === palette.accentInk,
    )?.name ?? null
  );
}

function withColors(palette: Palette, colors: Partial<Palette>): Palette {
  const next = { ...palette };
  for (const key of Object.keys(colors) as (keyof Palette)[]) {
    const value = colors[key];
    if (value === undefined) continue;
    const hex = normalizeHex(value);
    if (!hex) throw new Error(`Color "${key}" must be a hex color like #e4572e, got "${value}".`);
    next[key] = hex;
  }
  return next;
}

/** Applies "art"/"icon" choices to an image tile's artwork settings. */
function withArt(current: TileArt | undefined, art?: ArtMotif | 'auto', icon?: string): TileArt {
  const next: TileArt = { ...(current ?? { seed: newArtSeed() }) };
  if (art === 'auto') delete next.motif;
  else if (art) next.motif = art;
  if (icon === 'auto') delete next.icon;
  else if (icon === 'none') next.icon = null;
  else if (icon !== undefined) {
    if (!ICONS[icon]) throw new Error(`Unknown icon "${icon}". Use "auto", "none" or one of: ${Object.keys(ICONS).sort().join(', ')}.`);
    next.icon = icon;
  }
  return next;
}

export async function buildTile(root: string, input: TileInput, taken: Iterable<string>): Promise<Tile> {
  const spec = KINDS[input.kind];
  const tile: Tile = {
    id: tileId(input.kind, taken),
    kind: input.kind,
    text: (input.text ?? '').trim().slice(0, MAX_TEXT),
    size: input.size ?? spec.defaultSize,
    tone: input.tone ?? spec.defaultTone,
  };
  if (input.image_path) tile.image = await loadImage(root, input.image_path);
  // Every image tile gets its own random artwork, so no two designs share a picture.
  if (input.kind === 'image') tile.art = withArt(undefined, input.art, input.icon);
  return tile;
}

function indexOf(design: Design, id: string): number {
  const index = design.tiles.findIndex((t) => t.id === id);
  if (index < 0) {
    throw new Error(`No tile "${id}". Tiles in this design: ${design.tiles.map((t) => t.id).join(', ')}.`);
  }
  return index;
}

function clampPosition(position: number, length: number): number {
  return Math.max(0, Math.min(length, Math.round(position)));
}

/** Applies edits in order; any invalid step aborts the whole batch, leaving the saved design untouched. */
export async function applyOperations(root: string, design: Design, operations: Operation[]): Promise<Design> {
  let next: Design = { ...design, tiles: [...design.tiles] };
  for (const operation of operations) {
    switch (operation.op) {
      case 'set_tile': {
        const index = indexOf(next, operation.tile_id);
        const tile = { ...next.tiles[index] };
        if (operation.text !== undefined) tile.text = operation.text.trim().slice(0, MAX_TEXT);
        if (operation.kind) tile.kind = operation.kind;
        if (operation.size) tile.size = operation.size;
        if (operation.tone) tile.tone = operation.tone;
        if (operation.remove_image) delete tile.image;
        if (operation.image_path) tile.image = await loadImage(root, operation.image_path);
        if (operation.art !== undefined || operation.icon !== undefined) {
          if (tile.kind !== 'image') throw new Error(`"art" and "icon" apply to image tiles; ${tile.id} is a ${tile.kind} tile.`);
          // Keep the current picture's seed so only the requested aspect changes.
          tile.art = withArt(tile.art ?? { seed: hashString(tile.id) }, operation.art, operation.icon);
        }
        next.tiles[index] = tile;
        break;
      }
      case 'add_tile': {
        if (next.tiles.length >= MAX_TILES) throw new Error(`A design can have at most ${MAX_TILES} tiles.`);
        const { op: _op, position, ...input } = operation;
        const tile = await buildTile(root, input, next.tiles.map((t) => t.id));
        next.tiles.splice(clampPosition(position ?? next.tiles.length, next.tiles.length), 0, tile);
        break;
      }
      case 'remove_tile':
        next.tiles.splice(indexOf(next, operation.tile_id), 1);
        break;
      case 'swap_tiles': {
        const a = indexOf(next, operation.a);
        const b = indexOf(next, operation.b);
        [next.tiles[a], next.tiles[b]] = [next.tiles[b], next.tiles[a]];
        break;
      }
      case 'move_tile': {
        const [tile] = next.tiles.splice(indexOf(next, operation.tile_id), 1);
        next.tiles.splice(clampPosition(operation.position, next.tiles.length), 0, tile);
        break;
      }
      case 'set_style':
        next = { ...next, style: operation.style };
        break;
      case 'set_palette': {
        let palette = operation.palette ? findPalette(operation.palette) : next.palette;
        if (operation.colors) palette = withColors(palette, operation.colors);
        next = { ...next, palette };
        break;
      }
      case 'shuffle_art': {
        const targets = operation.tile_id
          ? [indexOf(next, operation.tile_id)]
          : next.tiles.flatMap((t, i) => (t.kind === 'image' ? [i] : []));
        if (targets.length === 0) throw new Error('This design has no image tile.');
        for (const index of targets) {
          const tile = next.tiles[index];
          if (tile.kind !== 'image') throw new Error(`${tile.id} is not an image tile.`);
          next.tiles[index] = { ...tile, art: { ...(tile.art ?? {}), seed: newArtSeed() } };
        }
        break;
      }
      case 'next_layout':
        next = { ...next, seed: next.seed + 1 };
        break;
      case 'set_layout':
        next = { ...next, seed: Math.max(0, Math.round(operation.variant)) };
        break;
    }
  }
  if (next.tiles.length === 0) throw new Error('A design needs at least one tile.');
  return next;
}
