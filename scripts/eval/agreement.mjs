// Agreement between two independent human truth files over the same windows, before adjudication.
//   node scripts/eval/agreement.mjs <truthA.json> <truthB.json>
// Entries are matched on (file, line, callee, occurrence). Reports calls only one reviewer listed, and for shared calls
// whether the targets agree. Resolve every disagreement together, then score the adjudicated file.
import { readFileSync } from 'node:fs';
const [, , a, b] = process.argv;
const load = (p) => {
  const m = new Map();
  for (const t of JSON.parse(readFileSync(p, 'utf8'))) {
    const base = `${t.file}|${t.line}|${t.callee}`;
    let i = 0; while (m.has(`${base}|${i}`)) i++;
    m.set(`${base}|${i}`, t.target);
  }
  return m;
};
const A = load(a), B = load(b);
const keys = new Set([...A.keys(), ...B.keys()]);
let both = 0, same = 0; const onlyA = [], onlyB = [], diff = [];
for (const k of keys) {
  if (!A.has(k)) onlyB.push(k); else if (!B.has(k)) onlyA.push(k);
  else { both++; if (A.get(k) === B.get(k)) same++; else diff.push(`${k}: A=${A.get(k)} B=${B.get(k)}`); }
}
console.log(`listed by both: ${both} (same target: ${same}, ${both ? ((same / both) * 100).toFixed(1) : 0}%); only A: ${onlyA.length}; only B: ${onlyB.length}`);
console.log(`call-listing agreement (Jaccard): ${(both / keys.size * 100).toFixed(1)}%`);
for (const d of diff) console.log('DIFF', d);
for (const k of onlyA) console.log('ONLY-A', k);
for (const k of onlyB) console.log('ONLY-B', k);
