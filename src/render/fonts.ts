// Fonts inlined as data URLs, so standalone pages render identically offline
// and the MCP server ships as a single file. Latin + Latin Extended covers
// English, Polish and most European languages.
import anton400 from '@fontsource/anton/files/anton-latin-400-normal.woff2?inline';
import anton400ext from '@fontsource/anton/files/anton-latin-ext-400-normal.woff2?inline';
import fredoka500 from '@fontsource/fredoka/files/fredoka-latin-500-normal.woff2?inline';
import fredoka500ext from '@fontsource/fredoka/files/fredoka-latin-ext-500-normal.woff2?inline';
import fredoka600 from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff2?inline';
import fredoka600ext from '@fontsource/fredoka/files/fredoka-latin-ext-600-normal.woff2?inline';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?inline';
import inter400ext from '@fontsource/inter/files/inter-latin-ext-400-normal.woff2?inline';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?inline';
import inter600ext from '@fontsource/inter/files/inter-latin-ext-600-normal.woff2?inline';
import playfair600 from '@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff2?inline';
import playfair600ext from '@fontsource/playfair-display/files/playfair-display-latin-ext-600-normal.woff2?inline';
import grotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2?inline';
import grotesk700ext from '@fontsource/space-grotesk/files/space-grotesk-latin-ext-700-normal.woff2?inline';
import type { StyleId } from '../model/types';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

type Face = [family: string, weight: number, latin: string, latinExt: string];

const INTER_400: Face = ['Inter', 400, inter400, inter400ext];
const INTER_600: Face = ['Inter', 600, inter600, inter600ext];

/** The faces each style uses: display, body and the semibold call-to-action weight. */
const STYLE_FACES: Record<StyleId, Face[]> = {
  bold: [['Anton', 400, anton400, anton400ext], INTER_600],
  elegant: [['Playfair Display', 600, playfair600, playfair600ext], INTER_400, INTER_600],
  playful: [
    ['Fredoka', 500, fredoka500, fredoka500ext],
    ['Fredoka', 600, fredoka600, fredoka600ext],
  ],
  minimal: [['Space Grotesk', 700, grotesk700, grotesk700ext], INTER_400, INTER_600],
};

export function fontFaceCss(style: StyleId): string {
  return STYLE_FACES[style]
    .flatMap(([family, weight, latin, latinExt]) =>
      [
        [latinExt, LATIN_EXT],
        [latin, LATIN],
      ].map(
        ([src, range]) =>
          `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(${src}) format('woff2');unicode-range:${range};}`,
      ),
    )
    .join('\n');
}
