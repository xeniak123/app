import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Finds the largest font size at which `el`'s text fits a `width` x `height`
 * box without breaking words, and applies it. Measures against the target box
 * rather than the element's current size, so it stays correct while tiles
 * animate to their new places.
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

/** Bumps whenever web fonts finish loading, so text gets re-measured with real metrics. */
export const FontsVersionContext = createContext(0);

export function useFontsVersionSource(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!document.fonts) return;
    let alive = true;
    const bump = () => {
      if (alive) setVersion((v) => v + 1);
    };
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener('loadingdone', bump);
    return () => {
      alive = false;
      document.fonts.removeEventListener('loadingdone', bump);
    };
  }, []);
  return version;
}

export function useFontsVersion(): number {
  return useContext(FontsVersionContext);
}
