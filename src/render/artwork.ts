import { contrast, mix, readable } from '../model/color';
import type { ArtMotif, Palette, StyleId } from '../model/types';
import { ICONS } from './icons';

/**
 * Generative artwork for image tiles without a photo. Every tile carries its
 * own random seed, so each design gets a different picture: the motif, shapes,
 * composition and colors all vary, drawn from the design's palette. The same
 * seed is recomposed for each format's proportions, so a campaign stays
 * consistent across poster, post, story and banner.
 */

export const MOTIF_POOLS: Record<StyleId, ArtMotif[]> = {
  bold: ['bauhaus', 'stripes', 'sunburst', 'halftone', 'waves', 'arches', 'blobs'],
  elegant: ['arches', 'rings', 'mesh', 'landscape', 'waves', 'grid'],
  playful: ['blobs', 'confetti', 'waves', 'arches', 'bauhaus', 'sunburst'],
  minimal: ['grid', 'rings', 'mesh', 'halftone', 'bauhaus', 'landscape', 'stripes'],
};

export interface ArtInput {
  style: StyleId;
  palette: Palette;
  /** Tile background and a color that reads well on it. */
  base: string;
  ink: string;
  /** Width / height of the tile being painted. */
  aspect: number;
  seed: number;
  motif?: ArtMotif;
  /** Icon name, or null for none. */
  icon?: string | null;
}

interface Colors {
  base: string;
  soft: string;
  mid: string;
  deep: string;
  pop: string;
  light: string;
}

type Random = () => number;

function random(seed: number): Random {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (value: number) => Math.round(value * 10) / 10;

export function pickMotif(style: StyleId, seed: number, motif?: ArtMotif): ArtMotif {
  if (motif) return motif;
  const pool = MOTIF_POOLS[style];
  return pool[Math.abs(seed) % pool.length];
}

function colorsFor({ base, ink, palette }: ArtInput): Colors {
  // A second color from the palette keeps the art lively without leaving the brand.
  const candidates = [palette.accent, palette.bg, palette.surface, palette.accentInk, palette.ink];
  const pop = candidates.find((c) => contrast(c, base) > 1.35 && contrast(c, ink) > 1.35) ?? mix(base, ink, 0.45);
  return {
    base,
    soft: mix(base, ink, 0.1),
    mid: mix(base, ink, 0.26),
    deep: mix(base, ink, 0.62),
    pop,
    light: mix(pop, base, 0.45),
  };
}

/** Smooth closed path through points (Catmull-Rom converted to cubic Béziers). */
function smoothClosed(points: [number, number][]): string {
  const count = points.length;
  let d = `M${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 0; i < count; i++) {
    const [p0, p1, p2, p3] = [points[(i - 1 + count) % count], points[i], points[(i + 1) % count], points[(i + 2) % count]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

function shuffle<T>(items: T[], r: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type Painter = (w: number, h: number, c: Colors, r: Random, style: StyleId) => string;

const MOTIFS: Record<ArtMotif, Painter> = {
  sunburst(w, h, c, r) {
    const cx = w * [0.5, 0.25, 0.75][Math.floor(r() * 3)];
    const cy = r() < 0.6 ? h * 1.02 : h * -0.02;
    const rays = 10 + Math.floor(r() * 12);
    const reach = Math.hypot(w, h) * 1.4;
    const turn = r() * Math.PI;
    let out = '';
    for (let i = 0; i < rays; i += 2) {
      const a0 = turn + (i / rays) * Math.PI * 2;
      const a1 = turn + ((i + 1) / rays) * Math.PI * 2;
      out += `<path d="M${n(cx)} ${n(cy)}L${n(cx + Math.cos(a0) * reach)} ${n(cy + Math.sin(a0) * reach)}L${n(cx + Math.cos(a1) * reach)} ${n(cy + Math.sin(a1) * reach)}Z" fill="${c.soft}"/>`;
    }
    const sun = Math.min(w, h) * (0.2 + r() * 0.12);
    out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(sun * 1.35)}" fill="${c.light}"/>`;
    out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(sun)}" fill="${c.pop}"/>`;
    return out;
  },

  waves(w, h, c, r, style) {
    const bands = 4 + Math.floor(r() * 4);
    const colors = shuffle([c.soft, c.mid, c.pop, c.deep, c.light], r);
    const thin = style === 'elegant';
    let out = '';
    for (let k = 0; k < bands; k++) {
      const y0 = h * (0.12 + (k / bands) * 0.88);
      const amp = h * (0.03 + r() * 0.06);
      const freq = ((1 + r() * 2.5) * Math.PI * 2) / w;
      const phase = r() * Math.PI * 2;
      let d = `M0 ${n(y0)}`;
      for (let x = 0; x <= w + 1; x += w / 32) d += ` L${n(x)} ${n(y0 + Math.sin(x * freq + phase) * amp)}`;
      out += thin
        ? `<path d="${d}" fill="none" stroke="${c.deep}" stroke-width="${n(Math.min(w, h) * 0.006)}"/>`
        : `<path d="${d} L${n(w)} ${n(h)} L0 ${n(h)}Z" fill="${colors[k % colors.length]}"/>`;
    }
    return out;
  },

  blobs(w, h, c, r) {
    const colors = shuffle([c.soft, c.mid, c.pop, c.light], r);
    let out = '';
    const count = 3 + Math.floor(r() * 2);
    for (let b = 0; b < count; b++) {
      const cx = w * (0.15 + r() * 0.7);
      const cy = h * (0.15 + r() * 0.7);
      const radius = Math.min(w, h) * (0.22 + r() * 0.2);
      const points: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const rr = radius * (0.72 + r() * 0.5);
        points.push([cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr]);
      }
      out += `<path d="${smoothClosed(points)}" fill="${colors[b % colors.length]}"/>`;
    }
    for (let i = 0; i < 9; i++) {
      out += `<circle cx="${n(r() * w)}" cy="${n(r() * h)}" r="${n(Math.min(w, h) * (0.01 + r() * 0.02))}" fill="${c.deep}"/>`;
    }
    return out;
  },

  bauhaus(w, h, c, r) {
    const cols = w / h > 1.3 ? 3 : 2;
    const rows = Math.max(1, Math.min(4, Math.round((cols * h) / w)));
    const cw = w / cols;
    const ch = h / rows;
    const fills = [c.base, c.soft, c.pop, c.deep, c.mid];
    let out = '';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * cw;
        const y = row * ch;
        const bg = fills[Math.floor(r() * fills.length)];
        const choices = fills.filter((f) => f !== bg);
        const fg = choices[Math.floor(r() * choices.length)];
        const m = Math.min(cw, ch);
        let cell = `<rect x="${n(x)}" y="${n(y)}" width="${n(cw)}" height="${n(ch)}" fill="${bg}"/>`;
        const shape = Math.floor(r() * 5);
        if (shape === 0) {
          const corner = Math.floor(r() * 4);
          const px = corner % 2 ? x + cw : x;
          const py = corner > 1 ? y + ch : y;
          cell += `<circle cx="${n(px)}" cy="${n(py)}" r="${n(m)}" fill="${fg}"/>`;
        } else if (shape === 1) {
          cell += `<circle cx="${n(x + cw / 2)}" cy="${n(y + ch / 2)}" r="${n(m * 0.38)}" fill="${fg}"/>`;
        } else if (shape === 2) {
          cell += `<path d="M${n(x)} ${n(y + ch)} A${n(cw / 2)} ${n(cw / 2)} 0 0 1 ${n(x + cw)} ${n(y + ch)}Z" fill="${fg}"/>`;
        } else if (shape === 3) {
          cell += `<path d="M${n(x)} ${n(y + ch)} L${n(x + cw / 2)} ${n(y + ch * 0.12)} L${n(x + cw)} ${n(y + ch)}Z" fill="${fg}"/>`;
        } else {
          for (let s = 0; s < 3; s++) {
            cell += `<rect x="${n(x + cw * 0.12)}" y="${n(y + ch * (0.2 + s * 0.24))}" width="${n(cw * 0.76)}" height="${n(ch * 0.1)}" fill="${fg}"/>`;
          }
        }
        // Each cell is clipped so shapes never spill into their neighbours.
        const id = `b${row}-${col}`;
        out += `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(cw + 0.5)}" height="${n(ch + 0.5)}"/></clipPath><g clip-path="url(#${id})">${cell}</g>`;
      }
    }
    return out;
  },

  halftone(w, h, c, r) {
    const step = Math.min(w, h) / (11 + Math.floor(r() * 6));
    const angle = r() * Math.PI * 2;
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const big = Math.min(w, h) * (0.3 + r() * 0.15);
    let out = `<circle cx="${n(w * (0.25 + r() * 0.5))}" cy="${n(h * (0.25 + r() * 0.5))}" r="${n(big)}" fill="${c.pop}"/>`;
    const span = Math.abs(dx) * w + Math.abs(dy) * h;
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        const t = ((x - w / 2) * dx + (y - h / 2) * dy) / span + 0.5;
        const radius = (step / 2) * Math.max(0, Math.min(1, t)) * 0.95;
        if (radius > 0.4) out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="${c.deep}"/>`;
      }
    }
    return out;
  },

  stripes(w, h, c, r) {
    const angle = [-35, -20, 20, 35, 55][Math.floor(r() * 5)];
    const size = Math.hypot(w, h);
    const colors = shuffle([c.soft, c.mid, c.pop, c.deep], r);
    let out = '';
    let y = -size / 2;
    let i = 0;
    while (y < size / 2) {
      const band = size * (0.03 + r() * 0.07);
      if (i % 2 === 0) {
        out += `<rect x="${n(-size / 2)}" y="${n(y)}" width="${n(size)}" height="${n(band)}" fill="${colors[(i / 2) % colors.length]}"/>`;
      }
      y += band;
      i++;
    }
    return `<g transform="translate(${n(w / 2)} ${n(h / 2)}) rotate(${angle})">${out}</g>`;
  },

  rings(w, h, c, r, style) {
    const cx = w * (0.3 + r() * 0.4);
    const cy = h * (0.3 + r() * 0.4);
    const count = 6 + Math.floor(r() * 6);
    const gap = Math.max(w, h) / count / 1.4;
    const stroke = style === 'elegant' ? Math.min(w, h) * 0.005 : gap * (0.18 + r() * 0.25);
    let out = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(gap * 1.1)}" fill="${c.pop}"/>`;
    for (let i = 2; i <= count + 2; i++) {
      out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(gap * i)}" fill="none" stroke="${i % 3 === 0 ? c.deep : c.mid}" stroke-width="${n(stroke)}"/>`;
    }
    return out;
  },

  arches(w, h, c, r, style) {
    const cx = w * [0.5, 0.3, 0.7][Math.floor(r() * 3)];
    const outer = Math.min(w * 0.62, h * 0.9);
    const bands = 4 + Math.floor(r() * 3);
    const width = outer / (bands + 1);
    const colors = shuffle([c.pop, c.deep, c.mid, c.light, c.soft], r);
    let out = '';
    for (let i = 0; i < bands; i++) {
      const radius = outer - i * width;
      const d = `M${n(cx - radius)} ${n(h)} V${n(h - radius * 0.35)} A${n(radius)} ${n(radius)} 0 0 1 ${n(cx + radius)} ${n(h - radius * 0.35)} V${n(h)}Z`;
      out +=
        style === 'elegant'
          ? `<path d="${d}" fill="none" stroke="${c.deep}" stroke-width="${n(Math.min(w, h) * 0.005)}"/>`
          : `<path d="${d}" fill="${colors[i % colors.length]}"/>`;
    }
    const sun = width * (0.8 + r() * 0.6);
    out += `<circle cx="${n(w * (0.15 + r() * 0.7))}" cy="${n(h * (0.12 + r() * 0.2))}" r="${n(sun)}" fill="${c.pop}"/>`;
    return out;
  },

  mesh(w, h, c, r) {
    const colors = [c.pop, c.deep, c.light, c.mid];
    let defs = '';
    let out = '';
    for (let i = 0; i < 4; i++) {
      defs += `<radialGradient id="m${i}"><stop offset="0" stop-color="${colors[i]}" stop-opacity="0.95"/><stop offset="1" stop-color="${colors[i]}" stop-opacity="0"/></radialGradient>`;
      const radius = Math.max(w, h) * (0.45 + r() * 0.35);
      out += `<circle cx="${n(r() * w)}" cy="${n(r() * h)}" r="${n(radius)}" fill="url(#m${i})"/>`;
    }
    return `<defs>${defs}</defs>${out}`;
  },

  confetti(w, h, c, r) {
    const colors = [c.pop, c.deep, c.mid, c.light];
    const unit = Math.min(w, h);
    let out = '';
    const count = 34 + Math.floor(r() * 24);
    for (let i = 0; i < count; i++) {
      const x = r() * w;
      const y = r() * h;
      const s = unit * (0.025 + r() * 0.035);
      const color = colors[Math.floor(r() * colors.length)];
      const rot = Math.floor(r() * 360);
      const shape = Math.floor(r() * 4);
      const t = `transform="translate(${n(x)} ${n(y)}) rotate(${rot})"`;
      if (shape === 0) out += `<circle ${t} r="${n(s / 2)}" fill="${color}"/>`;
      else if (shape === 1) out += `<rect ${t} x="${n(-s / 2)}" y="${n(-s / 5)}" width="${n(s)}" height="${n(s / 2.5)}" rx="${n(s / 6)}" fill="${color}"/>`;
      else if (shape === 2) out += `<path ${t} d="M0 ${n(-s / 2)} L${n(s / 2)} ${n(s / 2)} L${n(-s / 2)} ${n(s / 2)}Z" fill="${color}"/>`;
      else {
        out += `<path ${t} d="M${n(-s)} 0 q${n(s / 2)} ${n(-s / 2)} ${n(s)} 0 t${n(s)} 0" fill="none" stroke="${color}" stroke-width="${n(s / 3)}" stroke-linecap="round"/>`;
      }
    }
    return out;
  },

  landscape(w, h, c, r) {
    const layers = 3 + Math.floor(r() * 2);
    const colors = [c.soft, c.mid, c.deep, c.pop].slice(0, layers);
    const sun = Math.min(w, h) * (0.1 + r() * 0.08);
    let out = `<circle cx="${n(w * (0.2 + r() * 0.6))}" cy="${n(h * (0.18 + r() * 0.15))}" r="${n(sun)}" fill="${c.pop}"/>`;
    for (let k = 0; k < layers; k++) {
      const base = h * (0.45 + (k / layers) * 0.4);
      const peaks = 2 + Math.floor(r() * 3);
      const points: string[] = [`M0 ${n(h)}`, `L0 ${n(base)}`];
      for (let i = 0; i <= peaks * 2; i++) {
        const x = (i / (peaks * 2)) * w;
        const y = base - (i % 2 ? h * (0.06 + r() * 0.16) : h * r() * 0.04);
        points.push(`L${n(x)} ${n(y)}`);
      }
      points.push(`L${n(w)} ${n(h)}Z`);
      out += `<path d="${points.join(' ')}" fill="${colors[k]}" stroke="${colors[k]}" stroke-linejoin="round" stroke-width="${n(Math.min(w, h) * 0.04)}"/>`;
    }
    return out;
  },

  grid(w, h, c, r) {
    const step = Math.min(w, h) / (5 + Math.floor(r() * 4));
    const line = Math.min(w, h) * 0.004;
    let out = '';
    const cols = Math.ceil(w / step);
    const rows = Math.ceil(h / step);
    const fx = Math.floor(r() * Math.max(1, cols - 2));
    const fy = Math.floor(r() * Math.max(1, rows - 2));
    out += `<circle cx="${n((fx + 1) * step)}" cy="${n((fy + 1) * step)}" r="${n(step)}" fill="${c.pop}"/>`;
    out += `<rect x="${n(((fx + 2) % cols) * step)}" y="${n(((fy + 3) % rows) * step)}" width="${n(step)}" height="${n(step)}" fill="${c.deep}"/>`;
    for (let x = step; x < w; x += step) out += `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(h)}" stroke="${c.mid}" stroke-width="${n(line)}"/>`;
    for (let y = step; y < h; y += step) out += `<line x1="0" y1="${n(y)}" x2="${n(w)}" y2="${n(y)}" stroke="${c.mid}" stroke-width="${n(line)}"/>`;
    return out;
  },
};

function iconMarkup(name: string, w: number, h: number, c: Colors, style: StyleId): string {
  const paths = ICONS[name];
  if (!paths) return '';
  const size = Math.min(w, h) * 0.34;
  const cx = w / 2;
  const cy = h / 2;
  const scale = size / 24;
  const quiet = style === 'elegant' || style === 'minimal';
  // A plate behind the icon keeps it legible on any motif.
  const plate = quiet ? c.base : c.pop === c.base ? c.light : c.pop;
  const strokeColor = readable(quiet ? c.deep : c.base, plate, 3);
  const strokeWidth = { bold: 2.1, playful: 1.9, elegant: 1.1, minimal: 1.4 }[style];
  const ring = quiet
    ? `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(size * 0.82)}" fill="none" stroke="${c.deep}" stroke-width="${n(scale * 0.6)}"/>`
    : '';
  return (
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(size * 0.82)}" fill="${plate}"/>${ring}` +
    `<g transform="translate(${n(cx - size / 2)} ${n(cy - size / 2)}) scale(${n(scale * 100) / 100})" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
  );
}

export function artworkSvg(input: ArtInput): string {
  const aspect = Math.min(Math.max(input.aspect || 1, 0.2), 5);
  const w = 600 * Math.sqrt(aspect);
  const h = 600 / Math.sqrt(aspect);
  const colors = colorsFor(input);
  const motif = pickMotif(input.style, input.seed, input.motif);
  // The motif gets its own stream so the same seed gives the same composition in every format.
  const body = MOTIFS[motif](w, h, colors, random(input.seed * 31 + motif.length), input.style);
  const icon = input.icon ? iconMarkup(input.icon, w, h, colors, input.style) : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="${n(w)}" height="${n(h)}" fill="${colors.base}"/>${body}${icon}</svg>`
  );
}

export function artworkUrl(input: ArtInput): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(artworkSvg(input))}")`;
}
