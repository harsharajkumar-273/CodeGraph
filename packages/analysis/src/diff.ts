import { CodeGraph, fileId, type GraphNode } from '@codegraph/core';

export interface FileChange {
  file: string;
  /** New-side line ranges, 1-based inclusive. */
  ranges: [number, number][];
}

/** Parse `git diff -U0` output into per-file changed line ranges (new side). */
export function parseUnifiedDiff(text: string): FileChange[] {
  const out = new Map<string, [number, number][]>();
  let file: string | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      const f = line.slice(4).trim();
      file = f === '/dev/null' ? null : f.replace(/^b\//, '');
      if (file && !out.has(file)) out.set(file, []);
    } else if (line.startsWith('@@') && file) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const len = m[2] === undefined ? 1 : Number(m[2]);
      out.get(file)!.push(len === 0 ? [Math.max(start, 1), Math.max(start, 1)] : [start, start + len - 1]);
    }
  }
  return [...out].map(([file, ranges]) => ({ file, ranges }));
}

/** Map changed line ranges to the innermost symbols they touch (falling back to the file node). */
export function changedNodes(graph: CodeGraph, changes: FileChange[]): { nodes: GraphNode[]; unmapped: string[] } {
  const nodes = new Map<string, GraphNode>();
  const unmapped: string[] = [];
  for (const ch of changes) {
    const fnode = graph.node(fileId(ch.file));
    if (!fnode) {
      unmapped.push(ch.file);
      continue;
    }
    const syms = graph.symbolsInFile(ch.file);
    let anySym = false;
    for (const [a, b] of ch.ranges) {
      const hit = syms.filter((s) => s.startLine! <= b && s.endLine! >= a);
      // keep only innermost: drop A if another hit lies strictly inside A
      const leaf = hit.filter((s) => !hit.some((o) => o !== s && o.startLine! >= s.startLine! && o.endLine! <= s.endLine! && (o.startLine! > s.startLine! || o.endLine! < s.endLine!)));
      for (const s of leaf) {
        nodes.set(s.id, s);
        anySym = true;
      }
      if (!leaf.length) nodes.set(fnode.id, fnode); // module-level statement
    }
    if (!anySym && !nodes.has(fnode.id)) nodes.set(fnode.id, fnode);
  }
  return { nodes: [...nodes.values()], unmapped };
}
