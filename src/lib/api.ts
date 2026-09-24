import { sanitizeDesign } from '../model/sanitize';
import type { Design } from '../model/types';

export interface AiStatus {
  ai: boolean;
  model: string | null;
}

// A 1x1 GIF stands in for uploaded photos so requests stay small; the real
// images are put back by tile id when the answer arrives.
const IMAGE_STANDIN = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

async function post(path: string, body: unknown): Promise<Design> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Brak połączenia z serwerem aplikacji.');
  }
  const data = (await response.json().catch(() => ({}))) as { design?: unknown; error?: string };
  if (!response.ok) throw new Error(data.error ?? `Błąd serwera (${response.status}).`);
  const design = sanitizeDesign(data.design);
  if (!design) throw new Error('Serwer zwrócił pusty projekt.');
  return design;
}

export async function fetchStatus(): Promise<AiStatus> {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) return { ai: false, model: null };
    return (await response.json()) as AiStatus;
  } catch {
    return { ai: false, model: null };
  }
}

export function requestGenerate(brief: string): Promise<Design> {
  return post('/api/generate', { brief });
}

export async function requestRefine(design: Design, instruction: string): Promise<Design> {
  const images = new Map(design.tiles.filter((t) => t.image).map((t) => [t.id, t.image]));
  const lite: Design = {
    ...design,
    tiles: design.tiles.map((t) => (t.image ? { ...t, image: IMAGE_STANDIN } : t)),
  };
  const result = await post('/api/refine', { design: lite, instruction });
  return {
    ...result,
    tiles: result.tiles.map(({ image: _standin, ...tile }) => {
      const image = images.get(tile.id);
      return image ? { ...tile, image } : tile;
    }),
  };
}
