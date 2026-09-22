import type { Confidence, EdgeKind, GraphEdge, GraphJSON, GraphNode, NodeKind } from './types';

export const CONFIDENCE_RANK: Record<Confidence, number> = { resolved: 3, probable: 2, ambiguous: 1 };

export function weakest(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function atLeast(c: Confidence, min: Confidence): boolean {
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[min];
}

export const fileId = (path: string) => `file:${path}`;
export const symbolId = (path: string, qname: string) => `sym:${path}#${qname}`;
export const externalId = (pkg: string) => `ext:${pkg}`;
/** One node per (scope, name); `scope` is the enclosing function/method qname, or null for module level. */
export const variableId = (path: string, scope: string | null, name: string) => `var:${path}#${scope ?? '$module'}.${name}`;

/** In-memory directed multigraph with adjacency indexes. */
export class CodeGraph {
  private nodeMap = new Map<string, GraphNode>();
  private edgeMap = new Map<string, GraphEdge>();
  private outIdx = new Map<string, GraphEdge[]>();
  private inIdx = new Map<string, GraphEdge[]>();
  private fileIdx = new Map<string, GraphNode[]>();

  constructor(public root = '.') {}

  addNode(node: GraphNode): GraphNode {
    const existing = this.nodeMap.get(node.id);
    if (existing) return existing;
    this.nodeMap.set(node.id, node);
    if (node.file && node.kind !== 'file' && node.kind !== 'external') {
      const list = this.fileIdx.get(node.file) ?? [];
      list.push(node);
      this.fileIdx.set(node.file, list);
    }
    return node;
  }

  /** Adds an edge; duplicates (same from/to/kind) keep the strongest confidence. */
  addEdge(edge: GraphEdge): void {
    if (edge.from === edge.to && edge.kind !== 'flows') return;
    const key = `${edge.from}|${edge.to}|${edge.kind}`;
    const existing = this.edgeMap.get(key);
    if (existing) {
      if (CONFIDENCE_RANK[edge.confidence] > CONFIDENCE_RANK[existing.confidence]) existing.confidence = edge.confidence;
      return;
    }
    const e = { ...edge };
    this.edgeMap.set(key, e);
    push(this.outIdx, e.from, e);
    push(this.inIdx, e.to, e);
  }

  node(id: string): GraphNode | undefined {
    return this.nodeMap.get(id);
  }
  hasNode(id: string): boolean {
    return this.nodeMap.has(id);
  }
  nodes(kind?: NodeKind | NodeKind[]): GraphNode[] {
    const all = [...this.nodeMap.values()];
    if (!kind) return all;
    const kinds = Array.isArray(kind) ? kind : [kind];
    return all.filter((n) => kinds.includes(n.kind));
  }
  edges(kind?: EdgeKind | EdgeKind[]): GraphEdge[] {
    const all = [...this.edgeMap.values()];
    if (!kind) return all;
    const kinds = Array.isArray(kind) ? kind : [kind];
    return all.filter((e) => kinds.includes(e.kind));
  }
  outgoing(id: string, kinds?: EdgeKind[]): GraphEdge[] {
    const list = this.outIdx.get(id) ?? [];
    return kinds ? list.filter((e) => kinds.includes(e.kind)) : list;
  }
  incoming(id: string, kinds?: EdgeKind[]): GraphEdge[] {
    const list = this.inIdx.get(id) ?? [];
    return kinds ? list.filter((e) => kinds.includes(e.kind)) : list;
  }
  symbolsInFile(path: string): GraphNode[] {
    return this.fileIdx.get(path) ?? [];
  }
  get size() {
    return { nodes: this.nodeMap.size, edges: this.edgeMap.size };
  }

  /** Subgraph induced by a set of node ids. */
  subgraph(ids: Iterable<string>): CodeGraph {
    const keep = new Set(ids);
    const g = new CodeGraph(this.root);
    for (const id of keep) {
      const n = this.nodeMap.get(id);
      if (n) g.addNode(n);
    }
    for (const e of this.edgeMap.values()) if (keep.has(e.from) && keep.has(e.to)) g.addEdge(e);
    return g;
  }

  toJSON(stats?: Record<string, number>): GraphJSON {
    return {
      version: 1,
      root: this.root,
      generatedAt: new Date().toISOString(),
      nodes: [...this.nodeMap.values()],
      edges: [...this.edgeMap.values()],
      stats,
    };
  }

  static fromJSON(json: GraphJSON): CodeGraph {
    const g = new CodeGraph(json.root);
    for (const n of json.nodes) g.addNode(n);
    for (const e of json.edges) g.addEdge(e);
    return g;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}
