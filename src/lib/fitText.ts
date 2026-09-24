import { createContext, useContext, useEffect, useState } from 'react';

export { fitText } from '../render/fit';

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
