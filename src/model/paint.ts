import { contrast, mix, readable } from './color';
import type { Palette, Tile, TileKind } from './types';

export interface TilePaint {
  background: string;
  color: string;
  /** Hairline for cards that would otherwise vanish into a same-colored background. */
  border: string | null;
}

/** Big display text stays legible at a lower contrast ratio (WCAG large text: 3:1). */
const LARGE_TEXT: TileKind[] = ['headline', 'number', 'brand', 'emoji'];

export function paintTile(tile: Pick<Tile, 'kind' | 'tone'>, palette: Palette): TilePaint {
  const minRatio = LARGE_TEXT.includes(tile.kind) ? 3 : 4.5;
  switch (tile.tone) {
    case 'accent':
      return { background: palette.accent, color: readable(palette.accentInk, palette.accent, minRatio), border: null };
    case 'ink':
      return { background: palette.ink, color: readable(palette.bg, palette.ink, minRatio), border: null };
    case 'surface':
      return {
        background: palette.surface,
        color: readable(palette.ink, palette.surface, minRatio),
        border: contrast(palette.surface, palette.bg) < 1.12 ? mix(palette.bg, palette.ink, 0.16) : null,
      };
    case 'clear': {
      const text = readable(palette.ink, palette.bg, minRatio);
      const pop = tile.kind === 'number' || tile.kind === 'emoji' ? readable(palette.accent, palette.bg, 3) : text;
      return { background: 'transparent', color: pop, border: null };
    }
  }
}
