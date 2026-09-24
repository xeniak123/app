import { KINDS, SIZE_WEIGHT } from './kinds';
import type { Rect, Tile } from './types';

/**
 * Bento layout engine.
 *
 * The canvas is cut recursively into two parts, like a treemap, so tiles always
 * fill it completely with no holes. Each part gets an area proportional to the
 * weight (size) of its tiles, and tile order is preserved, so the first tile
 * lands top-left. A dynamic program tries every cut and direction and picks
 * the tree where every tile gets a shape it likes (headlines wide, photos
 * roughly square, buttons flat). The same tiles therefore produce a good
 * layout for any canvas: A4 poster, square post, story or banner.
 */

export interface LayoutOptions {
  width: number;
  height: number;
  /** Outer margin, as a fraction of the canvas' shorter side. */
  padding: number;
  /** Space between tiles, as a fraction of the canvas' shorter side. */
  gap: number;
  /** 0 gives the canonical best layout; other values give alternative variants. */
  seed: number;
}

interface Item {
  id: string;
  weight: number;
  lo: number;
  hi: number;
  strictness: number;
  minSide: number;
}

type LayoutNode =
  | { leaf: number }
  | { i: number; j: number; k: number; row: boolean; a: LayoutNode; b: LayoutNode };

interface Solution {
  cost: number;
  node: LayoutNode;
}

/** Subproblems whose aspect ratios differ by less than this (in log space) share a solution. */
const ASPECT_STEP = 0.08;
const VARIANT_NOISE = 0.45;
const VARIANT_ASPECT_JITTER = 0.9;

export function layoutTiles(tiles: Tile[], options: LayoutOptions): Record<string, Rect> {
  const { width, height, seed } = options;
  const result: Record<string, Rect> = {};
  if (tiles.length === 0 || width <= 0 || height <= 0) return result;

  const shorter = Math.min(width, height);
  const pad = options.padding * shorter;
  const gap = options.gap * shorter;

  const items: Item[] = tiles.map((tile) => {
    const spec = KINDS[tile.kind];
    const jitter = seed === 0 ? 1 : Math.exp((hash(seed, hashString(tile.id)) - 0.5) * VARIANT_ASPECT_JITTER);
    return {
      id: tile.id,
      weight: SIZE_WEIGHT[tile.size],
      lo: spec.aspect[0] * jitter,
      hi: spec.aspect[1] * jitter,
      strictness: spec.strictness,
      minSide: spec.minSide,
    };
  });

  const prefix = [0];
  for (const item of items) prefix.push(prefix[prefix.length - 1] + item.weight);
  const weightOf = (i: number, j: number) => prefix[j + 1] - prefix[i];

  const memo = new Map<string, Solution>();

  const leafCost = (item: Item, w: number, h: number): number => {
    const tw = Math.max(w - gap, 1e-6);
    const th = Math.max(h - gap, 1e-6);
    const aspect = tw / th;
    let cost = 0;
    if (aspect < item.lo) cost = Math.log(item.lo / aspect) ** 2;
    else if (aspect > item.hi) cost = Math.log(aspect / item.hi) ** 2;
    cost *= item.strictness;
    const side = Math.min(tw, th) / shorter;
    if (side < item.minSide) cost += 4 * ((item.minSide - side) / item.minSide) ** 2;
    return cost;
  };

  const solve = (i: number, j: number, w: number, h: number): Solution => {
    const key = `${i}:${j}:${Math.round(Math.log(w / h) / ASPECT_STEP)}`;
    const cached = memo.get(key);
    if (cached) return cached;

    let best: Solution;
    if (i === j) {
      best = { cost: leafCost(items[i], w, h), node: { leaf: i } };
    } else {
      best = { cost: Infinity, node: { leaf: i } };
      const total = weightOf(i, j);
      for (let k = i; k < j; k++) {
        const f = weightOf(i, k) / total;
        for (const row of [true, false]) {
          const a = row ? solve(i, k, w * f, h) : solve(i, k, w, h * f);
          const b = row ? solve(k + 1, j, w * (1 - f), h) : solve(k + 1, j, w, h * (1 - f));
          const noise = seed === 0 ? 0 : (hash(seed, i, j, k, row ? 1 : 2) - 0.5) * VARIANT_NOISE;
          const cost = a.cost + b.cost + noise;
          if (cost < best.cost) best = { cost, node: { i, j, k, row, a: a.node, b: b.node } };
        }
      }
    }
    memo.set(key, best);
    return best;
  };

  // Lay out on an area grown by half a gap on every side, then shrink each tile
  // by half a gap: tiles end up `gap` apart and `pad` away from the edges.
  const x0 = pad - gap / 2;
  const y0 = pad - gap / 2;
  const innerW = width - 2 * pad + gap;
  const innerH = height - 2 * pad + gap;
  const { node } = solve(0, items.length - 1, innerW, innerH);

  const place = (n: LayoutNode, x: number, y: number, w: number, h: number) => {
    if ('leaf' in n) {
      result[items[n.leaf].id] = {
        x: (x + gap / 2) / width,
        y: (y + gap / 2) / height,
        w: Math.max(w - gap, 0) / width,
        h: Math.max(h - gap, 0) / height,
      };
      return;
    }
    const f = weightOf(n.i, n.k) / weightOf(n.i, n.j);
    if (n.row) {
      place(n.a, x, y, w * f, h);
      place(n.b, x + w * f, y, w * (1 - f), h);
    } else {
      place(n.a, x, y, w, h * f);
      place(n.b, x, y + h * f, w, h * (1 - f));
    }
  };
  place(node, x0, y0, innerW, innerH);
  return result;
}

function hash(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const value of values) {
    h ^= value | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
