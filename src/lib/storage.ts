import { sanitizeDesign } from '../model/sanitize';
import type { Design } from '../model/types';

const KEY = 'tilecast:v1';

export interface Saved {
  design: Design;
  brief: string;
}

/** The project lives only in this browser; storage may be unavailable, so every access is guarded. */
export function loadProject(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { design?: unknown; brief?: unknown };
    const design = sanitizeDesign(data.design);
    if (!design) return null;
    return { design, brief: typeof data.brief === 'string' ? data.brief : '' };
  } catch {
    return null;
  }
}

/** Returns false when the project could not be saved (e.g. photos exceed the storage quota). */
export function saveProject(saved: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}
