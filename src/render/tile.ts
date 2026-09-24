import { KINDS } from '../model/kinds';
import { hashString } from '../model/layout';
import { paintTile, type TilePaint } from '../model/paint';
import { STYLES } from '../model/themes';
import type { Design, Rect, Tile, TileKind } from '../model/types';
import { artworkUrl } from './artwork';
import { topicIcon } from './icons';

export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const ALIGN: Record<TileKind, { justify: 'flex-start' | 'center' | 'flex-end'; text: 'left' | 'center' }> = {
  headline: { justify: 'flex-end', text: 'left' },
  text: { justify: 'flex-start', text: 'left' },
  number: { justify: 'center', text: 'center' },
  cta: { justify: 'center', text: 'center' },
  info: { justify: 'flex-end', text: 'left' },
  image: { justify: 'flex-end', text: 'left' },
  emoji: { justify: 'center', text: 'center' },
  brand: { justify: 'center', text: 'left' },
};

/** Everything needed to draw one tile, shared by the editor (React) and the standalone HTML renderer. */
export interface TileRender {
  paint: TilePaint;
  backgroundImage?: string;
  boxShadow?: string;
  radius: number;
  /** Inner padding and the text box inside it, in pixels of the rendered canvas. */
  pad: number;
  boxW: number;
  boxH: number;
  /** Upper bound for text fitting, in pixels. */
  maxFontPx: number;
  /** Empty when the tile shows no text (photos, logos). */
  text: string;
  logo?: string;
  font: {
    family: string;
    weight: number;
    transform: 'uppercase' | 'none';
    letterSpacing: string;
    lineHeight: number;
    align: 'left' | 'center';
    justify: 'flex-start' | 'center' | 'flex-end';
  };
}

export function tileRender(tile: Tile, rect: Rect, canvasW: number, canvasH: number, design: Design): TileRender {
  const style = STYLES[design.style];
  const spec = KINDS[tile.kind];
  const paint = paintTile(tile, design.palette);

  const shorter = Math.min(canvasW, canvasH);
  const w = rect.w * canvasW;
  const h = rect.h * canvasH;
  const pad = Math.min(style.tilePadding * shorter, Math.min(w, h) * 0.18);

  const isDisplay = spec.font === 'display';
  const logo = tile.kind === 'brand' && tile.image ? tile.image : undefined;

  let backgroundImage: string | undefined;
  if (tile.kind === 'image') {
    backgroundImage = tile.image ? `url("${tile.image}")` : artworkFor(tile, design, paint, w / h);
  }

  return {
    paint,
    backgroundImage,
    boxShadow: paint.border ? `inset 0 0 0 ${Math.max(1, shorter * 0.002)}px ${paint.border}` : undefined,
    radius: Math.min(style.radius * shorter, Math.min(w, h) * 0.3),
    pad,
    boxW: Math.max(w - 2 * pad, 1),
    boxH: Math.max(h - 2 * pad, 1),
    maxFontPx: spec.maxFont * shorter,
    text: logo ? '' : tile.text,
    logo,
    font: {
      family: spec.font === 'emoji' ? EMOJI_FONT : isDisplay ? style.display : style.body,
      weight: isDisplay ? style.displayWeight : tile.kind === 'cta' ? 600 : style.bodyWeight,
      transform: isDisplay && style.uppercase && tile.kind !== 'brand' ? 'uppercase' : 'none',
      letterSpacing: isDisplay ? style.letterSpacing : '0',
      lineHeight: isDisplay ? style.lineHeight : 1.25,
      align: ALIGN[tile.kind].text,
      justify: ALIGN[tile.kind].justify,
    },
  };
}

/** Generated picture for an image tile without a photo; see artwork.ts. */
function artworkFor(tile: Tile, design: Design, paint: TilePaint, aspect: number): string {
  const seed = tile.art?.seed ?? hashString(tile.id);
  const icon =
    tile.art && tile.art.icon !== undefined
      ? tile.art.icon
      : topicIcon(design.tiles.map((t) => t.text).join(' '), seed);
  return artworkUrl({
    style: design.style,
    palette: design.palette,
    base: paint.background === 'transparent' ? design.palette.bg : paint.background,
    ink: paint.color,
    aspect,
    seed,
    motif: tile.art?.motif,
    icon,
  });
}
