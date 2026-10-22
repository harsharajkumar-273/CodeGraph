import type { CodeGraph, Confidence } from '@codegraph/core';
import { isTestPath, summarizeImpact, type ImpactResult } from '@codegraph/analysis';

export const COMMENT_MARKER = '<!-- codegraph-impact -->';

export const symbolLabel = (g: CodeGraph, id: string) => {
  const n = g.node(id);
  if (!n) return id;
  return n.kind === 'file' ? n.file! : `${n.file}#${n.qualifiedName}`;
};

/** A symbol, or for a file node the code that runs when the file loads. */
const refLabel = (g: CodeGraph, id: string) => (g.node(id)?.kind === 'file' ? `\`${g.node(id)!.file}\` (top-level code)` : `\`${symbolLabel(g, id)}\``);

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
      `**${outside.length} symbol${outside.length === 1 ? '' : 's'} in ${files.size} file${files.size === 1 ? '' : 's'}** you did not edit could be affected by the ${changed} existing symbol${changed === 1 ? '' : 's'} this change edits ` +
        `(🟢 ${by.resolved} proven · 🟡 ${by.probable} probable · 🔴 ${by.ambiguous} guessed by name).`,
    );
    // Each caller is listed under the edit that reaches it, riskiest edit (most callers) first.
    const via = new Map(r.impacted.map((i) => [i.id, i.via]));
    const seeds = new Set(r.seeds);
    const groups = new Map<string, typeof outside>();
    for (const i of outside) {
      let root = i.id;
      for (let n = 0; n < 30 && !seeds.has(root) && via.get(root); n++) root = via.get(root)!;
      groups.set(root, [...(groups.get(root) ?? []), i]);
    }
    const ranked = [...groups].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
    out.push('', '<details open><summary>Which edit reaches whom</summary>', '');
    for (const [root, callers] of ranked.slice(0, 6)) {
      const fs = new Set(callers.map((c) => g.node(c.id)?.file));
      const worst = callers.some((c) => c.confidence !== 'resolved') ? ' (includes unproven links)' : '';
      out.push(`- ${refLabel(g, root)} is reached by **${callers.length}** in ${fs.size} file${fs.size === 1 ? '' : 's'}${worst}`);
      const nearest = [...callers].sort((x, y) => x.depth - y.depth).slice(0, 4);
      out.push(`  - ${nearest.map((c) => `${DOT[c.confidence]} ${refLabel(g, c.id)}`).join(', ')}${callers.length > nearest.length ? `, and ${callers.length - nearest.length} more` : ''}`);
    }
    if (ranked.length > 6) out.push(`- …and ${ranked.length - 6} more edited symbols with callers elsewhere`);
    out.push('', '</details>');
  }
  const notes: string[] = [];
  if (fileSeeds && changed) notes.push(`edits top-level code in ${fileSeeds} file${fileSeeds === 1 ? '' : 's'}`);
  if (changed && opts.created) notes.push(`adds ${opts.created} new symbol${opts.created === 1 ? '' : 's'}`);
  if (opts.deletedFiles?.length) notes.push(`deletes ${opts.deletedFiles.length} file${opts.deletedFiles.length === 1 ? '' : 's'} (references to what they defined are not checked)`);
  if (notes.length) out.push('', `Also: ${notes.join('; ')}.`);

  if (r.tests.length) {
    const cmds = testCommands(r.tests, opts.jsRunner);
    const total = g.nodes('file').filter((n) => n.file && isTestPath(n.file)).length;
    const broad = total >= 5 && r.tests.length / total > 0.7 ? ' That is most of the suite: this change touches widely used code.' : '';
    out.push('', `<details><summary>${r.tests.length}${total ? ` of ${total}` : ''} test file${(total || r.tests.length) === 1 ? '' : 's'} to run</summary>`, '');
    if (broad) out.push(broad.trim(), '');
    if (cmds.length) out.push('```bash', ...cmds, '```', '');
    // With a command above, the file list only repeats it; keep it when it is short or there is no command.
    const list = !cmds.length || r.tests.length <= 8;
    if (!list && cmds.length) out.pop(); // no list follows the command, so no blank line either
    if (list) out.push(...r.tests.slice(0, 30).map((t) => `- \`${t}\``), ...(r.tests.length > 30 ? [`- …and ${r.tests.length - 30} more`] : []));
    out.push('', '</details>');
  }
  out.push('', `<sub>Static analysis of calls and imports (TypeScript, JavaScript, Python, Go). 🟡 and 🔴 links are name matches, so check them before relying on them. Dynamic calls are invisible to it. [CodeGraph](https://github.com/harsharajkumar-273/CodeGraph)</sub>`);
  return out.join('\n');
}
