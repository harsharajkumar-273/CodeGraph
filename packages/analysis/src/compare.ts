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

/** A place in the new version where a function is called, with how many arguments it passes (undefined when a spread hides it). */
export interface CallSite {
  caller: string;
  file: string;
  line: number;
  argc?: number;
}

/** A function the change kept but whose parameters changed in a way existing callers can trip over. */
export interface SignatureChange {
  /** The function in the new version. */
  symbol: GraphNode;
  before: { min: number; max: number | null };
  after: { min: number; max: number | null };
  /** `requires-more`: calls passing the old number of arguments now pass too few. `accepts-fewer`: they now pass too many. */
  kind: ('requires-more' | 'accepts-fewer')[];
  /** Calls in the new version. */
  callers: number;
  /** Calls whose argument count no longer fits (known only when call sites were supplied). */
  violating: CallSite[];
  /** Calls whose argument count could not be read (a spread), so they may or may not fit. */
  unchecked: number;
}

/**
 * Functions present in both versions whose accepted argument counts changed. Only counts are compared (names and types
 * are not), so a swap of two parameters or a changed type is invisible here.
 *
 * With `sites` (the new version's calls, by `file#name` of the function called) each call is checked against the new
 * counts, and a change that every call already satisfies is dropped when the function is not exported: the callers were
 * updated together with it. An exported function stays listed, because code outside the repository may still use it.
 */
export function changedSignatures(base: CodeGraph, head: CodeGraph, sites?: Map<string, CallSite[]>): SignatureChange[] {
  const before = new Map<string, GraphNode>();
  for (const n of base.nodes(['function', 'method'])) if (n.arity) before.set(key(n), n);
  const out: SignatureChange[] = [];
  for (const n of head.nodes(['function', 'method'])) {
    const b = before.get(key(n));
    if (!b?.arity || !n.arity) continue;
    const kind: SignatureChange['kind'] = [];
    if (n.arity.min > b.arity.min) kind.push('requires-more');
    if (n.arity.max !== null && (b.arity.max === null || b.arity.max > n.arity.max)) kind.push('accepts-fewer');
    if (!kind.length) continue;
    const calls = sites?.get(key(n)) ?? [];
    const violating = calls.filter((s) => s.argc !== undefined && (s.argc < n.arity!.min || (n.arity!.max !== null && s.argc > n.arity!.max)));
    const unchecked = calls.filter((s) => s.argc === undefined).length;
    if (sites && !violating.length && !unchecked && !n.exported) continue;
    out.push({ symbol: n, before: b.arity, after: n.arity, kind, callers: sites ? calls.length : head.incoming(n.id, ['calls']).length, violating, unchecked });
  }
  return out.sort((a, b) => b.violating.length - a.violating.length || b.callers - a.callers || key(a.symbol).localeCompare(key(b.symbol)));
}

/**
 * Exported symbols the change removes. Callers inside the repository are the business of `removedButStillCalled`; these
 * are the ones that outside code may use. Test files and `_private` names are not public API and are left out, and so is a
 * symbol that reappears under the same name in another file: that is a move, not a removal.
 */
export function removedPublicApi(base: CodeGraph, head: CodeGraph): GraphNode[] {
  const inHead = new Set(head.nodes(['function', 'method', 'class']).map(key));
  const reappears = new Set(head.nodes(['function', 'method', 'class']).map((n) => `${n.kind}:${n.qualifiedName ?? n.name}`));
  const isTest = (f?: string) => !!f && /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/.test(f);
  return base
    .nodes(['function', 'method', 'class'])
    .filter((n) => n.exported && !inHead.has(key(n)) && !reappears.has(`${n.kind}:${n.qualifiedName ?? n.name}`) && !n.name.startsWith('_') && !isTest(n.file))
    .sort((a, b) => key(a).localeCompare(key(b)));
}
