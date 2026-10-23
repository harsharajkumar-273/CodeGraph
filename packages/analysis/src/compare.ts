import type { CodeGraph, GraphNode } from '@codegraph/core';

/** A symbol the base had and the change removed, and a caller that survives and still calls a name that no longer resolves. */
export interface DanglingCall {
  /** The removed symbol, as it was in the base. */
  removed: GraphNode;
  /** The caller in the new version (a symbol, or a file for top-level code). */
  caller: GraphNode;
  /** The line in the new version where the unresolved call is made. */
  line: number;
}

const key = (n: GraphNode) => (n.kind === 'file' ? n.file! : `${n.file}#${n.qualifiedName}`);

/**
 * Symbols that exist in `base` but not in `head`, which `head` still seems to call.
 *
 * `headUnresolved` maps a caller in the new version (`file#qualified.name`, or just `file` for top-level code) to the call
 * sites there that resolved to nothing, as `name -> line`. A removed function is reported against a caller that existed in
 * the base calling it, still exists, and still makes a call of that name that resolves to nothing: the shape of a rename
 * or removal whose callers were not all updated. A call that now resolves somewhere else is not reported, and neither is a
 * name the caller already called without resolving in the base (`m.get()` on an external map): that call says nothing about
 * the removed function. `baseUnresolved` is the same map for the base.
 */
export function removedButStillCalled(
  base: CodeGraph,
  head: CodeGraph,
  headUnresolved: Map<string, Map<string, number>>,
  baseUnresolved: Map<string, Map<string, number>> = new Map(),
): DanglingCall[] {
  const inHead = new Set(head.nodes(['function', 'method', 'class', 'file']).map(key));
  const out: DanglingCall[] = [];
  for (const removed of base.nodes(['function', 'method', 'class'])) {
    if (inHead.has(key(removed))) continue;
    for (const e of base.incoming(removed.id, ['calls'])) {
      const callerBase = base.node(e.from);
      if (!callerBase || !inHead.has(key(callerBase))) continue; // the caller was removed too
      if (baseUnresolved.get(key(callerBase))?.has(removed.name)) continue;
      const line = headUnresolved.get(key(callerBase))?.get(removed.name);
      if (line !== undefined) out.push({ removed, caller: callerBase, line });
    }
  }
  return out.sort((a, b) => key(a.removed).localeCompare(key(b.removed)) || key(a.caller).localeCompare(key(b.caller)));
}
