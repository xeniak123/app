import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findChrome, pngSize, screenshotHtml } from './chrome';

/** Decodes an 8-bit, non-interlaced RGB/RGBA PNG (what Chrome writes) into rows of pixels. */
function decodePng(png: Buffer) {
  const { width, height } = pngSize(png);
  const channels = png[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (line[x] + add) & 0xff;
    }
    rows.push(line);
    previous = line;
  }
  return (x: number, y: number) => [...rows[y].subarray(x * channels, x * channels + 3)];
}

const chrome = findChrome();

describe.skipIf(!chrome)('screenshotHtml', () => {
  it('captures exactly the requested size, down to the last row', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tilecast-shot-'));
    try {
      const out = path.join(dir, 'shot.png');
      const html = `<!doctype html><body style="margin:0">
        <div style="height:480px;background:#ff0000"></div><div style="height:20px;background:#00ff00"></div>
        <script>document.fonts.ready.then(() => document.documentElement.setAttribute('data-ready', '1'))</script></body>`;
      await screenshotHtml(chrome!, html, 300, 500, out);
      const png = await readFile(out);
      expect(pngSize(png)).toEqual({ width: 300, height: 500 });
      const pixel = decodePng(png);
      expect(pixel(10, 10)).toEqual([255, 0, 0]);
      expect(pixel(299, 499)).toEqual([0, 255, 0]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
