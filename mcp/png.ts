import { inflateSync } from 'node:zlib';

/** Reads width and height from a PNG header. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export interface Pixels {
  width: number;
  height: number;
  /** RGB of the pixel at x, y. */
  at(x: number, y: number): [number, number, number];
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG, which is what Chrome writes. */
export function decodePng(png: Buffer): Pixels {
  const { width, height } = pngSize(png);
  const colorType = png[25];
  if (png[24] !== 8 || png[28] !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('Only 8-bit RGB/RGBA PNGs are supported.');
  }
  const channels = colorType === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[row + x - channels] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = x >= channels && y > 0 ? out[prev + x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[row + x] = (line[x] + add) & 0xff;
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const i = Math.min(height - 1, Math.max(0, Math.round(y))) * stride + Math.min(width - 1, Math.max(0, Math.round(x))) * channels;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}
