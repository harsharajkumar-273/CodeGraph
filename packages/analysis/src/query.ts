import type { CodeGraph, GraphNode } from '@codegraph/core';

/**
 * Resolve a user-typed target to graph nodes. Accepted forms:
 *   src/a.ts                 file
 *   src/a.ts#Foo.bar         symbol in file
 *   src/a.ts:42              innermost symbol containing line 42
 *   Foo.bar | bar            by (qualified) name, anywhere
 *   file:... | sym:...       exact node id
 */
export function resolveTargets(graph: CodeGraph, query: string): GraphNode[] {
  const q = query.trim();
  if (graph.hasNode(q)) return [graph.node(q)!];
  const fileMatches = (path: string) => graph.nodes('file').filter((n) => n.file === path || n.file!.endsWith('/' + path));

  const hash = q.indexOf('#');
  if (hash > 0) {
    const files = fileMatches(q.slice(0, hash));
    const name = q.slice(hash + 1);
    return files.flatMap((f) => graph.symbolsInFile(f.file!).filter((s) => s.qualifiedName === name || s.name === name));
  }
  const line = /^(.*):(\d+)$/.exec(q);
  if (line) {
    const ln = Number(line[2]);
    return fileMatches(line[1]).map((f) => {
      const inside = graph
        .symbolsInFile(f.file!)
        .filter((s) => s.startLine! <= ln && s.endLine! >= ln)
        .sort((a, b) => a.endLine! - a.startLine! - (b.endLine! - b.startLine!));
      return inside[0] ?? f;
    });
  }
  const files = fileMatches(q);
  if (files.length) return files;
  const byName = graph
    .nodes(['function', 'method', 'class', 'variable'])
    .filter((n) => n.qualifiedName === q || n.name === q);
  return byName.sort((a, b) => Number(!!b.exported) - Number(!!a.exported));
}
