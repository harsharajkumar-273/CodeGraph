import type { CodeGraph, Confidence } from '@codegraph/core';
import { summarizeImpact, type ImpactResult } from '@codegraph/analysis';

export const COMMENT_MARKER = '<!-- codegraph-impact -->';

export const symbolLabel = (g: CodeGraph, id: string) => {
  const n = g.node(id);
  if (!n) return id;
  return n.kind === 'file' ? n.file! : `${n.file}#${n.qualifiedName}`;
};

const DOT: Record<Confidence, string> = { resolved: '🟢', probable: '🟡', ambiguous: '🔴' };

export interface MarkdownOptions {
  limit?: number;
  title?: string;
  /** Files this change edits: impact inside them is the change itself, not a risk to someone else. */
  changedFiles?: Set<string>;
  /** Symbols the change adds in full, and files it deletes (whose symbols no longer exist to be checked). */
  created?: number;
  deletedFiles?: string[];
  /** How the project runs its JavaScript tests, when it can be told from package.json. */
  jsRunner?: 'vitest' | 'jest';
}

/** Commands that run the given test files, one line per ecosystem. */
export function testCommands(tests: string[], jsRunner?: 'vitest' | 'jest'): string[] {
  const out: string[] = [];
  const go = [...new Set(tests.filter((t) => t.endsWith('_test.go')).map((t) => (t.includes('/') ? './' + t.slice(0, t.lastIndexOf('/')) : '.')))];
  if (go.length) out.push(`go test ${go.join(' ')}`);
  const py = tests.filter((t) => t.endsWith('.py'));
  if (py.length) out.push(`pytest ${py.join(' ')}`);
  const js = tests.filter((t) => /\.[cm]?[jt]sx?$/.test(t));
  if (js.length && jsRunner) out.push(jsRunner === 'vitest' ? `npx vitest run ${js.join(' ')}` : `npx jest ${js.join(' ')}`);
  return out;
}

/**
 * A pull request comment: how far a change reaches, how sure we are, and which tests to run. The headline counts only
 * code outside the files the change edits, because that is the code whose author did not look at the change.
 */
export function impactMarkdown(g: CodeGraph, r: ImpactResult, opts: MarkdownOptions = {}): string {
  const limit = opts.limit ?? 10;
  const s = summarizeImpact(g, r);
  const inside = opts.changedFiles ?? new Set<string>();
  const outside = r.impacted.filter((i) => {
    const f = g.node(i.id)?.file;
    return !!f && !inside.has(f);
  });
  const files = new Set(outside.map((i) => g.node(i.id)?.file));
  const by = { resolved: 0, probable: 0, ambiguous: 0 } as Record<Confidence, number>;
  for (const i of outside) by[i.confidence]++;
  const out: string[] = [COMMENT_MARKER, `### ${opts.title ?? 'CodeGraph: what this change can reach'}`, ''];

  const fileSeeds = r.seeds.filter((id) => g.node(id)?.kind === 'file').length;
  const changed = r.seeds.length - fileSeeds; // existing symbols edited; a module-level edit is counted apart
  if (!changed && fileSeeds && !outside.length) {
    out.push(`This change edits top-level code (imports, constants, statements) in ${fileSeeds} file${fileSeeds === 1 ? '' : 's'} and no function or class in them.${opts.created ? ` It also adds ${opts.created} new symbols.` : ''}`);
  } else if (!changed) {
    out.push(`This change only adds new code${opts.created ? ` (${opts.created} new symbols)` : ''}. Nothing that exists today calls it, so there is nothing to break.`);
  } else if (!outside.length) {
    out.push(`This change edits ${changed} existing symbol${changed === 1 ? '' : 's'}, and nothing outside the files it edits calls ${changed === 1 ? 'it' : 'them'}.`);
  } else {
    out.push(
      `**${outside.length} symbols in ${files.size} files** you did not edit could be affected by the ${changed} existing symbol${changed === 1 ? '' : 's'} this change edits ` +
        `(🟢 ${by.resolved} proven · 🟡 ${by.probable} probable · 🔴 ${by.ambiguous} guessed by name).`,
    );
    const shown = outside.slice(0, limit);
    out.push('', '<details open><summary>Callers outside this change</summary>', '', '| | Hops | Symbol |', '|---|---|---|');
    for (const i of shown) out.push(`| ${DOT[i.confidence]} | ${i.depth} | \`${symbolLabel(g, i.id)}\` |`);
    if (outside.length > shown.length) out.push(`| | | …and ${outside.length - shown.length} more |`);
    out.push('', '</details>');
  }
  const notes: string[] = [];
  if (fileSeeds && changed) notes.push(`edits top-level code in ${fileSeeds} file${fileSeeds === 1 ? '' : 's'}`);
  if (changed && opts.created) notes.push(`adds ${opts.created} new symbol${opts.created === 1 ? '' : 's'}`);
  if (opts.deletedFiles?.length) notes.push(`deletes ${opts.deletedFiles.length} file${opts.deletedFiles.length === 1 ? '' : 's'} (references to what they defined are not checked)`);
  if (notes.length) out.push('', `Also: ${notes.join('; ')}.`);

  if (r.tests.length) {
    const cmds = testCommands(r.tests, opts.jsRunner);
    out.push('', `<details><summary>${r.tests.length} test file${r.tests.length === 1 ? '' : 's'} to run</summary>`, '');
    if (cmds.length) out.push('```bash', ...cmds, '```', '');
    out.push(...r.tests.slice(0, 30).map((t) => `- \`${t}\``));
    if (r.tests.length > 30) out.push(`- …and ${r.tests.length - 30} more`);
    out.push('', '</details>');
  }
  out.push('', `<sub>Static analysis of calls and imports (TypeScript, JavaScript, Python, Go). 🟡 and 🔴 links are name matches, so check them before relying on them. Dynamic calls are invisible to it. [CodeGraph](https://github.com/harsharajkumar-273/CodeGraph)</sub>`);
  return out.join('\n');
}
