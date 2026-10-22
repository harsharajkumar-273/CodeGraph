import { CodeGraph, fileId, type GraphNode } from '@codegraph/core';

export interface FileChange {
  file: string;
  /** New-side line ranges, 1-based inclusive. */
  ranges: [number, number][];
  /** The subset of `ranges` that only inserts lines (nothing existing was edited or removed there). */
  inserted: [number, number][];
  /** The whole file is new in this diff. */
  added?: boolean;
  /** The file was deleted (it has no symbols in the new graph). */
  deleted?: boolean;
}

/** Parse `git diff -U0` output into per-file changed line ranges (new side). */
export function parseUnifiedDiff(text: string): FileChange[] {
  const out = new Map<string, FileChange>();
  let oldFile: string | null = null;
  let oldIsNull = false; // only a `--- /dev/null` line says the file is new; a diff without header lines says nothing
  let file: string | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff ')) {
      oldFile = null;
      oldIsNull = false;
    } else if (line.startsWith('--- ')) {
      const f = line.slice(4).trim();
      oldIsNull = f === '/dev/null';
      oldFile = oldIsNull ? null : f.replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      const f = line.slice(4).trim();
      file = f === '/dev/null' ? null : f.replace(/^b\//, '');
      if (file && !out.has(file)) out.set(file, { file, ranges: [], inserted: [], ...(oldIsNull ? { added: true } : {}) });
      else if (!file && oldFile && !out.has(oldFile)) out.set(oldFile, { file: oldFile, ranges: [], inserted: [], deleted: true });
    } else if (line.startsWith('@@') && file) {
      const m = /-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const oldLen = m[2] === undefined ? 1 : Number(m[2]);
      const start = Number(m[3]);
      const len = m[4] === undefined ? 1 : Number(m[4]);
      const ch = out.get(file)!;
      ch.ranges.push(len === 0 ? [Math.max(start, 1), Math.max(start, 1)] : [start, start + len - 1]);
      if (oldLen === 0 && len > 0) ch.inserted.push([start, start + len - 1]);
    }
  }
  return [...out.values()];
}

/**
 * Map changed line ranges to the innermost symbols they touch (falling back to the file node). `created` holds symbols
 * that this diff adds in full (new files, or a function inserted between others): nothing that exists today calls them,
 * so they cannot break anyone and are kept out of `nodes`.
 */
export function changedNodes(graph: CodeGraph, changes: FileChange[]): { nodes: GraphNode[]; created: GraphNode[]; unmapped: string[] } {
  const nodes = new Map<string, GraphNode>();
  const created = new Map<string, GraphNode>();
  const unmapped: string[] = [];
  for (const ch of changes) {
    if (ch.deleted) continue;
    const fnode = graph.node(fileId(ch.file));
    if (!fnode) {
      unmapped.push(ch.file);
      continue;
    }
    const syms = graph.symbolsInFile(ch.file);
    const isNew = (n: GraphNode) => !!ch.added || ch.inserted.some(([a, b]) => a <= n.startLine! && b >= n.endLine!);
    let anySym = false;
    for (const [a, b] of ch.ranges) {
      const hit = syms.filter((s) => s.startLine! <= b && s.endLine! >= a);
      // keep only innermost: drop A if another hit lies strictly inside A
      const leaf = hit.filter((s) => !hit.some((o) => o !== s && o.startLine! >= s.startLine! && o.endLine! <= s.endLine! && (o.startLine! > s.startLine! || o.endLine! < s.endLine!)));
      for (const leafNode of leaf) {
        // An edit on a line that declares a local variable changes the function around it: a variable has no callers.
        let s = leafNode;
        while (s.kind === 'variable' && s.parent && s.parent !== fnode.id && graph.node(s.parent)) s = graph.node(s.parent)!;
        if (isNew(s)) {
          // report the outermost symbol that is new in full (a whole inserted function, not its parameters)
          while (s.parent && s.parent !== fnode.id && graph.node(s.parent) && isNew(graph.node(s.parent)!)) s = graph.node(s.parent)!;
          created.set(s.id, s);
        } else nodes.set(s.id, s);
        anySym = true;
      }
      if (!leaf.length && !ch.added) nodes.set(fnode.id, fnode); // module-level statement in an existing file
    }
    if (!anySym && !ch.added && !nodes.has(fnode.id)) nodes.set(fnode.id, fnode);
  }
  // A symbol is only "created" when nothing about it was also edited; a modified method inside a new-looking range stays modified.
  for (const id of nodes.keys()) created.delete(id);
  return { nodes: [...nodes.values()], created: [...created.values()], unmapped };
}
