/**
 * The full Lucide icon set (https://lucide.dev, ISC license), searchable by
 * name and tag. Icons come back as inline SVG that follows `color` in CSS.
 */

type IconNode = [string, Record<string, string | number>][];

const nodes = Object.values(
  import.meta.glob('/node_modules/lucide-static/icon-nodes.json', { eager: true, import: 'default' }),
)[0] as Record<string, IconNode>;
const tags = Object.values(import.meta.glob('/node_modules/lucide-static/tags.json', { eager: true, import: 'default' }))[0] as Record<
  string,
  string[]
>;

export const ICON_COUNT = Object.keys(nodes).length;

const escapeAttr = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function iconSvg(name: string, options: { size?: number; strokeWidth?: number } = {}): string | null {
  const node = nodes[name];
  if (!node) return null;
  const size = options.size ?? 24;
  const children = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="${options.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round" class="icon icon-${name}">${children}</svg>`
  );
}

/** Icons whose name or tags match the query words, best matches first. */
export function findIcons(query: string, limit = 40): string[] {
  const words = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (!words.length) return [];
  const scored: [string, number][] = [];
  for (const name of Object.keys(nodes)) {
    const parts = name.split('-');
    const tagList = tags[name] ?? [];
    let score = 0;
    for (const word of words) {
      if (name === word) score += 12;
      else if (parts.includes(word)) score += 8;
      else if (name.includes(word)) score += 4;
      if (tagList.some((tag) => tag === word)) score += 5;
      else if (tagList.some((tag) => tag.split(/\s+/).some((t) => t.startsWith(word)))) score += 2;
    }
    if (score > 0) scored.push([name, score - parts.length * 0.1]);
  }
  return scored
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}
