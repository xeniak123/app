import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { sanitizeDesign } from '../src/model/sanitize';
import type { Design } from '../src/model/types';
import { AiDesignSchema } from './schema';

export const DEFAULT_MODEL = 'claude-opus-5';

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You are the art director of Tilecast. You design promotional graphics (posters, social posts, stories, banners) as a set of tiles. A layout engine arranges the tiles into a bento grid and renders the same tiles in every format, so you decide content, hierarchy and color, not coordinates.

Tile kinds:
- headline: the main message, 2-7 words. Exactly one.
- text: a supporting sentence or two, at most about 120 characters.
- number: one striking figure taken from the brief (price, discount, date, count), e.g. "-30%", "49 zł", "12.10". At most 8 characters.
- cta: the call to action, with the website or contact from the brief when there is one, e.g. "Zamów na roma.pl →". At most about 30 characters.
- info: practical details from the brief (when, where, contact), up to 3 short lines separated by \\n.
- image: a photo slot that the user fills in. Empty text. Include exactly one.
- emoji: a single emoji that fits the topic.
- brand: the organizer or company name, when the brief gives one.

Rules:
- Use only facts from the brief (and from the change request, when editing). Never invent prices, dates, addresses, phone numbers, websites or names. With no figure in the brief, leave out the number tile.
- Write tile copy in the language of the brief: short, punchy poster copy, with typos fixed.
- Return 5 to 9 tiles in reading order: what should be read first comes first, the headline near the start, the cta near the end.
- size sets a tile's share of the area: headline L or XL, image L, a key number M or L, details S.
- tone: accent = accent-colored tile, surface = card, ink = inverted card, clear = no background. Give neighbouring tiles different tones and save accent for what must pop.
- style: bold (loud, condensed uppercase), elegant (serif, calm), playful (rounded, fun), minimal (grotesk, technical). Match the topic and audience.
- palette: ink must be readable on bg and surface (contrast of at least 4.5:1) and accentInk readable on accent. Choose colors that suit the topic; avoid generic purple-blue tech gradients.
- id: an empty string for new tiles; when editing an existing design, keep the id of every tile you keep.`;

type Client = Pick<Anthropic, 'beta'>;

async function requestDesign(client: Client, model: string, content: string) {
  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      output_config: { effort: 'medium', format: betaZodOutputFormat(AiDesignSchema) },
      messages: [{ role: 'user', content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiError('Klucz API jest nieprawidłowy. Sprawdź ANTHROPIC_API_KEY w pliku .env.', 401);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError('Za dużo zapytań do AI. Spróbuj ponownie za chwilę.', 429);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AiError('Brak połączenia z API Anthropic.', 502);
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiError(`API Anthropic zwróciło błąd ${error.status ?? ''}: ${error.message}`, 502);
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    throw new AiError('AI odmówiło przygotowania tego projektu. Zmień opis i spróbuj ponownie.', 422);
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new AiError('AI nie zwróciło kompletnego projektu. Spróbuj ponownie.', 502);
  }
  return response.parsed_output;
}

export async function generateDesign(client: Client, model: string, brief: string): Promise<Design> {
  const raw = await requestDesign(client, model, `Design a graphic for this brief:\n<brief>\n${brief}\n</brief>`);
  const design = sanitizeDesign({ ...raw, seed: 0 });
  if (!design) throw new AiError('AI zwróciło pusty projekt. Spróbuj ponownie.', 502);
  return design;
}

/** What the model sees of a design: everything but the (large) uploaded images. */
export function describeDesign(design: Design) {
  return {
    style: design.style,
    palette: design.palette,
    tiles: design.tiles.map(({ image, ...tile }) => (image ? { ...tile, hasUserImage: true } : tile)),
  };
}

export async function refineDesign(
  client: Client,
  model: string,
  current: Design,
  instruction: string,
): Promise<Design> {
  const content = `Here is the current design, including the user's manual edits:
<design>
${JSON.stringify(describeDesign(current), null, 2)}
</design>

Apply this change request and return the complete updated design. Keep everything the request does not ask to change: tile order, copy, sizes, tones and ids.
<change_request>
${instruction}
</change_request>`;
  const raw = await requestDesign(client, model, content);
  return mergeRefined(current, raw);
}

/** Carries uploaded images and the layout variant over from the current design. */
export function mergeRefined(current: Design, raw: unknown): Design {
  const design = sanitizeDesign(raw);
  if (!design) throw new AiError('AI zwróciło pusty projekt. Spróbuj ponownie.', 502);
  const images = new Map(current.tiles.filter((t) => t.image).map((t) => [t.id, t.image]));
  return {
    ...design,
    seed: current.seed,
    tiles: design.tiles.map((tile) => {
      const image = images.get(tile.id);
      return image ? { ...tile, image } : tile;
    }),
  };
}
