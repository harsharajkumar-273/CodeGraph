import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createFilter } from './filter';
import { indexFiles, type IndexOptions, type IndexResult } from './index-files';

export { indexFiles, type IndexOptions, type IndexResult };

async function walk(root: string, opts: IndexOptions) {
  const read = async (name: string) => {
    try {
      return await fs.readFile(join(root, name), 'utf8');
    } catch {
      return undefined; // no such file
    }
  };
  // `.codegraphignore`: project-specific exclusions that should not affect git, e.g. `fixtures/` or `docs/examples/`
  const filter = createFilter({ gitignore: await read('.gitignore'), codegraphignore: await read('.codegraphignore'), exclude: opts.exclude });
  const sources: string[] = [];
  const configs: string[] = [];
  async function rec(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split(sep).join('/');
      if (e.isDirectory()) {
        if (!filter.ignoresDir(rel)) await rec(abs);
      } else if (e.isFile() && !filter.ignoresFile(rel)) {
        if (filter.isConfig(e.name)) configs.push(rel);
        if (filter.isSource(e.name)) sources.push(rel);
      }
    }
  }
  await rec(root);
  return { sources: sources.sort(), configs: configs.sort() };
}

/** Index an on-disk repository (a local checkout). */
export async function indexRepo(root: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const t0 = Date.now();
  const { sources, configs } = await walk(root, opts);
  const max = opts.maxFileBytes ?? 1_000_000;
  const files = new Map<string, string>();
  let skipped = 0;
  for (const rel of sources) {
    const abs = join(root, rel);
    const st = await fs.stat(abs);
    if (st.size > max) {
      skipped++;
      continue;
    }
    files.set(rel, await fs.readFile(abs, 'utf8'));
  }
  const cfg = new Map<string, string>();
  for (const rel of configs) cfg.set(rel, await fs.readFile(join(root, rel), 'utf8'));
  const res = await indexFiles(files, cfg, root, opts);
  res.stats.skipped = skipped;
  res.stats.ms = Date.now() - t0;
  return res;
}
