import { describe, expect, it } from 'vitest';
import { makeTile } from '../model/offline';
import { PALETTES } from '../model/themes';
import { ART_MOTIFS, STYLE_IDS } from '../model/types';
import { artworkSvg, pickMotif, type ArtInput } from './artwork';
import { ICON_NAMES, ICONS, topicIcon } from './icons';

const palette = PALETTES[0];
const input = (overrides: Partial<ArtInput> = {}): ArtInput => ({
  style: 'bold',
  palette,
  base: palette.accent,
  ink: '#ffffff',
  aspect: 1,
  seed: 1,
  ...overrides,
});

const tagBalance = (svg: string, tag: string) =>
  (svg.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length - (svg.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;

describe('artworkSvg', () => {
  it('draws every motif in every style and proportion without invalid numbers', () => {
    for (const style of STYLE_IDS) {
      for (const motif of ART_MOTIFS) {
        for (const aspect of [0.5, 1, 2.4]) {
          const svg = artworkSvg(input({ style, motif, aspect, icon: 'music' }));
          expect(svg.startsWith('<svg')).toBe(true);
          expect(svg.endsWith('</svg>')).toBe(true);
          expect(svg).not.toMatch(/NaN|undefined|Infinity/);
          for (const tag of ['g', 'defs', 'clipPath', 'radialGradient', 'svg']) expect(tagBalance(svg, tag)).toBe(0);
        }
      }
    }
  });

  it('is deterministic for a seed and different across seeds', () => {
    expect(artworkSvg(input({ seed: 42 }))).toBe(artworkSvg(input({ seed: 42 })));
    const pictures = new Set(Array.from({ length: 12 }, (_, seed) => artworkSvg(input({ seed }))));
    expect(pictures.size).toBe(12);
  });

  it('picks varied motifs per style when none is chosen', () => {
    for (const style of STYLE_IDS) {
      const motifs = new Set(Array.from({ length: 30 }, (_, seed) => pickMotif(style, seed)));
      expect(motifs.size).toBeGreaterThanOrEqual(5);
    }
    expect(pickMotif('bold', 3, 'mesh')).toBe('mesh');
  });

  it('adds the icon only when asked and when it exists', () => {
    const musicPath = ICONS.music.slice(0, 30);
    expect(artworkSvg(input({ icon: 'music' }))).toContain(musicPath);
    expect(artworkSvg(input({ icon: null }))).not.toContain(musicPath);
    expect(artworkSvg(input({ icon: 'no-such-icon' }))).not.toContain('stroke-linecap="round" stroke-linejoin="round"');
  });

  it('gives every new image tile its own picture', () => {
    const seeds = new Set(Array.from({ length: 20 }, () => makeTile('image', '').art?.seed));
    expect(seeds.size).toBe(20);
  });
});

describe('topicIcon', () => {
  it('matches the topic of the copy', () => {
    expect(['music', 'guitar', 'mic-vocal', 'headphones', 'piano', 'drum']).toContain(topicIcon('Koncert jazzowy pod gwiazdami', 1));
    expect(['coffee', 'croissant']).toContain(topicIcon('Otwieramy kawiarnię Ziarno!', 1));
    expect(topicIcon('Pizzeria Roma: -30%', 5)).toBe('pizza');
    expect(['graduation-cap', 'pencil', 'school', 'book-open']).toContain(topicIcon('Kurs programowania dla początkujących', 2));
    expect(['rocket', 'code', 'laptop', 'cpu', 'bot']).toContain(topicIcon('Hackathon for developers', 0));
  });

  it('does not match look-alike words', () => {
    expect(topicIcon('Kotlet schabowy w stołówce', 0)).not.toBe('paw-print');
    expect(topicIcon('Wielki spacer po mieście', 0)).toBeNull();
    expect(topicIcon('Zebranie zarządu', 0)).toBeNull();
  });

  it('only suggests bundled icons', () => {
    for (const text of ['koncert', 'pizza', 'kawa', 'kurs', 'sport', 'kino', 'podróż', 'wyprzedaż', 'ślub', 'urodziny']) {
      for (let seed = 0; seed < 6; seed++) {
        const icon = topicIcon(text, seed);
        if (icon) expect(ICON_NAMES).toContain(icon);
      }
    }
  });
});
