// Line-anchored review comments for a pull request, built from the same facts as the summary comment. GitHub only takes an
// inline comment on a line that is part of the diff, so each finding is anchored where the diff shows it: a removed
// function on the deleted lines (the old side), a changed signature or an edited function on the changed lines.
import type { CodeGraph, GraphNode } from '@codegraph/core';
import type { FileChange, ImpactResult } from '@codegraph/analysis';
import { callersOutside, reachByEdit, symbolLabel, type BaseComparison } from './report';

export const INLINE_MARKER = '<!-- codegraph-inline -->';

export interface InlineComment {
  path: string;
  line: number;
  /** RIGHT: a line of the new file. LEFT: a deleted line of the old file. */
  side: 'LEFT' | 'RIGHT';
  body: string;
}

/** The first line within `a..b` that lies inside one of `ranges`. */
const firstWithin = (ranges: [number, number][], a: number, b: number): number | undefined => {
  let best: number | undefined;
  for (const [x, y] of ranges) {
    const lo = Math.max(a, x);
    if (lo <= Math.min(b, y) && (best === undefined || lo < best)) best = lo;
  }
  return best;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const code = (s: string) => `\`${s}\``;

export interface InlineInput {
  graph: CodeGraph;
  res: ImpactResult;
  changes: FileChange[];
  comparison?: BaseComparison;
  /** Files the change edits. */
  changedFiles: Set<string>;
  /** At most this many comments (default 10): a review that comments on everything is noise. */
  limit?: number;
  /**
   * Also comment on an edit to code many others depend on. Off by default: it is not something to fix, it repeats the summary,
   * and on real history about one commit in seven would get one.
   */
  hotspots?: boolean;
}

/**
 * Findings worth saying on a line, most serious first: a removed function a surviving caller still uses, a signature a call
 * site no longer fits, and public API that goes away. With `hotspots`, also an edit to code many others depend on.
 */
export function inlineComments(i: InlineInput): InlineComment[] {
  const byFile = new Map(i.changes.map((c) => [c.file, c]));
  const out: InlineComment[] = [];
  const used = new Set<string>(); // symbols already commented on
  const add = (c: InlineComment | undefined, symbolKey: string) => {
    if (c && !used.has(symbolKey)) {
      used.add(symbolKey);
      out.push({ ...c, body: `${c.body}\n\n<sub>CodeGraph: static analysis of calls; check before relying on it.</sub>\n${INLINE_MARKER}` });
    }
  };
  const key = (n: GraphNode) => `${n.file}#${n.qualifiedName ?? n.name}`;

  // 1. Removed or renamed, and still called: on the deleted definition.
  const cmp = i.comparison;
  const dangling = new Map<string, { removed: GraphNode; callers: { label: string; at: string }[] }>();
  for (const d of cmp?.dangling ?? []) {
    const e = dangling.get(key(d.removed)) ?? { removed: d.removed, callers: [] };
    e.callers.push({ label: d.caller.kind === 'file' ? `${d.caller.file} (top-level code)` : symbolLabel(i.graph, d.caller.id), at: `${d.caller.file}:${d.line}` });
    dangling.set(key(d.removed), e);
  }
  for (const { removed, callers } of dangling.values()) {
    const ch = byFile.get(removed.file ?? '');
    const line = ch && firstWithin(ch.removed, removed.startLine ?? 0, removed.endLine ?? 0);
    if (!line) continue;
    const shown = callers.slice(0, 3).map((c) => `${code(c.label)} (${c.at})`).join(', ');
    add(
      {
        path: removed.file!,
        line,
        side: 'LEFT',
        body: `**${code(removed.name)} is removed here, but ${plural(callers.length, 'caller')} still call${callers.length === 1 ? 's' : ''} it:** ${shown}${callers.length > 3 ? `, and ${callers.length - 3} more` : ''}.\nA rename or removal that missed a caller looks like this.`,
      },
      key(removed),
    );
  }

  // 2. A signature that call sites no longer fit (🔴), or that public code may rely on (🟠): on the changed signature.
  for (const s of cmp?.signatures ?? []) {
    const ch = byFile.get(s.symbol.file ?? '');
    const line = ch && firstWithin(ch.ranges, s.symbol.startLine ?? 0, s.symbol.endLine ?? 0);
    if (!line) continue;
    const parts: string[] = [];
    if (s.kind.includes('requires-more')) parts.push(`now requires ${plural(s.after.min - s.before.min, 'more argument')}`);
    if (s.kind.includes('accepts-fewer')) parts.push(`now accepts at most ${plural(s.after.max ?? 0, 'argument')}`);
    const sites = s.violating.slice(0, 3).map((v) => `${code(`${v.file}:${v.line}`)} passes ${v.argc}`).join(', ');
    const body = s.violating.length
      ? `**🔴 ${code(s.symbol.name)} ${parts.join(' and ')}, but ${sites}${s.violating.length > 3 ? ` and ${s.violating.length - 3} more call${s.violating.length - 3 === 1 ? '' : 's'}` : ''}.**`
      : `**🟠 ${code(s.symbol.name)} ${parts.join(' and ')}.** ${s.unchecked ? `${plural(s.unchecked, 'call')} in this repository could not be checked` : 'Every call in this repository already fits'}; if it is used from outside, it may not.`;
    add({ path: s.symbol.file!, line, side: 'RIGHT', body }, key(s.symbol));
  }

  // 3. Public API removed with no caller left in the repository: on the deleted definition.
  for (const n of cmp?.removedApi ?? []) {
    const ch = byFile.get(n.file ?? '');
    const line = ch && firstWithin(ch.removed, n.startLine ?? 0, n.endLine ?? 0);
    if (!line) continue;
    add({ path: n.file!, line, side: 'LEFT', body: `**🟠 Public ${code(n.qualifiedName ?? n.name)} is removed.** Nothing in this repository still calls it; code outside it that does will break.` }, key(n));
  }

  // 4. (opt-in) An edit to code many others depend on: on the first changed line inside it. Only the biggest few, only with real reach.
  if (!i.hotspots) return out.slice(0, i.limit ?? 10);
  const inside = i.changedFiles;
  const ranked = reachByEdit(i.graph, i.res, callersOutside(i.graph, i.res, inside));
  for (const [root, callers] of ranked.slice(0, 3)) {
    const n = i.graph.node(root);
    const files = new Set(callers.map((c) => i.graph.node(c.id)?.file));
    if (!n || n.kind === 'file' || callers.length < 5 || files.size < 3) continue;
    const ch = byFile.get(n.file ?? '');
    const line = ch && firstWithin(ch.ranges, n.startLine ?? 0, n.endLine ?? 0);
    if (!line) continue;
    add({ path: n.file!, line, side: 'RIGHT', body: `**Edits ${code(n.qualifiedName ?? n.name)}, which ${plural(callers.length, 'caller')} in ${plural(files.size, 'file')} depend on.** Nothing here is known to break, but this is where a mistake would reach furthest.` }, key(n));
  }

  return out.slice(0, i.limit ?? 10);
}
