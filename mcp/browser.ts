import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

/**
 * Headless Chrome driven over the DevTools protocol (--remote-debugging-pipe),
 * so the MCP server needs no browser library. One browser stays warm between
 * tool calls, which keeps previews fast.
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
    for (const build of builds) for (const parts of PLAYWRIGHT_EXECUTABLES) found.push(path.join(root, build, ...parts));
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
  'No Chrome, Chromium or Edge found for rendering. Install Google Chrome, or run `npx playwright install chromium`, ' +
  'or point the TILECAST_CHROME environment variable at a Chromium-based browser.';

type Json = Record<string, unknown>;

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Json;
  sessionId?: string;
  result?: Json;
  error?: { message: string };
}

/** Minimal DevTools protocol client over NUL-separated JSON pipes. */
class Cdp {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private listeners = new Set<(message: CdpMessage) => void>();

  constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    // A pipe error (Chrome crashed or quit) must not take the MCP server down;
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
          // Ignore a malformed message; the request it answers will time out.
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

  send<T = Json>(method: string, params: Json = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    this.input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: Json) => void, reject });
    });
  }

  listen(listener: (message: CdpMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  failAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s.`)), ms);
    }),
  ]);
}

export interface Viewport {
  width: number;
  height: number;
  /** Device pixel ratio: output pixels per CSS pixel. */
  scale?: number;
}

export class Page {
  /** Errors thrown by the page's own scripts, for the check report. */
  readonly errors: string[] = [];
  private unlisten: () => void;

  constructor(
    private readonly cdp: Cdp,
    readonly targetId: string,
    readonly sessionId: string,
  ) {
    this.unlisten = cdp.listen((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.exceptionThrown') {
        const details = (message.params?.exceptionDetails ?? {}) as { exception?: { description?: string }; text?: string };
        this.errors.push((details.exception?.description ?? details.text ?? 'Script error').split('\n')[0]);
      }
    });
  }

  send<T = Json>(method: string, params: Json = {}): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId);
  }

  async setViewport({ width, height, scale = 1 }: Viewport) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  }

  /** Runs `source` in every document this page loads, before the page's own scripts. */
  async addInitScript(source: string) {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async goto(url: string, timeoutMs = 30_000) {
    const loaded = new Promise<void>((resolve) => {
      const stop = this.cdp.listen((message) => {
        if (message.sessionId === this.sessionId && message.method === 'Page.loadEventFired') {
          stop();
          resolve();
        }
      });
    });
    const result = await this.send<{ errorText?: string }>('Page.navigate', { url });
    if (result.errorText) throw new Error(`Cannot open ${url}: ${result.errorText}`);
    await withTimeout(loaded, timeoutMs, `Loading ${path.basename(url)}`);
  }

  async evaluate<T>(expression: string, timeoutMs = 60_000): Promise<T> {
    const response = await withTimeout(
      this.send<{ result: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
      ),
      timeoutMs,
      'Page script',
    );
    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error((details.exception?.description ?? details.text ?? 'Evaluation failed').split('\n')[0]);
    }
    return response.result.value as T;
  }

  async screenshot(options: {
    format?: 'png' | 'jpeg';
    quality?: number;
    clip: { x: number; y: number; width: number; height: number; scale: number };
  }): Promise<Buffer> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: options.format ?? 'png',
      ...(options.format === 'jpeg' ? { quality: options.quality ?? 92 } : {}),
      clip: options.clip,
      captureBeyondViewport: false,
    });
    return Buffer.from(data, 'base64');
  }

  async pdf(params: Json): Promise<Buffer> {
    const { data } = await this.send<{ data: string }>('Page.printToPDF', params);
    return Buffer.from(data, 'base64');
  }

  async close() {
    this.unlisten();
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }
}

export class Browser {
  private closed = false;
  private readonly exited: Promise<never>;

  private constructor(
    private readonly child: ChildProcess,
    private readonly cdp: Cdp,
    private readonly profileDir: string,
  ) {
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    this.exited = new Promise<never>((_, reject) => {
      const fail = (reason: string) => {
        const error = new Error(`Chrome ${reason}: ${stderr.trim().split('\n').slice(-2).join(' ')}`);
        this.closed = true;
        cdp.failAll(error);
        reject(error);
      };
      child.on('error', (error) => fail(`could not start (${error.message})`));
      child.on('exit', (code) => fail(`exited with code ${code}`));
    });
    this.exited.catch(() => undefined);
  }

  static async launch(executable: string, extraArgs: string[] = []): Promise<Browser> {
    const profileDir = await mkdtemp(path.join(os.tmpdir(), 'tilecast-chrome-'));
    const args = [
      '--headless',
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      // Renders never need Google services: no component updates, sync, safe browsing pings or metrics.
      '--disable-component-update',
      '--disable-client-side-phishing-detection',
      '--disable-domain-reliability',
      '--disable-sync',
      '--disable-default-apps',
      '--metrics-recording-only',
      '--no-pings',
      '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CertificateTransparencyComponentUpdater,AutofillServerCommunication,InterestFeedContentSuggestions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--hide-scrollbars',
      '--mute-audio',
      '--font-render-hinting=none',
      '--allow-file-access-from-files',
      `--user-data-dir=${profileDir}`,
      ...extraArgs,
      'about:blank',
    ];
    // Chrome refuses to start as root without this (common in containers).
    if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);
    const browser = new Browser(child, cdp, profileDir);
    await Promise.race([withTimeout(cdp.send('Browser.getVersion'), 30_000, 'Starting Chrome'), browser.exited]);
    return browser;
  }

  get alive(): boolean {
    return !this.closed;
  }

  async newPage(viewport: Viewport): Promise<Page> {
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.cdp, targetId, sessionId);
    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable')]);
    await page.setViewport(viewport);
    await page.send('Emulation.setEmulatedMedia', { media: 'screen' });
    return page;
  }

  async close() {
    if (!this.closed) {
      this.closed = true;
      await Promise.race([this.cdp.send('Browser.close').catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }
    await rm(this.profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Keeps one browser warm between tool calls and closes it after a quiet minute. */
export class BrowserPool {
  private browser: Promise<Browser> | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private active = 0;

  constructor(
    private readonly executable: () => string | null,
    private readonly idleMs = 60_000,
  ) {}

  async use<T>(work: (browser: Browser) => Promise<T>): Promise<T> {
    const executable = this.executable();
    if (!executable) throw new Error(CHROME_MISSING);
    clearTimeout(this.idleTimer);
    this.active++;
    try {
      let browser = await (this.browser ??= Browser.launch(executable));
      if (!browser.alive) {
        this.browser = Browser.launch(executable);
        browser = await this.browser;
      }
      return await work(browser);
    } catch (error) {
      // A failed launch must not stick: the next call starts a fresh browser.
      const current = this.browser;
      if (current) {
        const browser = await current.catch(() => null);
        if (!browser?.alive) this.browser = null;
      }
      throw error;
    } finally {
      this.active--;
      if (this.active === 0) {
        this.idleTimer = setTimeout(() => void this.shutdown(), this.idleMs);
        this.idleTimer.unref();
      }
    }
  }

  /**
   * The warm browser plus `count - 1` extra browser processes for heavy parallel
   * work. Tabs of one browser share its compositor, so capturing video frames
   * scales with processes, not tabs. The extras close when the work is done.
   */
  async useMany<T>(count: number, work: (browsers: Browser[]) => Promise<T>): Promise<T> {
    return this.use(async (main) => {
      const executable = this.executable()!;
      const extras = await Promise.all(
        Array.from({ length: Math.max(0, count - 1) }, () => Browser.launch(executable).catch(() => null)),
      );
      const browsers = [main, ...extras.filter((b): b is Browser => b !== null)];
      try {
        return await work(browsers);
      } finally {
        await Promise.all(browsers.slice(1).map((b) => b.close()));
      }
    });
  }

  async shutdown() {
    clearTimeout(this.idleTimer);
    const current = this.browser;
    this.browser = null;
    const browser = await current?.catch(() => null);
    await browser?.close();
  }
}
