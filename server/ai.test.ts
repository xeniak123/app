import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Design } from '../src/model/types';
import { AiError, generateDesign, mergeRefined, refineDesign } from './ai';

const aiDesign = {
  style: 'bold',
  palette: { bg: '#fff3e4', surface: '#ffffff', ink: '#1f1a17', accent: '#e4572e', accentInk: '#ffffff' },
  tiles: [
    { id: '', kind: 'headline', text: 'Piątek z pizzą', size: 'L', tone: 'clear' },
    { id: '', kind: 'image', text: '', size: 'L', tone: 'accent' },
    { id: '', kind: 'number', text: '-30%', size: 'M', tone: 'accent' },
    { id: '', kind: 'cta', text: 'Zamów na roma.pl →', size: 'S', tone: 'ink' },
  ],
};

function fakeClient(result: unknown) {
  const parse = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { beta: { messages: { parse } } } as unknown as Pick<Anthropic, 'beta'>, parse };
}

describe('generateDesign', () => {
  it('asks Claude for a structured design with refusal fallbacks', async () => {
    const { client, parse } = fakeClient({ stop_reason: 'end_turn', parsed_output: aiDesign });
    const design = await generateDesign(client, 'claude-opus-5', 'Pizza -30% w piątek');

    const params = (parse.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(params.model).toBe('claude-opus-5');
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
    expect(params.output_config.format).toBeTruthy();
    expect(params.messages[0].content).toContain('Pizza -30% w piątek');

    expect(design.tiles.map((t) => t.kind)).toEqual(['headline', 'image', 'number', 'cta']);
    expect(design.tiles.every((t) => t.id.length > 0)).toBe(true);
  });

  it('reports refusals and incomplete answers', async () => {
    await expect(
      generateDesign(fakeClient({ stop_reason: 'refusal', parsed_output: null }).client, 'm', 'x'),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      generateDesign(fakeClient({ stop_reason: 'max_tokens', parsed_output: null }).client, 'm', 'x'),
    ).rejects.toBeInstanceOf(AiError);
  });

  it('turns SDK errors into friendly messages', async () => {
    const { client } = fakeClient(new Anthropic.APIConnectionError({ message: 'offline' }));
    await expect(generateDesign(client, 'm', 'x')).rejects.toMatchObject({ status: 502 });
  });
});

describe('refineDesign', () => {
  const current: Design = {
    style: 'bold',
    seed: 3,
    palette: aiDesign.palette,
    tiles: [
      { id: 'h', kind: 'headline', text: 'Stare hasło', size: 'L', tone: 'clear' },
      { id: 'img', kind: 'image', text: '', size: 'L', tone: 'accent', image: 'data:image/jpeg;base64,AAAA' },
    ],
  };

  it('sends the design without image data and keeps images and layout variant', async () => {
    const { client, parse } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: {
        ...aiDesign,
        style: 'elegant',
        tiles: [
          { id: 'h', kind: 'headline', text: 'Nowe hasło', size: 'L', tone: 'clear' },
          { id: 'img', kind: 'image', text: '', size: 'L', tone: 'accent' },
          { id: '', kind: 'info', text: 'Pn–Pt 12–22', size: 'S', tone: 'surface' },
        ],
      },
    });
    const design = await refineDesign(client, 'm', current, 'Dodaj godziny otwarcia 12–22');

    const params = (parse.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(params.messages[0].content).not.toContain('data:image');
    expect(params.messages[0].content).toContain('hasUserImage');
    expect(design.style).toBe('elegant');
    expect(design.seed).toBe(3);
    expect(design.tiles[0].text).toBe('Nowe hasło');
    expect(design.tiles[1].image).toBe('data:image/jpeg;base64,AAAA');
    expect(design.tiles[2].id).not.toBe('');
  });

  it('rejects an empty refinement', () => {
    expect(() => mergeRefined(current, { tiles: [] })).toThrow(AiError);
  });
});
