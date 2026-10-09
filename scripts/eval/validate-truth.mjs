// Sanity-checks a human-written truth file before scoring: schema, every line inside a sampled window,
// every non-NOSYM target exists as a graph node, and reviewer initials are present.
//   node scripts/eval/validate-truth.mjs <truth.json> <windows.json> <graph.json>
import { readFileSync } from 'node:fs';
const [, , tp, wp, gp] = process.argv;
const truth = JSON.parse(readFileSync(tp, 'utf8')), wins = JSON.parse(readFileSync(wp, 'utf8'));
const nodes = new Set(JSON.parse(readFileSync(gp, 'utf8')).nodes.map((n) => n.file + '#' + n.qualifiedName));
let bad = 0;
for (const t of truth) {
  const why = [];
  if (!wins.some((w) => w.file === t.file && t.line >= w.start && t.line <= w.end)) why.push('outside every window');
  if (!t.target) why.push('no target');
  else if (!t.target.startsWith('NOSYM') && !nodes.has(t.target)) why.push('target is not a graph node (use NOSYM:<why> if the graph cannot represent it)');
  if (!t.reviewer) why.push('no reviewer');
  if (why.length) { bad++; console.log(`${t.file}:${t.line} ${t.callee}: ${why.join('; ')}`); }
}
console.log(bad ? `${bad} problem(s)` : `ok: ${truth.length} entries, reviewers: ${[...new Set(truth.map((t) => t.reviewer))].join(', ')}`);
process.exit(bad ? 1 : 0);
