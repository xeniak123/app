import { describe, expect, it } from 'vitest';
import { FORMATS } from './formats';
import { layoutTiles } from './layout';
import type { Rect, Tile, TileKind, TileSize } from './types';

const tile = (id: string, kind: TileKind, size: TileSize = 'M'): Tile => ({
  id,
  kind,
  text: id,
  size,
  tone: 'surface',
});

const sample: Tile[] = [
  tile('brand', 'brand', 'S'),
  tile('headline', 'headline', 'L'),
  tile('image', 'image', 'L'),
  tile('number', 'number', 'M'),
  tile('text', 'text', 'M'),
  tile('info', 'info', 'S'),
  tile('emoji', 'emoji', 'S'),
  tile('cta', 'cta', 'S'),
];

const options = { padding: 0.04, gap: 0.02, seed: 0 };

function overlaps(a: Rect, b: Rect): boolean {
  const eps = 1e-9;
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

describe('layoutTiles', () => {
  for (const format of FORMATS) {
    it(`fills the ${format.id} canvas without overlaps or holes`, () => {
      const rects = layoutTiles(sample, { width: format.width, height: format.height, ...options });
      const list = sample.map((t) => rects[t.id]);
      expect(list.every(Boolean)).toBe(true);

      const shorter = Math.min(format.width, format.height);
      const padX = (options.padding * shorter) / format.width;
      const padY = (options.padding * shorter) / format.height;
      const gapX = (options.gap * shorter) / format.width;
      const gapY = (options.gap * shorter) / format.height;

      for (const r of list) {
        expect(r.x).toBeGreaterThanOrEqual(padX - 1e-9);
        expect(r.y).toBeGreaterThanOrEqual(padY - 1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(1 - padX + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 - padY + 1e-9);
      }
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i], list[j])).toBe(false);
      }
      // Growing every tile back by half a gap must tile the inner area exactly.
      const covered = list.reduce((sum, r) => sum + (r.w + gapX) * (r.h + gapY), 0);
      const inner = (1 - 2 * padX + gapX) * (1 - 2 * padY + gapY);
      expect(covered).toBeCloseTo(inner, 6);
    });
  }

  it('keeps the first tile in the top-left corner', () => {
    for (const format of FORMATS) {
      const rects = layoutTiles(sample, { width: format.width, height: format.height, ...options });
      const first = rects.brand;
      for (const t of sample) {
        expect(first.x).toBeLessThanOrEqual(rects[t.id].x + 1e-9);
        expect(first.y).toBeLessThanOrEqual(rects[t.id].y + 1e-9);
      }
    }
  });

  it('gives bigger tiles more area', () => {
    const rects = layoutTiles(sample, { width: 1080, height: 1080, ...options });
    const area = (id: string) => rects[id].w * rects[id].h;
    expect(area('headline')).toBeGreaterThan(area('cta'));
    expect(area('image')).toBeGreaterThan(area('emoji'));
  });

  it('shapes tiles to their content', () => {
    const rects = layoutTiles(sample, { width: 1920, height: 1080, ...options });
    const aspect = (id: string) => (rects[id].w * 1920) / (rects[id].h * 1080);
    expect(aspect('headline')).toBeGreaterThan(1);
    expect(aspect('cta')).toBeGreaterThan(1.5);
  });

  it('is deterministic and offers different variants per seed', () => {
    const a = layoutTiles(sample, { width: 1080, height: 1920, ...options });
    const b = layoutTiles(sample, { width: 1080, height: 1920, ...options });
    expect(a).toEqual(b);
    const variants = [1, 2, 3, 4, 5].map((seed) =>
      JSON.stringify(layoutTiles(sample, { width: 1080, height: 1920, ...options, seed })),
    );
    expect(variants.some((v) => v !== JSON.stringify(a))).toBe(true);
  });

  it('handles edge cases', () => {
    expect(layoutTiles([], { width: 100, height: 100, ...options })).toEqual({});
    const single = layoutTiles([tile('only', 'headline')], { width: 1000, height: 500, ...options });
    expect(single.only.w).toBeGreaterThan(0.9);
  });

  it('is fast enough to run on every drag', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tile(`t${i}`, (['headline', 'text', 'image', 'number', 'cta', 'info'] as const)[i % 6], i % 3 ? 'M' : 'L'),
    );
    const start = performance.now();
    for (const format of FORMATS) layoutTiles(many, { width: format.width, height: format.height, ...options });
    expect(performance.now() - start).toBeLessThan(400);
  });
});
