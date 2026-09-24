import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeDesign } from '../src/model/sanitize';
import type { Design } from '../src/model/types';

export interface StoredDesign {
  id: string;
  createdAt: string;
  updatedAt: string;
  design: Design;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SUFFIX = '.tilecast.json';

/** Designs live as JSON files in `<project>/tilecast/`, next to the exports, so they can be committed. */
export class DesignStore {
  readonly dir: string;

  constructor(readonly root: string) {
    this.dir = path.join(root, 'tilecast');
  }

  file(id: string): string {
    if (!ID.test(id)) throw new Error(`Invalid design id "${id}". Use lowercase letters, digits and dashes.`);
    return path.join(this.dir, `${id}${SUFFIX}`);
  }

  relative(file: string): string {
    return path.relative(this.root, file) || '.';
  }

  async load(id: string): Promise<StoredDesign> {
    const file = this.file(id);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      const known = (await this.list()).map((d) => d.id);
      throw new Error(`No design "${id}". ${known.length ? `Existing designs: ${known.join(', ')}.` : 'Create one with create_design.'}`);
    }
    return this.parse(id, raw);
  }

  private parse(id: string, raw: string): StoredDesign {
    const data = JSON.parse(raw) as Partial<StoredDesign>;
    const design = sanitizeDesign(data.design);
    if (!design) throw new Error(`Design file for "${id}" is damaged: it has no usable tiles.`);
    const now = new Date().toISOString();
    return { id, createdAt: data.createdAt ?? now, updatedAt: data.updatedAt ?? now, design };
  }

  async save(entry: StoredDesign): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(entry.id);
    await writeFile(file, `${JSON.stringify({ version: 1, ...entry }, null, 2)}\n`, 'utf8');
    return file;
  }

  async list(): Promise<StoredDesign[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith(SUFFIX) && ID.test(name.slice(0, -SUFFIX.length)))
        .map(async (name) => {
          try {
            const id = name.slice(0, -SUFFIX.length);
            return this.parse(id, await readFile(path.join(this.dir, name), 'utf8'));
          } catch {
            return null;
          }
        }),
    );
    return entries
      .filter((e): e is StoredDesign => e !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** `base`, or `base-2`, `base-3`… if that id is taken. */
  async freeId(base: string): Promise<string> {
    const taken = new Set(
      (await readdir(this.dir).catch(() => [] as string[])).map((name) => name.replace(SUFFIX, '')),
    );
    const stem = base.slice(0, 56).replace(/-+$/, '') || 'design';
    if (!taken.has(stem)) return stem;
    for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}`)) return `${stem}-${i}`;
  }
}
