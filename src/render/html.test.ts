import { describe, expect, it } from 'vitest';
import { FORMATS, getFormat } from '../model/formats';
import type { Design } from '../model/types';
import { formatDocument, sheetDocument } from './html';

const design: Design = {
  style: 'elegant',
  seed: 0,
  palette: { bg: '#14213d', surface: '#1f3057', ink: '#f7f3e8', accent: '#e9b949', accentInk: '#14213d' },
  tiles: [
    { id: 'headline', kind: 'headline', text: 'Wieczór <script>alert(1)</script> & wino', size: 'L', tone: 'clear' },
    { id: 'image', kind: 'image', text: '', size: 'L', tone: 'accent' },
    { id: 'cta', kind: 'cta', text: 'Rezerwuj "teraz"', size: 'S', tone: 'ink' },
  ],
};

describe('formatDocument', () => {
  it('renders a standalone page at the export size', () => {
    const html = formatDocument(design, getFormat('square'));
    expect(html).toContain('width:1080px;height:1080px');
    expect(html.match(/class="tile /g)).toHaveLength(3);
    expect(html).toContain('data-fit=');
    expect(html).toContain('var fit=');
  });

  it('escapes user text', () => {
    const html = formatDocument(design, getFormat('square'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Wieczór &lt;script&gt;alert(1)&lt;/script&gt; &amp; wino');
    expect(html).toContain('Rezerwuj &quot;teraz&quot;');
  });

  it('inlines only the fonts the style uses, with Polish characters covered', () => {
    const html = formatDocument(design, getFormat('poster'));
    expect(html).toContain("font-family:'Playfair Display'");
    expect(html).toContain("font-family:'Inter'");
    expect(html).not.toContain("font-family:'Anton'");
    expect(html).toContain('U+0100-02BA');
    expect(html).toContain('data:font/woff2;base64,');
  });

  it('adds animation and window fitting on request', () => {
    const html = formatDocument(design, getFormat('story'), { animate: true, fitWindow: true });
    expect(html).toContain('<body data-animate data-fit-window>');
  });
});

describe('sheetDocument', () => {
  it('lays all formats side by side at one height', () => {
    const sheet = sheetDocument(design, 400);
    expect(sheet.html.match(/class="canvas"/g)).toHaveLength(FORMATS.length);
    expect(sheet.height).toBe(400 + 36 * 2 + 40);
    expect(sheet.width).toBeGreaterThan(1500);
  });
});
