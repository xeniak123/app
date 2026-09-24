import type { RuntimeFont } from './runtime';

/**
 * Fonts bundled into the MCP server (SIL Open Font License, via Fontsource),
 * inlined as data URLs so renders work offline. Compositions just use the
 * family name in CSS; only the families a composition mentions are loaded.
 */

const files = {
  ...import.meta.glob('/node_modules/@fontsource-variable/*/files/*-{latin,latin-ext}-wght-{normal,italic}.woff2', {
    query: '?inline',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob(
    '/node_modules/@fontsource/{anton,bebas-neue,archivo-black,instrument-serif,dm-serif-display,space-mono,permanent-marker}/files/*-{latin,latin-ext}-{400,700}-{normal,italic}.woff2',
    { query: '?inline', import: 'default', eager: true },
  ),
} as Record<string, string>;

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

export interface FontFamily {
  family: string;
  /** Fontsource package directory and file prefix. */
  dir: string;
  slug: string;
  variable: boolean;
  /** "100 900" for variable fonts, or the static weights available. */
  weights: string;
  italic: boolean;
  category: 'sans' | 'serif' | 'display' | 'condensed' | 'mono' | 'rounded' | 'hand';
  note: string;
}

export const FONT_FAMILIES: FontFamily[] = [
  { family: 'Inter', dir: '@fontsource-variable/inter', slug: 'inter', variable: true, weights: '100 900', italic: true, category: 'sans', note: 'neutral workhorse for body text, labels and UI' },
  { family: 'Bricolage Grotesque', dir: '@fontsource-variable/bricolage-grotesque', slug: 'bricolage-grotesque', variable: true, weights: '200 800', italic: false, category: 'display', note: 'characterful grotesk; superb big headlines' },
  { family: 'Fraunces', dir: '@fontsource-variable/fraunces', slug: 'fraunces', variable: true, weights: '100 900', italic: true, category: 'serif', note: 'soft, expressive old-style serif; editorial, food, culture' },
  { family: 'Unbounded', dir: '@fontsource-variable/unbounded', slug: 'unbounded', variable: true, weights: '200 900', italic: false, category: 'display', note: 'wide geometric display; tech, music, bold statements' },
  { family: 'Syne', dir: '@fontsource-variable/syne', slug: 'syne', variable: true, weights: '400 800', italic: false, category: 'display', note: 'art-school grotesk; striking at 800' },
  { family: 'Archivo', dir: '@fontsource-variable/archivo', slug: 'archivo', variable: true, weights: '100 900', italic: true, category: 'sans', note: 'sturdy grotesk; strong at 800-900' },
  { family: 'Space Grotesk', dir: '@fontsource-variable/space-grotesk', slug: 'space-grotesk', variable: true, weights: '300 700', italic: false, category: 'sans', note: 'technical, quirky geometric; product and dev tools' },
  { family: 'Manrope', dir: '@fontsource-variable/manrope', slug: 'manrope', variable: true, weights: '200 800', italic: false, category: 'sans', note: 'clean modern geometric sans' },
  { family: 'Instrument Sans', dir: '@fontsource-variable/instrument-sans', slug: 'instrument-sans', variable: true, weights: '400 700', italic: true, category: 'sans', note: 'crisp neo-grotesk; pairs with Instrument Serif' },
  { family: 'Playfair Display', dir: '@fontsource-variable/playfair-display', slug: 'playfair-display', variable: true, weights: '400 900', italic: true, category: 'serif', note: 'high-contrast classic serif; elegant events' },
  { family: 'Oswald', dir: '@fontsource-variable/oswald', slug: 'oswald', variable: true, weights: '200 700', italic: false, category: 'condensed', note: 'condensed sans for tall headlines and numbers' },
  { family: 'JetBrains Mono', dir: '@fontsource-variable/jetbrains-mono', slug: 'jetbrains-mono', variable: true, weights: '100 800', italic: true, category: 'mono', note: 'code, data, terminal UI' },
  { family: 'Fredoka', dir: '@fontsource-variable/fredoka', slug: 'fredoka', variable: true, weights: '300 700', italic: false, category: 'rounded', note: 'friendly rounded; kids, food, playful' },
  { family: 'Caveat', dir: '@fontsource-variable/caveat', slug: 'caveat', variable: true, weights: '400 700', italic: false, category: 'hand', note: 'handwritten notes and annotations' },
  { family: 'Anton', dir: '@fontsource/anton', slug: 'anton', variable: false, weights: '400', italic: false, category: 'condensed', note: 'loud condensed poster headlines' },
  { family: 'Bebas Neue', dir: '@fontsource/bebas-neue', slug: 'bebas-neue', variable: false, weights: '400', italic: false, category: 'condensed', note: 'clean condensed all-caps display' },
  { family: 'Archivo Black', dir: '@fontsource/archivo-black', slug: 'archivo-black', variable: false, weights: '400', italic: false, category: 'display', note: 'heavy, punchy grotesk display' },
  { family: 'Instrument Serif', dir: '@fontsource/instrument-serif', slug: 'instrument-serif', variable: false, weights: '400', italic: true, category: 'serif', note: 'refined editorial serif with a beautiful italic' },
  { family: 'DM Serif Display', dir: '@fontsource/dm-serif-display', slug: 'dm-serif-display', variable: false, weights: '400', italic: true, category: 'serif', note: 'bold, warm high-contrast display serif' },
  { family: 'Space Mono', dir: '@fontsource/space-mono', slug: 'space-mono', variable: false, weights: '400 700', italic: true, category: 'mono', note: 'retro-futurist monospace' },
  { family: 'Permanent Marker', dir: '@fontsource/permanent-marker', slug: 'permanent-marker', variable: false, weights: '400', italic: false, category: 'hand', note: 'marker lettering; latin only (no Polish accents)' },
];

function file(dir: string, name: string): string | undefined {
  return files[`/node_modules/${dir}/files/${name}`];
}

/** Font faces for one family: every subset, style and (for static fonts) weight that is bundled. */
export function familyFaces(family: FontFamily): RuntimeFont[] {
  const faces: RuntimeFont[] = [];
  for (const style of family.italic ? ['normal', 'italic'] : ['normal']) {
    for (const [subset, unicodeRange] of [
      ['latin-ext', LATIN_EXT],
      ['latin', LATIN],
    ]) {
      if (family.variable) {
        const src = file(family.dir, `${family.slug}-${subset}-wght-${style}.woff2`);
        if (src) faces.push({ family: family.family, src, weight: family.weights, style, unicodeRange });
      } else {
        for (const weight of family.weights.split(' ')) {
          const src = file(family.dir, `${family.slug}-${subset}-${weight}-${style}.woff2`);
          if (src) faces.push({ family: family.family, src, weight, style, unicodeRange });
        }
      }
    }
  }
  return faces;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The bundled families a composition's HTML/CSS refers to by name. */
export function familiesUsedIn(source: string): FontFamily[] {
  return FONT_FAMILIES.filter((family) => {
    const name = escape(family.family);
    return (
      new RegExp(`(["'])${name}\\1`, 'i').test(source) ||
      new RegExp(`font(?:-family)?\\s*:[^;{}<>]*(?:^|[\\s,/])${name}\\s*(?:[,;}!"']|$)`, 'im').test(source)
    );
  });
}

export function fontFacesFor(source: string): RuntimeFont[] {
  return familiesUsedIn(source).flatMap(familyFaces);
}

/** @font-face CSS for standalone exports. */
export function fontFaceCss(faces: RuntimeFont[]): string {
  return faces
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(${f.src}) format('woff2');unicode-range:${f.unicodeRange};}`,
    )
    .join('\n');
}
