import { CodeGraph, type GraphJSON } from '@codegraph/core';
import { runIndex } from './engine/run-index';
import { computeOverview, type Overview } from './overview';
import type { LoadProgress, LoadedSource } from './sources/types';

/** A repository that has been analyzed and is shown in the workspace. */
export interface Session {
  graph: CodeGraph;
  label: string;
  detail?: string;
  origin: LoadedSource['origin'] | { kind: 'graph' } | { kind: 'cli' };
  /** Source text by path, when the repository was read here (not for an opened graph.json). */
  files?: Map<string, string>;
  notes: string[];
  overview: Overview;
  /** How long indexing took, in ms. */
  ms?: number;
}

const rootName = (root: string) => root.replace(/\/+$/, '').split('/').pop() || 'project';

/** Index a loaded repository in a worker and wrap the result. */
export async function analyze(source: LoadedSource, opts: { signal?: AbortSignal; onProgress?: (p: LoadProgress) => void } = {}): Promise<Session> {
  const t0 = performance.now();
  const total = source.files.size;
  opts.onProgress?.({ phase: 'index', done: 0, total, message: 'Parsing code…' });
  const out = await runIndex(
    { files: source.files, configs: source.configs, root: source.label },
    { signal: opts.signal, onProgress: (done, t) => opts.onProgress?.({ phase: 'index', done, total: t, message: done >= t ? 'Linking calls…' : 'Parsing code…' }) },
  );
  const notes = [...source.notes];
  if (out.parseErrors) notes.push(`${out.parseErrors} file${out.parseErrors === 1 ? '' : 's'} could not be parsed and ${out.parseErrors === 1 ? 'was' : 'were'} left out.`);
  const graph = CodeGraph.fromJSON(out.graph);
  return { graph, label: source.label, detail: source.detail, origin: source.origin, files: source.files, notes, overview: computeOverview(graph), ms: Math.round(performance.now() - t0) };
}

/** A graph that was indexed elsewhere: a graph.json file, or the CLI's `serve` API. */
export function sessionFromGraph(json: GraphJSON, origin: 'graph' | 'cli', name?: string): Session {
  const graph = CodeGraph.fromJSON(json);
  const ms = (json.stats as Record<string, number> | undefined)?.ms;
  return { graph, label: name ?? rootName(json.root), detail: origin === 'cli' ? 'served by the CLI' : 'from graph.json', origin: { kind: origin }, notes: [], overview: computeOverview(graph), ms };
}
