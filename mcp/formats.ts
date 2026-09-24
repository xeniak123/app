/**
 * Output formats. A composition is laid out in a viewport of `width` × `height`
 * CSS pixels and captured at `scale`, so the A4 poster is designed at
 * 1240×1754 like a web page and exported at 2480×3508 (300 dpi).
 */
export interface Format {
  id: string;
  label: string;
  width: number;
  height: number;
  scale: number;
  /** Physical size for print, in millimetres. */
  print?: { width: number; height: number };
  video: boolean;
  note: string;
}

export const FORMATS: Format[] = [
  { id: 'poster-a4', label: 'Poster A4', width: 1240, height: 1754, scale: 2, print: { width: 210, height: 297 }, video: false, note: '2480×3508, 300 dpi print' },
  { id: 'poster-a3', label: 'Poster A3', width: 1754, height: 2480, scale: 2, print: { width: 297, height: 420 }, video: false, note: '3508×4960, 300 dpi print' },
  { id: 'flyer-a5', label: 'Flyer A5', width: 874, height: 1240, scale: 2, print: { width: 148, height: 210 }, video: false, note: '1748×2480, 300 dpi print' },
  { id: 'square', label: 'Square 1:1', width: 1080, height: 1080, scale: 1, video: true, note: 'Instagram / Facebook post' },
  { id: 'portrait', label: 'Portrait 4:5', width: 1080, height: 1350, scale: 1, video: true, note: 'Instagram feed' },
  { id: 'story', label: 'Story 9:16', width: 1080, height: 1920, scale: 1, video: true, note: 'Stories, Reels, TikTok, Shorts' },
  { id: 'landscape', label: 'Landscape 16:9', width: 1920, height: 1080, scale: 1, video: true, note: 'YouTube, slides, banners, X' },
  { id: 'og', label: 'Link preview', width: 1200, height: 630, scale: 2, video: false, note: 'Open Graph / social card, exported at 2400×1260' },
];

export const FORMAT_IDS = FORMATS.map((f) => f.id) as [string, ...string[]];
export const VIDEO_FORMAT_IDS = FORMATS.filter((f) => f.video).map((f) => f.id) as [string, ...string[]];

export function getFormat(id: string): Format {
  const format = FORMATS.find((f) => f.id === id);
  if (!format) throw new Error(`Unknown format "${id}". Use one of: ${FORMAT_IDS.join(', ')}, or width and height.`);
  return format;
}

/** A custom size in pixels, captured 1:1. */
export function customFormat(width: number, height: number): Format {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8000 || height > 8000) {
    throw new Error('Custom width and height must be whole numbers between 16 and 8000 pixels.');
  }
  return { id: `${width}x${height}`, label: `${width}×${height}`, width, height, scale: 1, video: true, note: 'custom size' };
}

export const outputSize = (format: Format) => ({
  width: Math.round(format.width * format.scale),
  height: Math.round(format.height * format.scale),
});
