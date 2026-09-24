import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { findChrome, pngSize } from './chrome';

// The plugin ships this prebuilt file; `npm run build:mcp` regenerates it.
const bundle = path.resolve('plugin/server/tilecast-mcp.mjs');

describe.skipIf(!existsSync(bundle))('bundled MCP server', () => {
  it('serves tools over stdio and renders with inlined fonts', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'tilecast-bundle-'));
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundle],
      cwd: project,
      env: { ...env, CLAUDE_PROJECT_DIR: project },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'bundle-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(6);

      const created = (await client.callTool({
        name: 'create_design',
        arguments: {
          name: 'bundle',
          preview: false,
          style: 'playful',
          tiles: [
            { kind: 'headline', text: 'Zażółć gęślą jaźń' },
            { kind: 'image' },
            { kind: 'cta', text: 'Sprawdź →' },
          ],
        },
      })) as { content: { type: string; text?: string }[] };
      expect(created.content[0].text).toContain('Created design "bundle"');

      await client.callTool({ name: 'export_design', arguments: { id: 'bundle', formats: ['square'] } });
      const html = await readFile(path.join(project, 'tilecast/export/bundle/bundle-square.html'), 'utf8');
      expect(html).toContain("font-family:'Fredoka'");
      expect(html).toContain('Zażółć gęślą jaźń');
      if (findChrome()) {
        const png = await readFile(path.join(project, 'tilecast/export/bundle/bundle-square-1080x1080.png'));
        expect(pngSize(png)).toEqual({ width: 1080, height: 1080 });
      }
    } finally {
      await client.close();
      await rm(project, { recursive: true, force: true });
    }
  }, 60_000);
});
