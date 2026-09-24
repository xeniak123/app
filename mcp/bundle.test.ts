import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { findChrome } from './browser';
import { pngSize } from './png';

// The plugin ships this prebuilt file; `npm run build:mcp` regenerates it.
const bundle = path.resolve('plugin/server/tilecast-mcp.mjs');

const composition = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="tilecast:formats" content="square">
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #fff4e0; }
  h1 { font: 800 12vmin/0.95 'Fraunces', serif; color: #3b1f0e; margin: 10vmin; }
</style></head>
<body><h1>Zażółć gęślą jaźń</h1></body></html>`;

describe.skipIf(!existsSync(bundle))('bundled MCP server', () => {
  it('serves the tools over stdio and renders with its own fonts', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'tilecast-bundle-'));
    await writeFile(path.join(project, 'poster.html'), composition);
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
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['preview', 'check', 'render_image', 'render_video', 'assets', 'guide']);
      for (const topic of ['workflow', 'design', 'motion', 'tones', 'audio', 'runtime']) {
        const guide = (await client.callTool({ name: 'guide', arguments: { topic } })) as { isError?: boolean; content: { text: string }[] };
        expect(guide.isError, topic).toBeFalsy();
        expect(guide.content[0].text.length, topic).toBeGreaterThan(500);
      }
      if (findChrome()) {
        const checked = (await client.callTool({ name: 'check', arguments: { file: 'poster.html' } })) as { content: { text: string }[] };
        expect(checked.content[0].text).toContain('fonts: Fraunces');
        expect(checked.content[0].text).toContain('PASS');
        await client.callTool({ name: 'render_image', arguments: { file: 'poster.html' } });
        const png = await readFile(path.join(project, 'export/poster-square.png'));
        expect(pngSize(png)).toEqual({ width: 1080, height: 1080 });
      }
    } finally {
      await client.close();
      await rm(project, { recursive: true, force: true });
    }
  }, 60_000);
});
