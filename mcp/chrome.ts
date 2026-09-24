import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

/**
 * Screenshots go through a locally installed Chrome, Chromium or Edge in
 * headless mode, so the MCP server needs no browser library of its own.
 */

const PLAYWRIGHT_EXECUTABLES = [
  ['chrome-linux', 'chrome'],
  ['chrome-linux64', 'chrome'],
  ['chrome-linux', 'headless_shell'],
  ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac', 'headless_shell'],
  ['chrome-win', 'chrome.exe'],
  ['chrome-win64', 'chrome.exe'],
  ['chrome-win', 'headless_shell.exe'],
];

function systemCandidates(env: NodeJS.ProcessEnv): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ];
    case 'win32': {
      const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[];
      return roots.flatMap((root) => [
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(root, 'Chromium', 'Application', 'chrome.exe'),
      ]);
    }
    default:
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/brave-browser',
      ];
  }
}

function playwrightCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = [
    env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'ms-playwright'),
  ].filter((root): root is string => Boolean(root) && existsSync(root!));
  const found: string[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    // Full Chromium before the headless shell; newest build first.
    const builds = entries
      .filter((e) => /^chromium(_headless_shell)?-\d+$/.test(e))
      .sort((a, b) => Number(a.includes('headless')) - Number(b.includes('headless')) || b.localeCompare(a));
    for (const build of builds) {
      for (const parts of PLAYWRIGHT_EXECUTABLES) found.push(path.join(root, build, ...parts));
    }
  }
  return found;
}

/** Finds a Chromium-based browser: $TILECAST_CHROME, then installed browsers, then Playwright's downloads. */
export function findChrome(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = [env.TILECAST_CHROME, env.CHROME_PATH, env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean) as string[];
  for (const candidate of [...explicit, ...systemCandidates(env), ...playwrightCandidates(env)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const CHROME_MISSING =
  'No Chrome, Chromium or Edge found for rendering PNGs. Install Google Chrome, or run `npx playwright install chromium`, ' +
  'or point the TILECAST_CHROME environment variable at a Chromium-based browser. HTML export works without a browser.';

export interface ScreenshotJob {
  html: string;
  width: number;
  height: number;
  outFile: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** Minimal Chrome DevTools Protocol client over --remote-debugging-pipe (NUL-separated JSON on fds 3 and 4). */
class Cdp {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private listeners: ((message: CdpMessage) => void)[] = [];

  constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    // A pipe error (Chrome crashed or already quit) must not take the MCP server down with it;
    // the exit handler reports the failure instead.
    input.on('error', () => undefined);
    output.on('error', () => undefined);
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const raw = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          this.dispatch(JSON.parse(raw) as CdpMessage);
        } catch {
          // Ignore a malformed message rather than crash; the request it answers will time out.
        }
      }
    });
  }

  private dispatch(message: CdpMessage) {
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result ?? {});
      return;
    }
    for (const listener of [...this.listeners]) listener(message);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: Record<string, unknown>) => void, reject });
    });
  }

  once(method: string, sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const listener = (message: CdpMessage) => {
        if (message.method === method && message.sessionId === sessionId) {
          this.listeners = this.listeners.filter((l) => l !== listener);
          resolve();
        }
      };
      this.listeners.push(listener);
    });
  }

  failAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

// Resolves once the page has fitted its text (the renderer sets <html data-ready>) and painted.
const WAIT_UNTIL_READY = `new Promise((resolve, reject) => {
  const start = Date.now();
  (function check() {
    if (document.documentElement.hasAttribute('data-ready')) requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    else if (Date.now() - start > 20000) reject(new Error('The page did not finish rendering.'));
    else setTimeout(check, 25);
  })();
})`;

/**
 * Renders HTML documents to PNGs of exactly the requested size with one
 * headless browser. The viewport is set through DevTools, so the image is
 * never cropped by browser UI, and capture waits until the text is fitted.
 */
export async function renderScreenshots(chrome: string, jobs: ScreenshotJob[], timeoutMs = 90_000): Promise<void> {
  if (jobs.length === 0) return;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tilecast-'));
  const args = [
    '--headless',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--hide-scrollbars',
    '--mute-audio',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    'about:blank',
  ];
  // Chrome refuses to start as root without this (common in containers).
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');

  const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);
  const exited = new Promise<never>((_, reject) => {
    const fail = (reason: string) => {
      const error = new Error(`Chrome ${reason}: ${stderr.trim().split('\n').slice(-3).join(' ')}`);
      cdp.failAll(error);
      reject(error);
    };
    child.on('error', (error) => fail(`could not start (${error.message})`));
    child.on('exit', (code) => fail(`exited with code ${code}`));
  });
  exited.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Rendering timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
  });

  const work = async () => {
    for (const [index, job] of jobs.entries()) {
      const file = path.join(dir, `page-${index}.html`);
      await writeFile(file, job.html, 'utf8');
      const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: job.width, height: job.height, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      const loaded = cdp.once('Page.loadEventFired', sessionId);
      await cdp.send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
      await loaded;
      await cdp.send('Runtime.evaluate', { expression: WAIT_UNTIL_READY, awaitPromise: true }, sessionId);
      const { data } = await cdp.send<{ data: string }>(
        'Page.captureScreenshot',
        { format: 'png', clip: { x: 0, y: 0, width: job.width, height: job.height, scale: 1 } },
        sessionId,
      );
      await writeFile(job.outFile, Buffer.from(data, 'base64'));
      await cdp.send('Target.closeTarget', { targetId });
    }
  };

  try {
    await Promise.race([work(), exited, timeout]);
  } finally {
    clearTimeout(timer);
    await Promise.race([cdp.send('Browser.close').catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Renders one HTML document to a PNG of exactly `width` x `height` pixels. */
export function screenshotHtml(chrome: string, html: string, width: number, height: number, outFile: string) {
  return renderScreenshots(chrome, [{ html, width, height, outFile }]);
}

/** Reads width and height from a PNG header. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
