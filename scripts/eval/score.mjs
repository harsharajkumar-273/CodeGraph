// Scores a call-site dump against hand-written ground truth, edge by edge.
//
//   node scripts/eval/score.mjs <sites.jsonl> <truth.json> <windows.json> <graph.json>
//
// truth.json entries: { file, line, callee, target } where `line` is the line the call expression STARTS on
// (a `z\n.a()\n.b()` chain starts on the `z` line) and `target` is `<file>#<qualifiedName>` of the function that
// really runs, or `NOSYM:<why>` when a human can name the target but the graph has no node that represents it
// (dynamic definitions, object-literal methods, aliased exports, ...). Calls to callbacks/parameters that cannot be
// named from the source are NOT listed; if the analyzer emits an edge there it counts as incorrect.
//
// Reported separately:
//   correct edges        emitted edge == the labeled target
//   incorrect edges      emitted edge is anything else, incl. an edge at a call that is not to repo code at all
//   missed (resolvable)  the target has a graph node, but no correct edge was emitted:
//                          unresolved   = the call was seen and the resolver returned nothing
//                          wrongOnly    = it returned only wrong targets
//                          notExtracted = no call fact at that site
//   unrepresentable      the target has no graph node (NOSYM): clean = no edge emitted (right), FP = an edge was emitted (wrong)
import { readFileSync } from 'node:fs';

const [, , sitesPath, truthPath, winPath, graphPath] = process.argv;
const rd = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const rows = rd(sitesPath);
const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
const wins = JSON.parse(readFileSync(winPath, 'utf8'));
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const nodes = new Set(graph.nodes.map((n) => n.file + '#' + n.qualifiedName));
const inWin = (r) => wins.some((w) => w.file === r.file && r.line >= w.start && r.line <= w.end);
const sites = rows.filter((r) => inWin(r) && r.kind !== 'ref'); // 'ref' = callback-by-reference, not a call
const key = (f, l, c) => `${f}|${l}|${c}`;
const group = (arr, k) => arr.reduce((m, x) => (m.get(k(x)) ?? m.set(k(x), []).get(k(x))).push(x) && m, new Map());
const byKey = group(sites, (s) => key(s.file, s.line, s.callee));
const tk = group(truth, (t) => key(t.file, t.line, t.callee));

const res = { truth: truth.length, representable: 0, unrepresentable: 0, found: 0, unresolved: 0, wrongOnly: 0, notExtracted: 0, unrepClean: 0, unrepFalsePositive: 0 };
const missingNodes = [];
const detail = [];
for (const [k, ts] of tk) {
  const ss = byKey.get(k) ?? [];
  ts.forEach((t, i) => {
    const rep = !t.target.startsWith('NOSYM');
    if (rep && !nodes.has(t.target)) missingNodes.push(t.target);
    rep ? res.representable++ : res.unrepresentable++;
    const s = ss[i];
    if (!s) { res.notExtracted++; detail.push(['NOT-EXTRACTED', t]); return; }
    const got = s.targets.map((x) => x.file + '#' + x.qname);
    if (rep) {
      if (got.includes(t.target)) res.found++;
      else if (got.length) { res.wrongOnly++; detail.push(['WRONG-ONLY', t, got]); }
      else { res.unresolved++; detail.push(['UNRESOLVED', t]); }
    } else if (got.length) { res.unrepFalsePositive++; detail.push(['UNREP-BUT-EMITTED', t, got]); }
    else res.unrepClean++;
  });
}
const edges = { correct: 0, incorrect: 0, byTier: {} };
const unlabeled = [];
for (const [k, ss] of byKey) {
  const ts = tk.get(k) ?? [];
  ss.forEach((s, i) => {
    for (const x of s.targets) {
      const ok = ts[i] && ts[i].target === x.file + '#' + x.qname;
      const tier = (edges.byTier[x.confidence] ??= { correct: 0, incorrect: 0 });
      if (ok) { edges.correct++; tier.correct++; }
      else { edges.incorrect++; tier.incorrect++; if (!ts[i]) unlabeled.push([s.file, s.line, s.callee, x.file + '#' + x.qname, x.confidence]); }
    }
  });
}
const emitted = edges.correct + edges.incorrect;
console.log(JSON.stringify({
  ...res, edges, emitted,
  precision: emitted ? +(edges.correct / emitted).toFixed(3) : null,
  recallOfResolvable: res.representable ? +(res.found / res.representable).toFixed(3) : null,
  missingNodes: [...new Set(missingNodes)],
}, null, 1));
if (process.env.DETAIL) {
  for (const d of detail) console.log(d[0], `${d[1].file}:${d[1].line}`, d[1].callee, 'want', d[1].target, d[2] ? 'got ' + d[2].join(',') : '');
  console.log('--- emitted at call sites with no label (audit each: a real call I forgot to label, or a false positive?)');
  for (const u of unlabeled) console.log(u.join(' | '));
}
