import { promises as fs } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import ignore from 'ignore';
import type { CodeGraph } from '@codegraph/core';
import { SUPPORTED_EXTENSIONS } from '@codegraph/parser';
import { extractFile } from './extract';
import { buildGraph, type BuildStats } from './resolve';
import type { FileFacts } from './types';

export interface IndexOptions {
  /** Extra gitignore-style patterns to skip. */
  exclude?: string[];
  maxFileBytes?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface IndexResult {
  graph: CodeGraph;
  stats: BuildStats & { skipped: number; parseErrors: number; ms: number };
  warnings: string[];
}

const DEFAULT_IGNORES = [
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.venv', 'venv', 'env', '__pycache__',
  'coverage', '.tox', 'target', 'vendor', '.cache', '.codegraph', '.turbo', '*.timestamp-*.mjs', '*.min.js', '*.d.ts', '*.map', '*.bundle.js',
];
const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json']);

async function walk(root: string, opts: IndexOptions) {
  const ig = ignore().add(DEFAULT_IGNORES).add(opts.exclude ?? []);
  try {
    ig.add(await fs.readFile(join(root, '.gitignore'), 'utf8'));
  } catch {
    /* no .gitignore */
  }
  try {
    // project-specific exclusions that should not affect git, e.g. `fixtures/` or `docs/examples/`
    ig.add(await fs.readFile(join(root, '.codegraphignore'), 'utf8'));
  } catch {
    /* no .codegraphignore */
  }
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
        if (!ig.ignores(rel + '/')) await rec(abs);
      } else if (e.isFile() && !ig.ignores(rel)) {
        if (CONFIG_NAMES.has(e.name)) configs.push(rel);
        const dot = e.name.lastIndexOf('.');
        if (dot >= 0 && SUPPORTED_EXTENSIONS.includes(e.name.slice(dot).toLowerCase())) sources.push(rel);
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

/** Index an in-memory set of files (used by tests and browser-side demos). */
export async function indexFiles(
  files: Map<string, string> | Record<string, string>,
  configs: Map<string, string> | Record<string, string> = new Map(),
  root = '.',
  opts: IndexOptions = {},
): Promise<IndexResult> {
  const t0 = Date.now();
  const fm = files instanceof Map ? files : new Map(Object.entries(files));
  const cm = configs instanceof Map ? configs : new Map(Object.entries(configs));
  const facts: FileFacts[] = [];
  const warnings: string[] = [];
  let parseErrors = 0;
  let done = 0;
  for (const [path, src] of fm) {
    try {
      const f = await extractFile(posix.normalize(path), src);
      if (f) facts.push(f);
    } catch (e) {
      parseErrors++;
      warnings.push(`${path}: ${(e as Error).message}`);
    }
    opts.onProgress?.(++done, fm.size);
  }
  const { graph, stats } = buildGraph(facts, cm, root);
  return { graph, stats: { ...stats, skipped: 0, parseErrors, ms: Date.now() - t0 }, warnings };
}
