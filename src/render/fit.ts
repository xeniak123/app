/**
 * Finds the largest font size at which `el`'s text fits a `width` x `height`
 * box without breaking words, and applies it. Measures against the target box
 * rather than the element's current size, so it stays correct while tiles
 * animate to their new places.
 *
 * Self-contained on purpose: the HTML renderer inlines its source into
 * standalone pages, so it must not reference anything outside its body.
 */
export function fitText(el: HTMLElement, width: number, height: number, maxPx: number, minPx = 2): number {
  el.style.width = `${Math.max(width, 1)}px`;
  const fits = (size: number) => {
    el.style.fontSize = `${size}px`;
    return el.scrollHeight <= height + 0.5 && el.scrollWidth <= width + 0.5;
  };
  const top = Math.max(minPx, maxPx);
  if (fits(top)) return top;
  let lo = minPx;
  let hi = top;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const size = Math.floor(lo * 10) / 10;
  el.style.fontSize = `${size}px`;
  return size;
}
