import { CONFIDENCE_RANK, CodeGraph, atLeast, fileId, weakest, type Confidence, type EdgeKind, type GraphNode } from '@codegraph/core';

export interface ImpactOptions {
  /** Max hops from the changed node (default 6). */
  maxDepth?: number;
  /** Ignore edges weaker than this (default `ambiguous` = keep everything). */
  minConfidence?: Confidence;
  /** Also report files that import the changed files (default true). */
  includeImporters?: boolean;
}

export interface ImpactedNode {
  id: string;
  depth: number;
  /** Weakest edge on the strongest path from the change to this node. */
  confidence: Confidence;
  /** Node one hop closer to the change. */
  via?: string;
}

export interface ImpactResult {
  seeds: string[];
  impacted: ImpactedNode[];
  /** Files containing impacted symbols, plus direct importers of changed files. */
  files: { path: string; depth: number; confidence: Confidence }[];
  /** Test files that contain impacted code or directly import impacted files (heuristic by path). */
  tests: string[];
  /** Test files that only reach the change through a longer chain of imports (2-3 hops). */
  testsTransitive: string[];
  /** Induced subgraph of seeds + impacted nodes (+ their files). */
  subgraph: CodeGraph;
}

const REVERSE_KINDS: EdgeKind[] = ['calls', 'extends'];
const TEST_RE = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/;

export const isTestPath = (p: string) => TEST_RE.test(p);

function better(c: Confidence, d: number, cur?: { conf: Confidence; depth: number }) {
  if (!cur) return true;
  const a = CONFIDENCE_RANK[c];
  const b = CONFIDENCE_RANK[cur.conf];
  return a > b || (a === b && d < cur.depth);
}

/** Who breaks if `seeds` change? Reverse-reachability over call/extends edges, confidence-aware. */
export function blastRadius(graph: CodeGraph, seedIds: string[], opts: ImpactOptions = {}): ImpactResult {
  const maxDepth = opts.maxDepth ?? 6;
  const min = opts.minConfidence ?? 'ambiguous';
  const state = new Map<string, { conf: Confidence; depth: number; via?: string }>();
  const queue: string[] = [];

  // Expand file seeds to every symbol they define (a file change may touch any of them).
  const seeds = new Set<string>();
  for (const id of seedIds) {
    const n = graph.node(id);
    if (!n) continue;
    seeds.add(id);
    if (n.kind === 'file' && n.file) for (const s of graph.symbolsInFile(n.file)) seeds.add(s.id);
  }
  for (const s of seeds) {
    state.set(s, { conf: 'resolved', depth: 0 });
    queue.push(s);
  }

  while (queue.length) {
    const id = queue.shift()!;
    const cur = state.get(id)!;
    if (cur.depth >= maxDepth) continue;
    for (const e of graph.incoming(id, REVERSE_KINDS)) {
      if (!atLeast(e.confidence, min)) continue;
      const conf = weakest(cur.conf, e.confidence);
      const depth = cur.depth + 1;
      if (better(conf, depth, state.get(e.from))) {
        if (seeds.has(e.from)) continue;
        state.set(e.from, { conf, depth, via: id });
        queue.push(e.from);
      }
    }
  }

  const impacted: ImpactedNode[] = [];
  for (const [id, s] of state) if (!seeds.has(id)) impacted.push({ id, depth: s.depth, confidence: s.conf, via: s.via });
  impacted.sort((a, b) => a.depth - b.depth || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.id.localeCompare(b.id));

  // Files
  const fileMap = new Map<string, { depth: number; confidence: Confidence }>();
  const seedFiles = new Set<string>();
  for (const s of seeds) {
    const f = graph.node(s)?.file;
    if (f) seedFiles.add(f);
  }
  for (const i of impacted) {
    const f = graph.node(i.id)?.file;
    if (f && !seedFiles.has(f)) {
      const cur = fileMap.get(f);
      if (!cur || better(i.confidence, i.depth, { conf: cur.confidence, depth: cur.depth })) fileMap.set(f, { depth: i.depth, confidence: i.confidence });
    }
  }
  const importerClosure = new Map<string, number>();
  if (opts.includeImporters !== false) {
    // reverse import BFS from changed files (direct importers are reported as files; deeper ones only feed test detection)
    let frontier = [...seedFiles];
    for (let d = 1; d <= 3 && frontier.length; d++) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const e of graph.incoming(fileId(f), ['imports'])) {
          const path = graph.node(e.from)?.file;
          if (!path || seedFiles.has(path) || importerClosure.has(path)) continue;
          importerClosure.set(path, d);
          next.push(path);
          if (d === 1 && !fileMap.has(path)) fileMap.set(path, { depth: 1, confidence: 'probable' });
        }
      }
      frontier = next;
    }
  }
  const files = [...fileMap].map(([path, v]) => ({ path, ...v })).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));

  // Tests: (1) test files holding impacted code, (2) test files importing a file that holds changed/impacted code,
  // (3) everything else reachable through 2-3 import hops is reported separately as "transitive".
  const codeFiles = new Set<string>(seedFiles);
  for (const i of impacted) {
    const f = graph.node(i.id)?.file;
    if (f) codeFiles.add(f);
  }
  const testSet = new Set<string>();
  for (const f of codeFiles) {
    if (isTestPath(f)) testSet.add(f);
    for (const e of graph.incoming(fileId(f), ['imports'])) {
      const path = graph.node(e.from)?.file;
      if (path && isTestPath(path)) testSet.add(path);
    }
  }
  const transitive = new Set<string>();
  for (const f of importerClosure.keys()) if (isTestPath(f) && !testSet.has(f)) transitive.add(f);

  const keep = new Set<string>([...seeds, ...impacted.map((i) => i.id)]);
  for (const id of [...keep]) {
    const f = graph.node(id)?.file;
    if (f) keep.add(fileId(f));
  }
  return { seeds: [...seeds], impacted, files, tests: [...testSet].sort(), testsTransitive: [...transitive].sort(), subgraph: graph.subgraph(keep) };
}

export function summarizeImpact(graph: CodeGraph, r: ImpactResult) {
  const byConf = { resolved: 0, probable: 0, ambiguous: 0 } as Record<Confidence, number>;
  for (const i of r.impacted) byConf[i.confidence]++;
  const label = (n?: GraphNode) => (n ? `${n.file ?? ''}${n.kind === 'file' ? '' : '#' + n.qualifiedName}` : '?');
  return { changed: r.seeds.map((s) => label(graph.node(s))), impactedSymbols: r.impacted.length, byConfidence: byConf, files: r.files.length, tests: r.tests.length, testsTransitive: r.testsTransitive.length };
}
