import type { Format, FormatId } from './types';

export const FORMATS: Format[] = [
  { id: 'poster', label: 'Plakat A4', width: 2480, height: 3508, note: 'druk 300 dpi' },
  { id: 'square', label: 'Post 1:1', width: 1080, height: 1080, note: 'Instagram, Facebook' },
  { id: 'story', label: 'Story 9:16', width: 1080, height: 1920, note: 'Instagram, TikTok' },
  { id: 'banner', label: 'Baner 16:9', width: 1920, height: 1080, note: 'YouTube, prezentacje' },
];

export function getFormat(id: FormatId): Format {
  const format = FORMATS.find((f) => f.id === id);
  if (!format) throw new Error(`Unknown format: ${id}`);
  return format;
}
