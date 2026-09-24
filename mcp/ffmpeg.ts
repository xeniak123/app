import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Video encoding goes through ffmpeg: the one on PATH, $TILECAST_FFMPEG, or a
 * static build fetched once from npm (@ffmpeg-installer) into a cache folder.
 */

const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.TILECAST_CACHE || (env.CLAUDE_PLUGIN_DATA ? path.join(env.CLAUDE_PLUGIN_DATA, 'cache') : path.join(os.homedir(), '.cache', 'tilecast'));
}

const npmPackage = () => `@ffmpeg-installer/${process.platform}-${process.arch}`;
const cachedBinary = (env?: NodeJS.ProcessEnv) => path.join(cacheDir(env), 'ffmpeg', 'node_modules', ...npmPackage().split('/'), EXE);

export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = [env.TILECAST_FFMPEG, env.FFMPEG_PATH, env.FFMPEG_BIN].filter(Boolean) as string[];
  const onPath = (env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, EXE));
  const common = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const candidate of [...explicit, ...onPath, ...common, cachedBinary(env)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function run(command: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.cmd$/i.test(command),
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timed out.`));
    }, options.timeoutMs ?? 600_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(command)} failed (exit ${code}): ${output.trim().split('\n').slice(-4).join(' | ')}`));
    });
  });
}

/** Returns an ffmpeg executable, downloading a static build from npm if none is installed. */
export async function ensureFfmpeg(): Promise<{ path: string; installed: boolean }> {
  const found = findFfmpeg();
  if (found) return { path: found, installed: false };
  if (process.env.TILECAST_NO_DOWNLOAD) {
    throw new Error('ffmpeg is not installed. Install it (e.g. `brew install ffmpeg` or `apt install ffmpeg`) or set TILECAST_FFMPEG.');
  }
  const dir = path.join(cacheDir(), 'ffmpeg');
  await mkdir(dir, { recursive: true });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    await run(npm, ['install', '--prefix', dir, '--no-save', '--no-audit', '--no-fund', '--no-package-lock', npmPackage()], { timeoutMs: 300_000 });
  } catch (error) {
    throw new Error(
      `ffmpeg is not installed and downloading ${npmPackage()} from npm failed (${(error as Error).message}). ` +
        'Install ffmpeg (e.g. `brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`) or set TILECAST_FFMPEG.',
    );
  }
  const binary = cachedBinary();
  if (!existsSync(binary)) throw new Error(`Downloaded ${npmPackage()} but found no ffmpeg in it. Install ffmpeg and retry.`);
  return { path: binary, installed: true };
}
