import type { CodeGraph, Confidence, GraphNode } from '@codegraph/core';
import { importCycles, isTestPath } from '@codegraph/analysis';

export interface Overview {
  files: number;
  symbols: number;
  calls: number;
  conf: Record<Confidence, number>;
  /** Functions and classes with the most distinct callers (outside tests): the riskiest things to change. */
  mostCalled: { node: GraphNode; callers: number }[];
  /** Files imported by the most other files (outside tests). */
  hubs: { node: GraphNode; importedBy: number }[];
  languages: { name: string; files: number }[];
  testFiles: number;
  cycles: string[][];
}

const LANG_NAME: Record<string, string> = { typescript: 'TypeScript', tsx: 'TypeScript', javascript: 'JavaScript', python: 'Python' };

export function computeOverview(graph: CodeGraph): Overview {
  const files = graph.nodes('file');
  const symbols = graph.nodes(['function', 'method', 'class']);
  const calls = graph.edges('calls');
  const conf: Record<Confidence, number> = { resolved: 0, probable: 0, ambiguous: 0 };
  for (const e of calls) conf[e.confidence]++;

  const mostCalled = symbols
    .filter((s) => s.file && !isTestPath(s.file))
    .map((node) => {
      const callers = new Set<string>();
      for (const e of graph.incoming(node.id, ['calls'])) {
        if (e.confidence === 'ambiguous') continue;
        const from = graph.node(e.from);
        if (from?.file && !isTestPath(from.file)) callers.add(e.from);
      }
      return { node, callers: callers.size };
    })
    .filter((x) => x.callers > 0)
    .sort((a, b) => b.callers - a.callers || (a.node.qualifiedName ?? '').localeCompare(b.node.qualifiedName ?? ''))
    .slice(0, 8);

  const hubs = files
    .filter((f) => !isTestPath(f.file!))
    .map((node) => ({ node, importedBy: new Set(graph.incoming(node.id, ['imports']).filter((e) => !isTestPath(graph.node(e.from)?.file ?? '')).map((e) => e.from)).size }))
    .filter((x) => x.importedBy > 1)
    .sort((a, b) => b.importedBy - a.importedBy || a.node.file!.localeCompare(b.node.file!))
    .slice(0, 6);

  const byLang = new Map<string, number>();
  for (const f of files) {
    const name = LANG_NAME[f.lang ?? ''] ?? 'Other';
    byLang.set(name, (byLang.get(name) ?? 0) + 1);
  }
  const languages = [...byLang].map(([name, n]) => ({ name, files: n })).sort((a, b) => b.files - a.files);

  return { files: files.length, symbols: symbols.length, calls: calls.length, conf, mostCalled, hubs, languages, testFiles: files.filter((f) => isTestPath(f.file!)).length, cycles: importCycles(graph) };
}
