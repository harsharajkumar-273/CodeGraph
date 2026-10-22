import type { CodeGraph } from '@codegraph/core';
import { extractFile } from './extract';
import * as posix from './posix';
import { buildGraph, type BuildStats, type CallTrace } from './resolve';
import type { FileFacts } from './types';

export interface IndexOptions {
  /** Extra gitignore-style patterns to skip. */
  exclude?: string[];
  maxFileBytes?: number;
  onProgress?: (done: number, total: number) => void;
  /** Receives the resolver's verdict for every call site (the graph itself dedups edges per caller/callee pair). */
  trace?: (t: CallTrace) => void;
}

export interface IndexResult {
  graph: CodeGraph;
  stats: BuildStats & { skipped: number; parseErrors: number; ms: number };
  warnings: string[];
}

/** Index an in-memory set of files (tests, and the browser app). No file system access. */
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
  const { graph, stats } = buildGraph(facts, cm, root, opts.trace);
  return { graph, stats: { ...stats, skipped: 0, parseErrors, ms: Date.now() - t0 }, warnings };
}
