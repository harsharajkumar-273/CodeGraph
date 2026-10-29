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
  /** Old-side line ranges the diff deletes or rewrites, 1-based inclusive: where a removed function used to be. */
  removed: [number, number][];
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
      if (file && !out.has(file)) out.set(file, { file, ranges: [], inserted: [], removed: [], ...(oldIsNull ? { added: true } : {}) });
      else if (!file && oldFile && !out.has(oldFile)) out.set(oldFile, { file: oldFile, ranges: [], inserted: [], removed: [], deleted: true });
    } else if (line.startsWith('@@') && (file || oldFile)) {
      const m = /-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const target = out.get((file ?? oldFile)!)!;
      const oldStart = Number(m[1]);
      const oldLen = m[2] === undefined ? 1 : Number(m[2]);
      if (oldLen > 0) target.removed.push([oldStart, oldStart + oldLen - 1]);
      if (!file) continue; // a deleted file has no new side
      const start = Number(m[3]);
      const len = m[4] === undefined ? 1 : Number(m[4]);
      const ch = target;
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

/**
 * The line changes between two versions of one file, in the shape `parseUnifiedDiff` produces from `git diff -U0`, so a
 * proposed edit (the new contents of a file) can be analysed without writing it or making a patch. `null` for the old text
 * means the file is new, `null` for the new text means it is deleted. Where the changed middle of a file is very large the
 * whole middle counts as changed rather than being aligned line by line.
 */
export function diffLines(path: string, oldText: string | null, newText: string | null): FileChange | undefined {
  const lines = (t: string) => (t === '' ? [] : t.replace(/\n$/, '').split('\n'));
  if (oldText === null && newText === null) return undefined;
  if (newText === null) {
    const n = lines(oldText!).length;
    return { file: path, ranges: [], inserted: [], removed: n ? [[1, n]] : [], deleted: true };
  }
  if (oldText === null) {
    const n = lines(newText).length;
    return { file: path, ranges: n ? [[1, n]] : [], inserted: [], removed: [], added: true };
  }
  const a = lines(oldText);
  const b = lines(newText);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const out: FileChange = { file: path, ranges: [], inserted: [], removed: [] };
  if (lo === ea && lo === eb) return out; // identical
  // Align the changed middle with a longest-common-subsequence table (bounded), then read the blocks off it.
  const n = ea - lo;
  const m = eb - lo;
  const blocks: { oa: number; ob: number; na: number; nb: number }[] = []; // 1-based, half-open on the end
  if (n * m > 4_000_000) {
    blocks.push({ oa: lo + 1, ob: ea + 1, na: lo + 1, nb: eb + 1 });
  } else {
    const w = m + 1;
    const t = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[lo + i] === b[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    let i = 0;
    let j = 0;
    let open: { oa: number; na: number } | null = null;
    const close = (i2: number, j2: number) => {
      if (open) blocks.push({ oa: open.oa, ob: lo + i2 + 1, na: open.na, nb: lo + j2 + 1 });
      open = null;
    };
    while (i < n || j < m) {
      if (i < n && j < m && a[lo + i] === b[lo + j]) {
        close(i, j);
        i++;
        j++;
        continue;
      }
      open ??= { oa: lo + i + 1, na: lo + j + 1 };
      if (j < m && (i === n || t[i * w + j + 1] >= t[(i + 1) * w + j])) j++;
      else i++;
    }
    close(i, j);
  }
  for (const k of blocks) {
    const oldLen = k.ob - k.oa;
    const newLen = k.nb - k.na;
    if (oldLen > 0) out.removed.push([k.oa, k.ob - 1]);
    if (newLen > 0) {
      out.ranges.push([k.na, k.nb - 1]);
      if (oldLen === 0) out.inserted.push([k.na, k.nb - 1]);
    } else {
      const at = Math.max(k.na - 1, 1); // a pure deletion: git reports the line before it, as `+c,0` does
      out.ranges.push([at, at]);
    }
  }
  return out;
}
