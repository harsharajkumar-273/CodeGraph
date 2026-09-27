// Stratified precision sampler used for docs/PRECISION.md.
//
// Pulls N call edges per confidence tier from a codegraph graph.json, with source
// context for both the call site and the target definition, into a markdown file
// for manual verification. This is how the numbers in docs/PRECISION.md were produced.
//
// Usage:
//   node scripts/sample-precision-edges.mjs <graph.json> <repo-root> <out.md> [seed] [perTier]
//
// Example (after `npm run cg -- index pallets/flask`):
//   node scripts/sample-precision-edges.mjs ~/.cache/codegraph/repos/pallets__flask/.codegraph/graph.json ~/.cache/codegraph/repos/pallets__flask flask-sample.md 42 11
//
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , graphPath, repoRoot, outPath, seedArg, perTierArg] = process.argv;
const seed = Number(seedArg ?? 42);
const perTier = Number(perTierArg ?? 11);

const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

// simple seeded PRNG (mulberry32) for reproducible sampling
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function label(n) {
  if (!n) return '?';
  if (n.kind === 'file') return n.file;
  if (n.kind === 'external') return `ext:${n.name}`;
  return `${n.file}#${n.qualifiedName}`;
}

function readLines(file) {
  const p = join(repoRoot, file);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').split('\n');
}

function snippetAtLine(file, line, before = 2, after = 2) {
  const lines = readLines(file);
  if (!lines || !line) return null;
  const start = Math.max(1, line - before);
  const end = Math.min(lines.length, line + after);
  const out = [];
  for (let i = start; i <= end; i++) {
    const marker = i === line ? '>>' : '  ';
    out.push(`${marker} ${i}: ${lines[i - 1]}`);
  }
  return out.join('\n');
}

function snippetForSymbol(n) {
  if (!n || n.kind === 'external' || !n.file || !n.startLine) return null;
  const lines = readLines(n.file);
  if (!lines) return null;
  const end = Math.min(lines.length, n.endLine ?? n.startLine + 8, n.startLine + 10);
  const out = [];
  for (let i = n.startLine; i <= end; i++) out.push(`   ${i}: ${lines[i - 1]}`);
  return out.join('\n');
}

const callEdges = graph.edges.filter((e) => e.kind === 'calls');
const tiers = ['resolved', 'probable', 'ambiguous'];
const rng = mulberry32(seed);

let md = `# Precision sample — ${repoRoot.split('/').pop()}\n\n`;
let counter = 0;
const records = [];

for (const tier of tiers) {
  const pool = callEdges.filter((e) => e.confidence === tier);
  const picked = shuffle(pool, rng).slice(0, perTier);
  md += `\n## ${tier} (${picked.length} of ${pool.length} total)\n\n`;
  for (const e of picked) {
    counter++;
    const fromN = nodesById.get(e.from);
    const toN = nodesById.get(e.to);
    const fromLabel = label(fromN);
    const toLabel = label(toN);
    const callSiteSnippet = fromN?.file ? snippetAtLine(fromN.file, e.line) : null;
    const targetSnippet = snippetForSymbol(toN);
    md += `### [${tier}] #${counter}: ${fromLabel} -> ${toLabel}\n\n`;
    md += `**Call site** (${fromLabel}${e.line ? `:${e.line}` : ''}):\n\`\`\`\n${callSiteSnippet ?? '(no line info / file not found)'}\n\`\`\`\n\n`;
    md += `**Target definition** (${toLabel}):\n\`\`\`\n${targetSnippet ?? (toN?.kind === 'external' ? `(external: ${toN.name})` : '(no snippet available)')}\n\`\`\`\n\n`;
    md += `**Verdict:** _(fill in: correct / wrong — reason)_\n\n---\n\n`;
    records.push({ id: counter, tier, from: fromLabel, to: toLabel });
  }
}

writeFileSync(outPath, md);
console.log(`wrote ${counter} samples to ${outPath}`);
