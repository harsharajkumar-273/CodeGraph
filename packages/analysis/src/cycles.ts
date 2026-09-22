import type { CodeGraph } from '@codegraph/core';

/**
 * Import cycles: strongly connected components (size > 1) of the file import graph (Tarjan).
 *
 * `TYPE_CHECKING`-guarded imports (Python) are excluded by default: they're erased at runtime,
 * so a cycle that only exists through one isn't a real dependency cycle — including it can also
 * merge two otherwise-separate real cycles into one misleadingly large component.
 */
export function importCycles(graph: CodeGraph, opts: { includeTypeOnly?: boolean } = {}): string[][] {
  const files = graph.nodes('file');
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const e of graph.outgoing(v, ['imports'])) {
      if (e.typeOnly && !opts.includeTypeOnly) continue;
      const w = e.to;
      if (graph.node(w)?.kind !== 'file') continue;
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(graph.node(w)!.file!);
      } while (w !== v);
      if (comp.length > 1) result.push(comp.sort());
    }
  };
  for (const f of files) if (!idx.has(f.id)) strong(f.id);
  return result.sort((a, b) => b.length - a.length);
}
