import { z } from 'zod/v4';
import { STYLE_IDS, TILE_KINDS, TILE_SIZES, TILE_TONES } from '../src/model/types';

const hex = (what: string) => z.string().describe(`${what}, as #rrggbb`);

export const AiTileSchema = z.object({
  id: z.string().describe('Id of an existing tile you keep; empty string for a new tile.'),
  kind: z.enum(TILE_KINDS),
  text: z.string().describe('Tile copy. Empty for image tiles. For emoji tiles, a single emoji.'),
  size: z.enum(TILE_SIZES).describe("Share of the canvas area: S, M, L or XL."),
  tone: z.enum(TILE_TONES),
});

export const AiDesignSchema = z.object({
  style: z.enum(STYLE_IDS),
  palette: z.object({
    bg: hex('Canvas background'),
    surface: hex('Card background'),
    ink: hex('Main text color, readable on bg and surface'),
    accent: hex('Accent color'),
    accentInk: hex('Text color on the accent'),
  }),
  tiles: z.array(AiTileSchema).describe('5 to 9 tiles in reading order.'),
});

export type AiDesign = z.infer<typeof AiDesignSchema>;
