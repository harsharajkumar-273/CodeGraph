import type { CodeGraph, Confidence } from '@codegraph/core';
import { summarizeImpact, type ImpactResult } from '@codegraph/analysis';

export const COMMENT_MARKER = '<!-- codegraph-impact -->';

export const symbolLabel = (g: CodeGraph, id: string) => {
  const n = g.node(id);
  if (!n) return id;
  return n.kind === 'file' ? n.file! : `${n.file}#${n.qualifiedName}`;
};

const DOT: Record<Confidence, string> = { resolved: '🟢', probable: '🟡', ambiguous: '🔴' };

/**
 * A pull request comment: how far a change reaches, how sure we are, and which tests to run.
 * Kept short on purpose; the full list is one `codegraph impact --diff` away.
 */
export function impactMarkdown(g: CodeGraph, r: ImpactResult, opts: { limit?: number; title?: string } = {}): string {
  const limit = opts.limit ?? 12;
  const s = summarizeImpact(g, r);
  const fileCount = new Set(r.impacted.map((i) => g.node(i.id)?.file).filter(Boolean)).size;
  const out: string[] = [COMMENT_MARKER, `### ${opts.title ?? 'CodeGraph: what this change can reach'}`, ''];
  if (!s.impactedSymbols) {
    out.push(`This change touches ${s.changed.length} symbol${s.changed.length === 1 ? '' : 's'} and nothing else in the code calls them.`);
  } else {
    out.push(
      `**${s.impactedSymbols} symbols in ${fileCount} file${fileCount === 1 ? '' : 's'}** could be affected by the ${s.changed.length} changed symbol${s.changed.length === 1 ? '' : 's'} ` +
        `(🟢 ${s.byConfidence.resolved} proven · 🟡 ${s.byConfidence.probable} probable · 🔴 ${s.byConfidence.ambiguous} guessed by name).`,
    );
    const shown = r.impacted.slice(0, limit);
    if (shown.length) {
      out.push('', '<details open><summary>Most direct callers</summary>', '', '| | Hops | Symbol |', '|---|---|---|');
      for (const i of shown) out.push(`| ${DOT[i.confidence]} | ${i.depth} | \`${symbolLabel(g, i.id)}\` |`);
      if (r.impacted.length > shown.length) out.push(`| | | …and ${r.impacted.length - shown.length} more |`);
      out.push('', '</details>');
    }
  }
  if (r.tests.length) {
    out.push('', `<details><summary>${r.tests.length} test file${r.tests.length === 1 ? '' : 's'} to run</summary>`, '', ...r.tests.slice(0, 30).map((t) => `- \`${t}\``));
    if (r.tests.length > 30) out.push(`- …and ${r.tests.length - 30} more`);
    out.push('', '</details>');
  }
  out.push('', `<sub>Static analysis of calls and imports (TypeScript, JavaScript, Python, Go). 🟡 and 🔴 links are name matches, so check them before relying on them. Dynamic calls are invisible to it. [CodeGraph](https://github.com/harsharajkumar-273/CodeGraph)</sub>`);
  return out.join('\n');
}
