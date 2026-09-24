import { describe, expect, it } from 'vitest';
import { contrast, readable } from './color';
import { sanitizeDesign } from './sanitize';

describe('sanitizeDesign', () => {
  it('repairs sloppy input', () => {
    const design = sanitizeDesign({
      style: 'fancy',
      seed: -3,
      palette: { bg: 'fff', surface: 'nope', ink: '#000', accent: '#E4572E', accentInk: 12 },
      tiles: [
        { kind: 'headline', text: '  Hej  ', size: 'huge', tone: 'rainbow' },
        { kind: 'unknown', text: 'x' },
        { kind: 'text', text: '' },
        { kind: 'image', image: 'data:image/png;base64,AAAA")' },
        { id: 'a', kind: 'cta', text: 'Kup' },
        { id: 'a', kind: 'info', text: 'Duplikat id' },
      ],
    });
    expect(design).not.toBeNull();
    expect(design!.style).toBe('bold');
    expect(design!.seed).toBe(0);
    expect(design!.palette.bg).toBe('#ffffff');
    expect(design!.palette.ink).toBe('#000000');
    expect(design!.palette.surface).toMatch(/^#[0-9a-f]{6}$/);
    expect(design!.tiles.map((t) => t.kind)).toEqual(['headline', 'image', 'cta', 'info']);
    expect(design!.tiles[0]).toMatchObject({ text: 'Hej', size: 'L', tone: 'clear' });
    expect(design!.tiles[1].image).toBeUndefined();
    expect(new Set(design!.tiles.map((t) => t.id)).size).toBe(4);
  });

  it('rejects input without usable tiles', () => {
    expect(sanitizeDesign(null)).toBeNull();
    expect(sanitizeDesign({ tiles: [] })).toBeNull();
    expect(sanitizeDesign({ tiles: [{ kind: 'text', text: '' }] })).toBeNull();
  });
});

describe('readable', () => {
  it('keeps good contrast and fixes bad contrast', () => {
    expect(readable('#000000', '#ffffff')).toBe('#000000');
    const fixed = readable('#eeeeee', '#ffffff');
    expect(contrast(fixed, '#ffffff')).toBeGreaterThan(4.5);
    const onDark = readable('#222222', '#111111');
    expect(contrast(onDark, '#111111')).toBeGreaterThan(4.5);
  });
});
