import { mix } from '../model/color';
import type { StyleId } from '../model/types';

/**
 * Decorative SVG backgrounds for image tiles that have no photo yet, so a fresh
 * design already looks finished. Drawn in the tile's own colors.
 */
export function patternUrl(style: StyleId, base: string, ink: string, variant: number): string {
  const c1 = mix(base, ink, 0.14);
  const c2 = mix(base, ink, 0.28);
  const c3 = mix(base, ink, 0.55);
  const flip = variant % 2 === 0 ? '' : ' transform="translate(200 0) scale(-1 1)"';
  let shapes: string;
  switch (style) {
    case 'bold':
      shapes = `<circle cx="150" cy="58" r="74" fill="${c1}"/>
        <circle cx="38" cy="172" r="52" fill="${c2}"/>
        <rect x="-40" y="104" width="300" height="20" fill="${c3}" transform="rotate(-20 100 100)"/>
        <rect x="-40" y="136" width="300" height="8" fill="${c2}" transform="rotate(-20 100 100)"/>`;
      break;
    case 'elegant':
      shapes = [0, 16, 32, 48]
        .map(
          (d) =>
            `<path d="M${30 + d} 210 V${120 + d * 0.4} a${70 - d} ${70 - d} 0 0 1 ${140 - 2 * d} 0 V210" fill="none" stroke="${c3}" stroke-width="1.2"/>`,
        )
        .join('')
        .concat(`<circle cx="100" cy="52" r="16" fill="${c2}"/>`);
      break;
    case 'playful':
      shapes = `<path d="M40 30 C90 0 170 20 170 80 C170 140 110 130 80 160 C50 190 0 150 12 100 C20 64 10 44 40 30Z" fill="${c1}"/>
        <circle cx="160" cy="160" r="30" fill="${c2}"/>
        <circle cx="46" cy="176" r="10" fill="${c3}"/>
        <circle cx="150" cy="36" r="8" fill="${c3}"/>
        <path d="M20 120 q20 -20 40 0 t40 0 t40 0 t40 0" fill="none" stroke="${c3}" stroke-width="5" stroke-linecap="round"/>`;
      break;
    case 'minimal':
      shapes = `<defs><pattern id="d" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${c2}"/></pattern></defs>
        <rect width="200" height="200" fill="url(#d)"/>
        <circle cx="128" cy="92" r="58" fill="none" stroke="${c3}" stroke-width="2"/>
        <circle cx="128" cy="92" r="20" fill="${c3}"/>`;
      break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><rect width="200" height="200" fill="${base}"/><g${flip}>${shapes}</g></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}
