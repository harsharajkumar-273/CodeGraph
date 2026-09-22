/** Granularity levels of the graph. */
export type NodeKind = 'file' | 'function' | 'method' | 'class' | 'variable' | 'external';

/**
 * imports  : file -> file | external            (module dependency)
 * defines  : file -> symbol, class -> method    (containment)
 * calls    : file|symbol -> symbol              (call graph)
 * extends  : class -> class                     (inheritance)
 * flows    : variable def -> variable use       (reserved for def-use chains)
 */
export type EdgeKind = 'imports' | 'defines' | 'calls' | 'extends' | 'flows';

/**
 * How sure the resolver is about an edge.
 * resolved  : proven through imports / scope (e.g. `import {a} from './a'; a()`)
 * probable  : name-based match with exactly one candidate near the caller
 * ambiguous : name-based match with several candidates
 */
export type Confidence = 'resolved' | 'probable' | 'ambiguous';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName?: string;
  file?: string;
  lang?: string;
  startLine?: number; // 1-based, inclusive
  endLine?: number;
  exported?: boolean;
  parent?: string; // id of containing class/file
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  confidence: Confidence;
  line?: number;
  /** Import edge from a `TYPE_CHECKING`-guarded import (Python) — erased at runtime, so not a real dependency. */
  typeOnly?: boolean;
}

export interface GraphJSON {
  version: 1;
  root: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats?: Record<string, number>;
}
