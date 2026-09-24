import { normalizeHex } from './color';
import { newArtSeed, newId } from './ids';
import { KINDS } from './kinds';
import { PALETTES } from './themes';
import {
  ART_MOTIFS,
  STYLE_IDS,
  TILE_KINDS,
  TILE_SIZES,
  TILE_TONES,
  type Design,
  type Palette,
  type StyleId,
  type Tile,
  type TileArt,
} from './types';

export const MAX_TILES = 12;
export const MAX_TEXT = 280;
const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i;

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.includes(value as T) ? (value as T) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ICON_NAME = /^[a-z0-9-]{1,40}$/;

function sanitizeArt(raw: unknown): TileArt | undefined {
  if (!isRecord(raw)) return undefined;
  const art: TileArt = {
    seed: typeof raw.seed === 'number' && Number.isInteger(raw.seed) ? raw.seed >>> 0 : newArtSeed(),
  };
  const motif = oneOf(ART_MOTIFS, raw.motif);
  if (motif) art.motif = motif;
  if (raw.icon === null) art.icon = null;
  else if (typeof raw.icon === 'string' && ICON_NAME.test(raw.icon)) art.icon = raw.icon;
  return art;
}

export function sanitizeTile(raw: unknown): Tile | null {
  if (!isRecord(raw)) return null;
  const kind = oneOf(TILE_KINDS, raw.kind);
  if (!kind) return null;
  const spec = KINDS[kind];
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TEXT) : '';
  const image = typeof raw.image === 'string' && IMAGE_DATA_URL.test(raw.image) ? raw.image : undefined;
  const art = kind === 'image' ? sanitizeArt(raw.art) : undefined;
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : newId(),
    kind,
    text,
    size: oneOf(TILE_SIZES, raw.size) ?? spec.defaultSize,
    tone: oneOf(TILE_TONES, raw.tone) ?? spec.defaultTone,
    ...(image ? { image } : {}),
    ...(art ? { art } : {}),
  };
}

export function sanitizePalette(raw: unknown, fallback: Palette = PALETTES[0]): Palette {
  const source = isRecord(raw) ? raw : {};
  return {
    bg: normalizeHex(source.bg) ?? fallback.bg,
    surface: normalizeHex(source.surface) ?? fallback.surface,
    ink: normalizeHex(source.ink) ?? fallback.ink,
    accent: normalizeHex(source.accent) ?? fallback.accent,
    accentInk: normalizeHex(source.accentInk) ?? fallback.accentInk,
  };
}

/** Turns untrusted input (AI output, saved projects) into a valid design, or null if nothing usable is left. */
export function sanitizeDesign(raw: unknown): Design | null {
  if (!isRecord(raw) || !Array.isArray(raw.tiles)) return null;
  const seen = new Set<string>();
  const tiles: Tile[] = [];
  for (const item of raw.tiles) {
    const tile = sanitizeTile(item);
    if (!tile) continue;
    if (tile.kind !== 'image' && tile.kind !== 'brand' && !tile.text) continue;
    if (seen.has(tile.id)) tile.id = newId();
    seen.add(tile.id);
    tiles.push(tile);
    if (tiles.length >= MAX_TILES) break;
  }
  if (tiles.length === 0) return null;
  const seed = typeof raw.seed === 'number' && Number.isInteger(raw.seed) && raw.seed >= 0 ? raw.seed : 0;
  return {
    tiles,
    palette: sanitizePalette(raw.palette),
    style: oneOf<StyleId>(STYLE_IDS, raw.style) ?? 'bold',
    seed,
  };
}
