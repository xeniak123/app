import type { IncomingMessage, ServerResponse } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';
import { sanitizeDesign } from '../src/model/sanitize';
import { AiError, DEFAULT_MODEL, generateDesign, refineDesign } from './ai';

const MAX_BODY = 256 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new AiError('Zapytanie jest za duże.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new AiError('Nieprawidłowy JSON.', 400));
      }
    });
    req.on('error', reject);
  });
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new AiError(`Brakuje pola "${field}".`, 400);
  return value.trim().slice(0, max);
}

/**
 * Serves the AI endpoints from the Vite dev and preview servers, so the API key
 * stays on the server and `npm run dev` is the only command needed.
 */
export function tilecastApi(env: Record<string, string | undefined>): Plugin {
  const model = env.TILECAST_MODEL || DEFAULT_MODEL;
  const apiKey = env.ANTHROPIC_API_KEY || undefined;
  const authToken = env.ANTHROPIC_AUTH_TOKEN || undefined;
  const enabled = Boolean(apiKey || authToken);
  let client: Anthropic | null = null;
  const getClient = () => (client ??= new Anthropic({ apiKey: apiKey ?? null, authToken: authToken ?? null }));

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return next();
    try {
      if (path === '/api/status' && req.method === 'GET') {
        return send(res, 200, { ai: enabled, model: enabled ? model : null });
      }
      if (req.method !== 'POST' || (path !== '/api/generate' && path !== '/api/refine')) {
        return send(res, 404, { error: 'Nie ma takiego adresu.' });
      }
      if (!enabled) {
        throw new AiError('AI jest wyłączone: dodaj ANTHROPIC_API_KEY do pliku .env i uruchom serwer ponownie.', 503);
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      if (path === '/api/generate') {
        const brief = requireText(body.brief, 'brief', 2000);
        return send(res, 200, { design: await generateDesign(getClient(), model, brief) });
      }
      const instruction = requireText(body.instruction, 'instruction', 1000);
      const current = sanitizeDesign(body.design);
      if (!current) throw new AiError('Brakuje projektu do zmiany.', 400);
      return send(res, 200, { design: await refineDesign(getClient(), model, current, instruction) });
    } catch (error) {
      if (error instanceof AiError) return send(res, error.status, { error: error.message });
      console.error('[tilecast] unexpected error', error);
      return send(res, 500, { error: 'Nieoczekiwany błąd serwera.' });
    }
  };

  return {
    name: 'tilecast-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
