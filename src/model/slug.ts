/** File-name-safe slug: "W każdy piątek!" becomes "w-kazdy-piatek". */
export function slugify(text: string, fallback = 'tilecast'): string {
  return (
    text
      .toLowerCase()
      .replaceAll('ł', 'l')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || fallback
  );
}
