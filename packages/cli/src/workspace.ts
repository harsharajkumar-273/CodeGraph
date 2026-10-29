// What an agent needs from the code while it works: an index that follows the checkout, a check of an edit it has not written
// to disk yet, a check that a symbol exists with the signature it is about to use, and a map of the repository.
import type { CodeGraph, GraphNode } from '@codegraph/core';
import { fingerprintRepo, loadRepoFiles } from '@codegraph/extractors';
import { diffLines, isTestPath, type FileChange } from '@codegraph/analysis';
import { analyzeChange, indexVersion, type VersionIndex } from './change';
import { callersOutside, symbolLabel } from './report';

export interface ProposedFile {
  path: string;
  /** The complete new text of the file, or null to delete it. */
  content: string | null;
}

export type Verdict = 'breaking' | 'api-change' | 'shared' | 'contained' | 'additive' | 'nothing';

export interface Finding {
  kind: 'removed-but-called' | 'too-few-arguments' | 'too-many-arguments' | 'public-api-removed' | 'unchecked-calls';
  message: string;
  /** Where the problem would show up, `file:line`. */
  at: string[];
}

export interface CheckResult {
  verdict: Verdict;
  findings: Finding[];
  /** Callers outside the edited files that the change reaches, strongest links first. */
  reaches: { symbol: string; confidence: string; via: string }[];
  tests: string[];
  text: string;
}

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go)$/;
const symbolKinds = ['function', 'method', 'class'] as const;
const sig = (n: GraphNode) => `${n.qualifiedName ?? n.name}(${(n.params ?? []).join(', ')})${n.returns ? `: ${n.returns}` : ''}`;
const range = (a: { min: number; max: number | null }) => (a.max === null ? `${a.min}+` : a.min === a.max ? `${a.min}` : `${a.min}-${a.max}`);
const cap = <T>(xs: T[], n: number) => xs.slice(0, n);

/** Rejects absolute paths and `..`, so a proposed path can only be inside the repository. */
export function safeRel(p: string): string | undefined {
  const rel = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) return undefined;
  return rel;
}

interface Snapshot {
  fingerprint: string;
  files: Map<string, string>;
  configs: Map<string, string>;
  index: VersionIndex;
}

export class Workspace {
  private snap?: Promise<Snapshot>;
  private checkedAt = 0;
  /** How long a fingerprint is trusted, so a burst of tool calls costs one directory walk. */
  constructor(readonly root: string, private readonly freshMs = 1000) {}

  /** The index of the checkout as it is now; rebuilt when any indexed file was added, removed or edited. */
  async current(): Promise<Snapshot> {
    const now = Date.now();
    if (this.snap && now - this.checkedAt < this.freshMs) return this.snap;
    const prev = this.snap ? await this.snap : undefined;
    const fp = await fingerprintRepo(this.root);
    this.checkedAt = Date.now();
    if (prev && prev.fingerprint === fp) return prev;
    this.snap = (async () => {
      const { files, configs } = await loadRepoFiles(this.root);
      const index = await indexVersion(files, configs, this.root);
      return { fingerprint: fp, files, configs, index };
    })();
    return this.snap;
  }

  /** Forget the index; the next call rebuilds it. */
  invalidate() {
    this.snap = undefined;
    this.checkedAt = 0;
  }

  /** What would this edit break? The files are laid over the checkout in memory; nothing is written. */
  async check(proposed: ProposedFile[]): Promise<CheckResult> {
    const cur = await this.current();
    const files = new Map(cur.files);
    const changes: FileChange[] = [];
    const ignored: string[] = [];
    for (const p of proposed) {
      const rel = safeRel(p.path);
      if (!rel || !SOURCE.test(rel)) {
        ignored.push(p.path);
        continue;
      }
      const old = cur.files.get(rel) ?? null;
      const change = diffLines(rel, old, p.content);
      if (!change) continue;
      if (p.content === null) files.delete(rel);
      else files.set(rel, p.content);
      if (change.ranges.length || change.removed.length) changes.push(change);
    }
    if (!changes.length) {
      return { verdict: 'nothing', findings: [], reaches: [], tests: [], text: `No change to any source file.${ignored.length ? ` Ignored (not a TypeScript, JavaScript, Python or Go file, or outside the repository): ${ignored.join(', ')}.` : ''}` };
    }
    const head = await indexVersion(files, cur.configs, this.root);
    const a = analyzeChange({ head, base: cur.index, changes });
    const g = head.graph;
    const findings: Finding[] = [];
    const c = a.comparison;
    if (c) {
      const byRemoved = new Map<string, typeof c.dangling>();
      for (const d of c.dangling) byRemoved.set(`${d.removed.file}#${d.removed.qualifiedName}`, [...(byRemoved.get(`${d.removed.file}#${d.removed.qualifiedName}`) ?? []), d]);
      for (const ds of byRemoved.values()) {
        const r = ds[0].removed;
        findings.push({
          kind: 'removed-but-called',
          message: `\`${r.qualifiedName ?? r.name}\` (${r.file}) no longer exists but ${ds.length} call${ds.length === 1 ? ' still uses' : 's still use'} it.`,
          at: ds.flatMap((d) => d.lines.map((l) => `${d.caller.file}:${l}`)),
        });
      }
      for (const s of c.signatures) {
        if (s.violating.length) {
          const few = s.kind.includes('requires-more');
          findings.push({
            kind: few ? 'too-few-arguments' : 'too-many-arguments',
            message: `\`${s.symbol.qualifiedName ?? s.symbol.name}\` (${s.symbol.file}) now takes ${range(s.after)} arguments (was ${range(s.before)}); ${s.violating.length} of ${s.callers} calls pass ${few ? 'too few' : 'too many'}.`,
            at: s.violating.map((v) => `${v.file}:${v.line}`),
          });
        } else if (s.unchecked) {
          findings.push({
            kind: 'unchecked-calls',
            message: `\`${s.symbol.qualifiedName ?? s.symbol.name}\` (${s.symbol.file}) now takes ${range(s.after)} arguments (was ${range(s.before)}); ${s.unchecked} calls use spread arguments and could not be checked.`,
            at: [],
          });
        }
      }
      if (c.removedApi.length) {
        findings.push({ kind: 'public-api-removed', message: `Public API removed: ${cap(c.removedApi, 8).map((n) => `\`${n.qualifiedName ?? n.name}\``).join(', ')}.`, at: cap(c.removedApi, 8).map((n) => n.file ?? '') });
      }
    }
    const inside = a.options.changedFiles ?? new Set<string>();
    const outside = callersOutside(g, a.res, inside);
    const sorted = [...outside].sort((x, y) => x.depth - y.depth || x.confidence.localeCompare(y.confidence));
    const reaches = sorted.map((i) => ({ symbol: symbolLabel(g, i.id), confidence: i.confidence, via: i.via ? symbolLabel(g, i.via) : '' }));
    const signaturesChanged = !!c?.signatures.length;
    const verdict: Verdict = findings.some((f) => ['removed-but-called', 'too-few-arguments', 'too-many-arguments'].includes(f.kind))
      ? 'breaking'
      : signaturesChanged || c?.removedApi.length
        ? 'api-change'
        : outside.length
          ? 'shared'
          : a.res.seeds.length
            ? 'contained'
            : a.created.length
              ? 'additive'
              : 'nothing';
    const tests = a.res.tests.filter((t) => !inside.has(t) || isTestPath(t));
    return { verdict, findings, reaches, tests, text: formatCheck(verdict, findings, reaches, tests, a.created.length, ignored) };
  }

  /** Do these symbols exist, and with what parameters? Names that do not exist come back with the closest ones that do. */
  async verify(names: string[]): Promise<string> {
    const { index } = await this.current();
    const g = index.graph;
    const all = g.nodes([...symbolKinds]);
    const out: string[] = [];
    for (const raw of names.slice(0, 20)) {
      const q = raw.trim();
      const hash = q.indexOf('#');
      const file = hash > 0 ? q.slice(0, hash) : undefined;
      const name = hash > 0 ? q.slice(hash + 1) : q;
      const hits = all.filter((n) => (n.qualifiedName ?? n.name) === name && (!file || n.file === file));
      const loose = hits.length ? hits : all.filter((n) => n.name === name.split('.').pop() && name.includes('.') === false && (!file || n.file === file));
      if (loose.length) {
        for (const n of cap(loose, 4)) {
          const callers = g.incoming(n.id, ['calls']).length;
          out.push(`EXISTS ${n.kind} ${sig(n)} — ${n.file}:${n.startLine ?? '?'}${n.arity ? `, takes ${range(n.arity)} arguments` : ''}, ${callers} callers${n.exported ? ', exported' : ''}`);
        }
        if (loose.length > 4) out.push(`  ...and ${loose.length - 4} more with that name`);
      } else {
        const last = name.split('.').pop()!.toLowerCase();
        const near = all
          .map((n) => ({ n, d: distance(last, n.name.toLowerCase()) }))
          .filter((x) => x.d <= Math.max(2, Math.floor(last.length / 3)) || x.n.name.toLowerCase().includes(last))
          .sort((x, y) => x.d - y.d)
          .slice(0, 5);
        out.push(`NOT FOUND ${q}${near.length ? ` — did you mean: ${near.map((x) => `${x.n.qualifiedName ?? x.n.name} (${x.n.file})`).join(', ')}?` : ''}`);
      }
    }
    return out.join('\n');
  }

  /** A compact orientation: per directory, the files and the symbols most worth knowing, most-called first. */
  async map(opts: { path?: string; limit?: number } = {}): Promise<string> {
    const { index } = await this.current();
    const g: CodeGraph = index.graph;
    const prefix = opts.path ? opts.path.replace(/^\.\//, '').replace(/\/?$/, '/') : '';
    const byFile = new Map<string, { n: GraphNode; c: number }[]>();
    for (const n of g.nodes([...symbolKinds])) {
      if (!n.file || !n.file.startsWith(prefix) || isTestPath(n.file) || n.qualifiedName?.includes('.<')) continue;
      const list = byFile.get(n.file) ?? [];
      list.push({ n, c: g.incoming(n.id, ['calls']).length });
      byFile.set(n.file, list);
    }
    const files = [...byFile]
      .map(([f, syms]) => ({ f, syms: syms.sort((a, b) => b.c - a.c || a.n.startLine! - b.n.startLine!), total: syms.reduce((s, x) => s + x.c, 0) }))
      .sort((a, b) => b.total - a.total || a.f.localeCompare(b.f));
    const limit = opts.limit ?? 25;
    const lines = [`${g.size.nodes} nodes, ${g.size.edges} edges${prefix ? ` (showing ${prefix})` : ''}. Files whose symbols are called most come first; (n) is the number of callers.`];
    for (const { f, syms } of files.slice(0, limit)) {
      lines.push(`${f}: ${cap(syms, 6).map((s) => `${s.n.qualifiedName ?? s.n.name}${s.c ? `(${s.c})` : ''}`).join(', ')}${syms.length > 6 ? `, +${syms.length - 6}` : ''}`);
    }
    if (files.length > limit) lines.push(`...and ${files.length - limit} more files (pass path to look inside a directory)`);
    return lines.join('\n');
  }
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 4) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const HEADLINE: Record<Verdict, string> = {
  breaking: 'BREAKING — this edit leaves code that will fail',
  'api-change': 'API CHANGE — a signature or public symbol changes; no broken call was found',
  shared: 'SHARED CODE — behaviour changes for callers outside the edited files',
  contained: 'CONTAINED — nothing outside the edited files calls the edited code',
  additive: 'ADDITIVE — new code only',
  nothing: 'NOTHING TO CHECK',
};

function formatCheck(verdict: Verdict, findings: Finding[], reaches: CheckResult['reaches'], tests: string[], created: number, ignored: string[]): string {
  const out = [`${HEADLINE[verdict]}.`];
  for (const f of findings) out.push(`- ${f.message}${f.at.length ? ` At ${cap(f.at, 6).join(', ')}${f.at.length > 6 ? `, +${f.at.length - 6}` : ''}.` : ''}`);
  if (reaches.length) {
    out.push(`Reaches ${reaches.length} caller${reaches.length === 1 ? '' : 's'} outside the edited files:`);
    for (const r of cap(reaches, 10)) out.push(`  ${r.confidence.padEnd(9)} ${r.symbol}${r.via ? `  (via ${r.via})` : ''}`);
    if (reaches.length > 10) out.push(`  ...and ${reaches.length - 10} more`);
  }
  if (created) out.push(`Adds ${created} new symbol${created === 1 ? '' : 's'}.`);
  if (tests.length) out.push(`Tests to run: ${cap(tests, 12).join(', ')}${tests.length > 12 ? `, +${tests.length - 12}` : ''}`);
  if (ignored.length) out.push(`Ignored (not a source file, or outside the repository): ${ignored.join(', ')}.`);
  return out.join('\n');
}
