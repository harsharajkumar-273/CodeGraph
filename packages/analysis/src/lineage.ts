import type { CodeGraph } from '@codegraph/core';

export interface LineageHop {
  id: string;
  depth: number;
}

export interface LineageResult {
  target: string;
  /** Variables whose value this one was (partly) built from, nearest first. */
  upstream: LineageHop[];
  /** Variables this one's value flows into, nearest first. */
  downstream: LineageHop[];
  subgraph: CodeGraph;
}

/**
 * Traces one variable's dataflow: what fed it, and what it feeds.
 * Stage 1 is intra-procedural — `flows` edges never cross a function boundary, so this never
 * leaves the variable's own scope. A self-loop (`x += 1`) counts as evidence the variable
 * carries forward across reassignment, not as a separate upstream/downstream hop.
 */
export function variableLineage(graph: CodeGraph, id: string, opts: { maxDepth?: number } = {}): LineageResult {
  const maxDepth = opts.maxDepth ?? 10;
  const bfs = (dir: 'in' | 'out'): LineageHop[] => {
    const seen = new Map<string, number>([[id, 0]]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      const d = seen.get(cur)!;
      if (d >= maxDepth) continue;
      const edges = dir === 'in' ? graph.incoming(cur, ['flows']) : graph.outgoing(cur, ['flows']);
      for (const e of edges) {
        const other = dir === 'in' ? e.from : e.to;
        if (other === cur || seen.has(other)) continue;
        seen.set(other, d + 1);
        queue.push(other);
      }
    }
    seen.delete(id);
    return [...seen].map(([nid, depth]) => ({ id: nid, depth })).sort((a, b) => a.depth - b.depth);
  };
  const upstream = bfs('in');
  const downstream = bfs('out');
  const keep = new Set([id, ...upstream.map((u) => u.id), ...downstream.map((d) => d.id)]);
  return { target: id, upstream, downstream, subgraph: graph.subgraph(keep) };
}
