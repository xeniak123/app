import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChrome, pngSize } from './chrome';
import { TilecastService } from './service';
import { createTilecastServer } from './tools';

const chrome = findChrome();
// A 2x2 red PNG.
const PNG_2X2 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAwMAAAA0KAQD1q4pYAAAAAElFTkSuQmCC';

type Content = { type: string; text?: string; data?: string };

let root: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { content: Content[]; isError?: boolean };
  const text = result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const image = result.content.find((c) => c.type === 'image');
  return { text, image, isError: Boolean(result.isError) };
}

const pizzaTiles = [
  { kind: 'brand', text: 'Pizzeria Roma' },
  { kind: 'headline', text: 'Piątek z pizzą', size: 'L' },
  { kind: 'image' },
  { kind: 'number', text: '-30%', tone: 'accent' },
  { kind: 'info', text: 'Każdy piątek\nul. Długa 5, Kraków' },
  { kind: 'cta', text: 'Zamów na roma.pl →' },
];

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tilecast-test-'));
  await writeFile(path.join(root, 'photo.png'), Buffer.from(PNG_2X2, 'base64'));
  await writeFile(path.join(root, 'notes.txt'), 'not an image');
  const server = createTilecastServer(new TilecastService(root, chrome));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
  await rm(root, { recursive: true, force: true });
});

describe('tilecast MCP server', () => {
  it('advertises its tools and usage instructions', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_design',
      'export_design',
      'get_design',
      'list_designs',
      'preview_design',
      'update_design',
    ]);
    expect(client.getInstructions()).toContain('create_design');
  });

  it('creates a design from tiles, saves it and attaches a preview', async () => {
    const result = await call('create_design', { name: 'Pizza Friday', tiles: pizzaTiles, style: 'bold', palette: 'pomidor' });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Created design "pizza-friday"');
    expect(result.text).toContain('id=headline');
    expect(result.text).toContain('palette Pomidor');

    const saved = JSON.parse(await readFile(path.join(root, 'tilecast', 'pizza-friday.tilecast.json'), 'utf8'));
    expect(saved.design.tiles.map((t: { id: string }) => t.id)).toEqual(['brand', 'headline', 'image', 'number', 'info', 'cta']);

    if (chrome) {
      expect(result.image?.data).toBeTruthy();
      const size = pngSize(Buffer.from(result.image!.data!, 'base64'));
      expect(size.width).toBeGreaterThan(size.height);
    } else {
      expect(result.text).toContain('No Chrome');
    }
  }, 60_000);

  it('rearranges and edits tiles', async () => {
    const result = await call('update_design', {
      id: 'pizza-friday',
      preview: false,
      operations: [
        { op: 'swap_tiles', a: 'number', b: 'image' },
        { op: 'set_tile', tile_id: 'headline', text: 'Pizza w piątek', size: 'XL' },
        { op: 'add_tile', kind: 'emoji', text: '🍕', position: 0 },
        { op: 'set_palette', colors: { accent: '#0a66c2' } },
        { op: 'next_layout' },
      ],
    });
    expect(result.isError).toBe(false);
    const saved = JSON.parse(await readFile(path.join(root, 'tilecast', 'pizza-friday.tilecast.json'), 'utf8'));
    expect(saved.design.tiles.map((t: { id: string }) => t.id)).toEqual(['emoji', 'brand', 'headline', 'number', 'image', 'info', 'cta']);
    expect(saved.design.tiles[2]).toMatchObject({ text: 'Pizza w piątek', size: 'XL' });
    expect(saved.design.palette.accent).toBe('#0a66c2');
    expect(saved.design.seed).toBe(1);
  });

  it('rejects bad edits with a helpful message and keeps the design', async () => {
    const before = await readFile(path.join(root, 'tilecast', 'pizza-friday.tilecast.json'), 'utf8');
    const result = await call('update_design', {
      id: 'pizza-friday',
      operations: [
        { op: 'set_tile', tile_id: 'headline', text: 'Nie zapisze się' },
        { op: 'remove_tile', tile_id: 'nope' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No tile "nope"');
    expect(result.text).toContain('headline');
    expect(await readFile(path.join(root, 'tilecast', 'pizza-friday.tilecast.json'), 'utf8')).toBe(before);

    expect((await call('update_design', { id: 'missing', operations: [{ op: 'next_layout' }] })).text).toContain(
      'Existing designs: pizza-friday',
    );
    expect(
      (await call('update_design', { id: 'pizza-friday', operations: [{ op: 'set_tile', tile_id: 'image', image_path: 'notes.txt' }] })).text,
    ).toContain('is not a PNG');
  });

  it('embeds photos from the project', async () => {
    const result = await call('update_design', {
      id: 'pizza-friday',
      preview: false,
      operations: [{ op: 'set_tile', tile_id: 'image', image_path: 'photo.png' }],
    });
    expect(result.text).toContain('(photo)');
    const json = (await call('get_design', { id: 'pizza-friday' })).text;
    expect(json).toContain('KB embedded image');
    expect(json).not.toContain('base64');
  });

  it('gives image tiles their own generated artwork and lets the agent change it', async () => {
    const created = await call('create_design', {
      name: 'art',
      preview: false,
      tiles: [
        { kind: 'headline', text: 'Koncert jazzowy' },
        { kind: 'image' },
        { kind: 'image', art: 'waves', icon: 'none' },
      ],
    });
    expect(created.text).toContain('id=image image size=L tone=accent: (generated art:');
    expect(created.text).toContain('id=image-2 image size=L tone=accent: (generated art: waves, icon none');
    const read = async () => JSON.parse(await readFile(path.join(root, 'tilecast', 'art.tilecast.json'), 'utf8')).design.tiles;
    const [, first, second] = await read();
    expect(first.art.seed).not.toBe(second.art.seed);

    await call('update_design', { id: 'art', preview: false, operations: [{ op: 'shuffle_art', tile_id: 'image' }] });
    const shuffled = await read();
    expect(shuffled[1].art.seed).not.toBe(first.art.seed);
    expect(shuffled[2].art).toEqual(second.art);

    await call('update_design', {
      id: 'art',
      preview: false,
      operations: [{ op: 'set_tile', tile_id: 'image-2', art: 'auto', icon: 'guitar' }],
    });
    const updated = await read();
    expect(updated[2].art).toEqual({ seed: second.art.seed, icon: 'guitar' });

    expect(
      (await call('update_design', { id: 'art', operations: [{ op: 'set_tile', tile_id: 'headline', art: 'waves' }] })).text,
    ).toContain('apply to image tiles');
  });

  it('exports full-size PNGs and standalone HTML', async () => {
    const result = await call('export_design', { id: 'pizza-friday', formats: ['square', 'story'] });
    expect(result.isError).toBe(false);
    const dir = path.join(root, 'tilecast', 'export', 'pizza-friday');
    const html = await readFile(path.join(dir, 'pizza-friday-square.html'), 'utf8');
    expect(html).toContain('Pizza w piątek');
    expect(html).toContain("font-family:'Anton'");
    expect(html).toContain('data-animate');
    if (chrome) {
      const square = await readFile(path.join(dir, 'pizza-friday-square-1080x1080.png'));
      expect(pngSize(square)).toEqual({ width: 1080, height: 1080 });
      const story = await readFile(path.join(dir, 'pizza-friday-story-1080x1920.png'));
      expect(pngSize(story)).toEqual({ width: 1080, height: 1920 });
    }
    expect((await call('export_design', { id: 'pizza-friday', out_dir: '../outside' })).text).toContain('inside the project');
  }, 90_000);

  it('drafts a design from a brief and lists designs', async () => {
    const result = await call('create_design', {
      brief: 'Koncert jazzowy pod gwiazdami. Wstęp wolny! Sobota 20:00. Rezerwuj na jazz.pl',
      preview: false,
    });
    expect(result.text).toContain('Created design "koncert-jazzowy-pod-gwiazdami"');
    expect(result.text).toContain('"Wstęp wolny"');
    const list = (await call('list_designs')).text;
    expect(list).toContain('pizza-friday');
    expect(list).toContain('koncert-jazzowy-pod-gwiazdami');
  });

  it('validates input', async () => {
    expect((await call('create_design', {})).text).toContain('Pass `tiles`');
    expect((await call('create_design', { tiles: pizzaTiles, palette: 'Rainbow', preview: false })).text).toContain(
      'Unknown palette "Rainbow"',
    );
    expect((await call('get_design', { id: '../etc' })).text).toContain('Invalid design id');
  });
});
