import { CodeGraph, atLeast, fileId, type Confidence, type EdgeKind } from '@codegraph/core';

export interface SliceOptions {
  callersDepth?: number; // default 2
  calleesDepth?: number; // default 2
  minConfidence?: Confidence;
}

export type SliceRole = 'seed' | 'caller' | 'callee';

export interface SliceResult {
  graph: CodeGraph;
  roles: Map<string, SliceRole>;
  /** file -> merged 1-based inclusive line ranges of the sliced symbols. */
  ranges: Map<string, [number, number][]>;
}

const KINDS: EdgeKind[] = ['calls', 'extends'];

/** Sub-graph focused on one or more symbols: what they call, and who calls them. */
export function slice(graph: CodeGraph, seedIds: string[], opts: SliceOptions = {}): SliceResult {
  const min = opts.minConfidence ?? 'ambiguous';
  const roles = new Map<string, SliceRole>();
  for (const s of seedIds) if (graph.hasNode(s)) roles.set(s, 'seed');

  const walk = (dir: 'in' | 'out', maxDepth: number, role: SliceRole) => {
    let frontier = [...roles.keys()].filter((k) => roles.get(k) === 'seed');
    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const edges = dir === 'in' ? graph.incoming(id, KINDS) : graph.outgoing(id, KINDS);
        for (const e of edges) {
          if (!atLeast(e.confidence, min)) continue;
          const other = dir === 'in' ? e.from : e.to;
          if (roles.has(other)) continue;
          roles.set(other, role);
          next.push(other);
        }
      }
      frontier = next;
    }
  };
  walk('in', opts.callersDepth ?? 2, 'caller');
  walk('out', opts.calleesDepth ?? 2, 'callee');

  const keep = new Set(roles.keys());
  for (const id of [...keep]) {
    const f = graph.node(id)?.file;
    if (f) keep.add(fileId(f));
  }
  const sub = graph.subgraph(keep);

  const raw = new Map<string, [number, number][]>();
  for (const id of roles.keys()) {
    const n = graph.node(id);
    if (!n?.file || n.kind === 'file' || n.kind === 'external' || !n.startLine || !n.endLine) continue;
    const l = raw.get(n.file) ?? [];
    l.push([n.startLine, n.endLine]);
    raw.set(n.file, l);
  }
  const ranges = new Map<string, [number, number][]>();
  for (const [f, rs] of raw) {
    rs.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of rs) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    ranges.set(f, merged);
  }
  return { graph: sub, roles, ranges };
}
