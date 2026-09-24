import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PALETTES } from '../src/model/themes';
import { STYLE_IDS, TILE_KINDS, TILE_SIZES, TILE_TONES } from '../src/model/types';
import type { TilecastService, ToolResult } from './service';
import { VERSION } from './version';

export const INSTRUCTIONS = `Tilecast designs posters and social graphics out of tiles. One design renders into four formats at once: A4 poster (2480×3508), square post (1080×1080), story (1080×1920) and 16:9 banner (1920×1080). A layout engine places the tiles; you decide the copy, order, size and tone.
Workflow: (1) create_design with tiles you write yourself. (2) Look at the attached preview and fix what reads badly with update_design: swap_tiles or move_tile to rearrange, set_tile to edit copy, size or tone, set_style, set_palette, next_layout for another arrangement. (3) export_design writes full-size PNGs and standalone HTML to tilecast/export/.
Write short poster copy in the user's language and use only facts the user gave you: never invent prices, dates, addresses, phone numbers or links.`;

const PALETTE_NAMES = PALETTES.map((p) => p.name).join(', ');

const kind = z
  .enum(TILE_KINDS)
  .describe(
    'headline: main message, 2-7 words (exactly one). text: 1-2 supporting sentences. number: one striking figure such as "-30%", "49 zł", "12.10" (max ~8 chars). ' +
      'cta: call to action with the link or contact, e.g. "Order at roma.pl →". info: when/where/contact, up to 3 short lines separated by \\n. ' +
      'image: photo slot (leave text empty; pass image_path for a real photo, otherwise a decorative pattern is drawn). emoji: one emoji. brand: organizer or company name (or a logo via image_path).',
  );
const size = z.enum(TILE_SIZES).describe('Share of the canvas area. Typical: headline L or XL, image L, key number M or L, details S.');
const tone = z
  .enum(TILE_TONES)
  .describe('accent: accent-colored tile; surface: card; ink: inverted high-contrast tile; clear: no background. Neighbouring tiles look best in different tones.');
const imagePath = z.string().describe('Path to a PNG/JPEG/WebP/GIF/SVG file (photo for image tiles, logo for brand tiles), relative to the project.');
const style = z
  .enum(STYLE_IDS)
  .describe('bold: loud condensed uppercase; elegant: serif, calm; playful: rounded and fun; minimal: grotesk, technical.');
const palette = z.string().describe(`Palette name: ${PALETTE_NAMES}.`);
const colors = z
  .object({
    bg: z.string().optional(),
    surface: z.string().optional(),
    ink: z.string().optional(),
    accent: z.string().optional(),
    accentInk: z.string().optional(),
  })
  .describe('Hex colors (#rrggbb) overriding the palette: bg = canvas, surface = cards, ink = main text, accent, accentInk = text on accent. Unreadable text colors are corrected automatically.');
const formatId = z.enum(['poster', 'square', 'story', 'banner']);

const tileInput = z.object({
  kind,
  text: z.string().optional().describe('Tile copy. Empty for image tiles.'),
  size: size.optional(),
  tone: tone.optional(),
  image_path: imagePath.optional(),
});

const operation = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set_tile'),
    tile_id: z.string(),
    text: z.string().optional(),
    kind: kind.optional(),
    size: size.optional(),
    tone: tone.optional(),
    image_path: imagePath.optional(),
    remove_image: z.boolean().optional(),
  }),
  tileInput.extend({
    op: z.literal('add_tile'),
    position: z.number().int().min(0).optional().describe('Index in reading order; 0 = first. Default: last.'),
  }),
  z.object({ op: z.literal('remove_tile'), tile_id: z.string() }),
  z.object({ op: z.literal('swap_tiles'), a: z.string(), b: z.string() }),
  z.object({ op: z.literal('move_tile'), tile_id: z.string(), position: z.number().int().min(0) }),
  z.object({ op: z.literal('set_style'), style }),
  z.object({ op: z.literal('set_palette'), palette: palette.optional(), colors: colors.optional() }),
  z.object({ op: z.literal('next_layout') }),
  z.object({ op: z.literal('set_layout'), variant: z.number().int().min(0).describe('0 is the default arrangement.') }),
]);

function toContent(result: ToolResult): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text: result.text }];
  if (result.image) content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType });
  return { content };
}

function safely<A>(handler: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return toContent(await handler(args));
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  };
}

export function createTilecastServer(service: TilecastService): McpServer {
  const server = new McpServer({ name: 'tilecast', version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'create_design',
    {
      title: 'Create a design',
      description:
        'Create a poster/social-graphic design from tiles and get a preview of all four formats. Write the tiles yourself: ' +
        '5-9 tiles in reading order with exactly one headline and one image, plus what the content needs (number, text, info, cta, emoji, brand). ' +
        'Returns the design id and tile ids for update_design.',
      inputSchema: {
        tiles: z.array(tileInput).max(12).optional().describe('The tiles in reading order (recommended).'),
        brief: z
          .string()
          .optional()
          .describe('Only when you pass no tiles: a one-sentence brief turned into a rule-based draft.'),
        name: z.string().optional().describe('Short name for the design id, e.g. "pizza-friday". Defaults to the headline.'),
        style: style.optional(),
        palette: palette.optional(),
        colors: colors.optional(),
        preview: z.boolean().optional().describe('Render and attach a preview image (default true).'),
      },
    },
    safely((args) => service.create(args)),
  );

  server.registerTool(
    'update_design',
    {
      title: 'Edit a design',
      description:
        'Edit a design and get a fresh preview. Operations run in order: set_tile, add_tile, remove_tile, swap_tiles, move_tile, ' +
        'set_style, set_palette, next_layout (another arrangement of the same tiles), set_layout. ' +
        'Tile order drives the layout in every format: earlier tiles land top-left, so rearranging tiles moves them in all formats at once.',
      inputSchema: {
        id: z.string().describe('Design id from create_design or list_designs.'),
        operations: z.array(operation).min(1),
        preview: z.boolean().optional().describe('Render and attach a preview image (default true).'),
      },
    },
    safely(({ id, operations, preview }) => service.update(id, operations, preview)),
  );

  server.registerTool(
    'preview_design',
    {
      title: 'Preview a design',
      description: 'Render a preview PNG of a design: all formats side by side, or one format larger.',
      inputSchema: {
        id: z.string(),
        format: z.enum(['all', 'poster', 'square', 'story', 'banner']).optional(),
      },
    },
    safely(({ id, format }) => service.preview(id, format)),
  );

  server.registerTool(
    'export_design',
    {
      title: 'Export a design',
      description:
        'Export full-resolution PNGs (poster 2480×3508 at 300 dpi, post 1080×1080, story 1080×1920, banner 1920×1080) and standalone HTML files ' +
        '(fonts and images inlined, ready to open or embed in a website; animate adds the tiles\' entrance animation). Default folder: tilecast/export/<id>/.',
      inputSchema: {
        id: z.string(),
        formats: z.array(formatId).optional().describe('Default: all four.'),
        out_dir: z.string().optional().describe('Folder inside the project, e.g. "public/promo".'),
        png: z.boolean().optional().describe('Default true. Needs Chrome, Chromium or Edge installed.'),
        html: z.boolean().optional().describe('Default true.'),
        animate: z.boolean().optional().describe('Entrance animation in the HTML files (default true).'),
      },
    },
    safely((args) => service.export(args)),
  );

  server.registerTool(
    'list_designs',
    {
      title: 'List designs',
      description: 'List the designs saved in this project (tilecast/*.tilecast.json).',
      annotations: { readOnlyHint: true },
    },
    safely(() => service.list()),
  );

  server.registerTool(
    'get_design',
    {
      title: 'Read a design',
      description: 'Return a design as JSON: tiles with ids, style, palette and layout variant.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    safely(({ id }) => service.get(id)),
  );

  return server;
}
