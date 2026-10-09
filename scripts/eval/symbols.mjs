// Lists graph symbols matching a regex over "<file>#<qualifiedName>" — a lookup aid for writing `target`s.
// It shows definitions only (never resolved call edges), so it does not leak the analyzer's answers.
//   node scripts/eval/symbols.mjs <graph.json> '<regex>'
import { readFileSync } from 'node:fs';
const [, , gp, re] = process.argv;
const g = JSON.parse(readFileSync(gp, 'utf8'));
for (const n of g.nodes)
  if (['function', 'method', 'class'].includes(n.kind) && new RegExp(re).test(`${n.file}#${n.qualifiedName}`)) console.log(`${n.file}#${n.qualifiedName}:${n.startLine}`);
