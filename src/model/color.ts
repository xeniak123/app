const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

/** Normalizes `#abc` / `aabbcc` to `#aabbcc`, or returns null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  let hex = value.trim().replace('#', '').toLowerCase();
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return `#${hex}`;
}

function channels(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Returns `preferred` if it reads well on `background`; otherwise near-black or
 * near-white, whichever contrasts more. Protects the design from low-contrast
 * palettes, including ones chosen by the AI.
 */
export function readable(preferred: string, background: string, minRatio = 4.5): string {
  if (contrast(preferred, background) >= minRatio) return preferred;
  const dark = '#111111';
  const light = '#ffffff';
  return contrast(dark, background) >= contrast(light, background) ? dark : light;
}

/** Linear mix of two colors; `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  const out = ca.map((c, i) => Math.round(c + (cb[i] - c) * t));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
