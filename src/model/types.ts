export const TILE_KINDS = [
  'headline',
  'text',
  'number',
  'cta',
  'info',
  'image',
  'emoji',
  'brand',
] as const;
export type TileKind = (typeof TILE_KINDS)[number];

export const TILE_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type TileSize = (typeof TILE_SIZES)[number];

/** How a tile is painted: on the accent color, on a card, inverted, or straight on the background. */
export const TILE_TONES = ['accent', 'surface', 'ink', 'clear'] as const;
export type TileTone = (typeof TILE_TONES)[number];

export const STYLE_IDS = ['bold', 'elegant', 'playful', 'minimal'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export interface Tile {
  id: string;
  kind: TileKind;
  /** Text content; for `emoji` tiles the emoji itself, for `image` tiles an optional caption. */
  text: string;
  size: TileSize;
  tone: TileTone;
  /** Data URL of an uploaded photo (image tiles) or logo (brand tiles). */
  image?: string;
}

export interface Palette {
  bg: string;
  surface: string;
  ink: string;
  accent: string;
  accentInk: string;
}

/** One design renders into every format; tile order is the reading order. */
export interface Design {
  tiles: Tile[];
  palette: Palette;
  style: StyleId;
  /** Picks a layout variant; 0 is the canonical best layout. */
  seed: number;
}

export type FormatId = 'poster' | 'square' | 'story' | 'banner';

export interface Format {
  id: FormatId;
  label: string;
  /** Export size in pixels. */
  width: number;
  height: number;
  note: string;
}

/** A rectangle expressed as fractions (0..1) of the canvas width and height. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
