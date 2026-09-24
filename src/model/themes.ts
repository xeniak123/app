import type { Palette, StyleId } from './types';

export interface StyleSpec {
  label: string;
  display: string;
  displayWeight: number;
  body: string;
  bodyWeight: number;
  uppercase: boolean;
  letterSpacing: string;
  lineHeight: number;
  /** Fractions of the canvas' shorter side. */
  padding: number;
  gap: number;
  radius: number;
  tilePadding: number;
}

export const STYLES: Record<StyleId, StyleSpec> = {
  bold: {
    label: 'Mocny',
    display: '"Anton", "Impact", sans-serif',
    displayWeight: 400,
    body: '"Inter", system-ui, sans-serif',
    bodyWeight: 600,
    uppercase: true,
    letterSpacing: '0.005em',
    lineHeight: 0.98,
    padding: 0.036,
    gap: 0.018,
    radius: 0.016,
    tilePadding: 0.032,
  },
  elegant: {
    label: 'Elegancki',
    display: '"Playfair Display", Georgia, serif',
    displayWeight: 600,
    body: '"Inter", system-ui, sans-serif',
    bodyWeight: 400,
    uppercase: false,
    letterSpacing: '-0.01em',
    lineHeight: 1.06,
    padding: 0.05,
    gap: 0.024,
    radius: 0.006,
    tilePadding: 0.036,
  },
  playful: {
    label: 'Radosny',
    display: '"Fredoka", "Trebuchet MS", sans-serif',
    displayWeight: 600,
    body: '"Fredoka", "Trebuchet MS", sans-serif',
    bodyWeight: 500,
    uppercase: false,
    letterSpacing: '0em',
    lineHeight: 1.02,
    padding: 0.04,
    gap: 0.024,
    radius: 0.05,
    tilePadding: 0.036,
  },
  minimal: {
    label: 'Minimalny',
    display: '"Space Grotesk", "Helvetica Neue", sans-serif',
    displayWeight: 700,
    body: '"Inter", system-ui, sans-serif',
    bodyWeight: 400,
    uppercase: false,
    letterSpacing: '-0.035em',
    lineHeight: 1,
    padding: 0.046,
    gap: 0.022,
    radius: 0.024,
    tilePadding: 0.034,
  },
};

export interface NamedPalette extends Palette {
  name: string;
}

export const PALETTES: NamedPalette[] = [
  { name: 'Pomidor', bg: '#fff3e4', surface: '#ffffff', ink: '#1f1a17', accent: '#e4572e', accentInk: '#ffffff' },
  { name: 'Granat', bg: '#14213d', surface: '#1f3057', ink: '#f7f3e8', accent: '#e9b949', accentInk: '#14213d' },
  { name: 'Mięta', bg: '#e6f4ec', surface: '#ffffff', ink: '#0e2a22', accent: '#1f9d74', accentInk: '#ffffff' },
  { name: 'Papier', bg: '#f4f1ea', surface: '#ffffff', ink: '#141414', accent: '#141414', accentInk: '#f4f1ea' },
  { name: 'Róż', bg: '#ffe6ec', surface: '#ffffff', ink: '#3a0d1c', accent: '#d9366a', accentInk: '#ffffff' },
  { name: 'Ocean', bg: '#e4eefa', surface: '#ffffff', ink: '#0b2239', accent: '#0a66c2', accentInk: '#ffffff' },
  { name: 'Las', bg: '#1d2b22', surface: '#27392d', ink: '#eef3e9', accent: '#c5e36b', accentInk: '#1d2b22' },
  { name: 'Terakota', bg: '#f2e5d8', surface: '#fbf6f0', ink: '#2b1b14', accent: '#b8512c', accentInk: '#ffffff' },
  { name: 'Cytryna', bg: '#fff6c9', surface: '#ffffff', ink: '#1d1b12', accent: '#ff5a36', accentInk: '#ffffff' },
  { name: 'Grafit', bg: '#1b1b1f', surface: '#2a2a31', ink: '#f4f4f2', accent: '#ff7a45', accentInk: '#1b1b1f' },
];
