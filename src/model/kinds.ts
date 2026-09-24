import type { TileKind, TileSize, TileTone } from './types';

export interface KindSpec {
  label: string;
  hint: string;
  defaultSize: TileSize;
  defaultTone: TileTone;
  /** Preferred width/height ratio range of the tile. */
  aspect: [number, number];
  /** How much the layout engine cares about hitting `aspect`. */
  strictness: number;
  /** Smallest comfortable tile side, as a fraction of the canvas' shorter side. */
  minSide: number;
  font: 'display' | 'body' | 'emoji';
  /** Cap on the font size, as a fraction of the canvas' shorter side. Keeps the hierarchy intact. */
  maxFont: number;
  placeholder: string;
}

export const KINDS: Record<TileKind, KindSpec> = {
  headline: {
    label: 'Nagłówek',
    hint: 'Główne hasło',
    defaultSize: 'L',
    defaultTone: 'clear',
    aspect: [1.3, 4.5],
    strictness: 1.6,
    minSide: 0.16,
    font: 'display',
    maxFont: 0.16,
    placeholder: 'Wielkie hasło',
  },
  text: {
    label: 'Tekst',
    hint: 'Opis, podtytuł',
    defaultSize: 'M',
    defaultTone: 'surface',
    aspect: [0.9, 3.2],
    strictness: 1.1,
    minSide: 0.14,
    font: 'body',
    maxFont: 0.056,
    placeholder: 'Kilka słów opisu',
  },
  number: {
    label: 'Liczba',
    hint: 'Cena, rabat, data',
    defaultSize: 'M',
    defaultTone: 'accent',
    aspect: [0.8, 2.2],
    strictness: 1.2,
    minSide: 0.14,
    font: 'display',
    maxFont: 0.26,
    placeholder: '-30%',
  },
  cta: {
    label: 'Wezwanie',
    hint: 'Co ma zrobić odbiorca',
    defaultSize: 'S',
    defaultTone: 'ink',
    aspect: [2, 7],
    strictness: 1.4,
    minSide: 0.09,
    font: 'body',
    maxFont: 0.05,
    placeholder: 'Zamów teraz →',
  },
  info: {
    label: 'Informacje',
    hint: 'Kiedy, gdzie, kontakt',
    defaultSize: 'S',
    defaultTone: 'surface',
    aspect: [1, 4],
    strictness: 1,
    minSide: 0.1,
    font: 'body',
    maxFont: 0.036,
    placeholder: 'Piątek, 18:00\nul. Przykładowa 1',
  },
  image: {
    label: 'Zdjęcie',
    hint: 'Twoje zdjęcie albo wzór',
    defaultSize: 'L',
    defaultTone: 'accent',
    aspect: [0.6, 1.9],
    strictness: 0.5,
    minSide: 0.18,
    font: 'body',
    maxFont: 0.04,
    placeholder: '',
  },
  emoji: {
    label: 'Ikona',
    hint: 'Duże emoji',
    defaultSize: 'S',
    defaultTone: 'surface',
    aspect: [0.7, 1.5],
    strictness: 0.9,
    minSide: 0.1,
    font: 'emoji',
    maxFont: 0.22,
    placeholder: '✨',
  },
  brand: {
    label: 'Marka',
    hint: 'Nazwa albo logo',
    defaultSize: 'S',
    defaultTone: 'clear',
    aspect: [1.4, 6],
    strictness: 1,
    minSide: 0.08,
    font: 'display',
    maxFont: 0.06,
    placeholder: 'Twoja marka',
  },
};

export const SIZE_WEIGHT: Record<TileSize, number> = { S: 1, M: 2, L: 3.5, XL: 5.5 };

export const SIZE_LABEL: Record<TileSize, string> = { S: 'Mały', M: 'Średni', L: 'Duży', XL: 'Wielki' };

export const TONE_LABEL: Record<TileTone, string> = {
  accent: 'Akcent',
  surface: 'Karta',
  ink: 'Kontrast',
  clear: 'Bez tła',
};
