// Scores CodeGraph's per-call-site verdicts against the TypeScript-compiler oracle (scripts/eval/ts-oracle.mts).
//
//   node scripts/eval/score-oracle.mjs <sites.jsonl> <oracle.jsonl> [--by-tier] [--examples N]
//
// Sites are matched on file|line|callee ('ref' rows excluded: those are callbacks passed by name, not calls).
// Oracle verdicts `abstract` and `unknown` carry no ground truth and are excluded; they are counted, not scored.
//   internal sites  -> recall: found / wrongOnly / unresolved / notExtracted
//   nosym, external -> the right answer is no edge: clean / falseEdge
//   edges           -> every target CodeGraph emitted at a scored site is correct (in the oracle's alts) or incorrect
import { readFileSync } from 'node:fs';

const [, , sitesPath, oraclePath, ...flags] = process.argv;
const N = Number(flags[flags.indexOf('--examples') + 1]) || 0;
const rd = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const key = (r) => `${r.file}|${r.line}|${r.callee}`;
const group = (arr) => arr.reduce((m, x) => (m.get(key(x)) ?? m.set(key(x), []).get(key(x))).push(x) && m, new Map());
const cg = group(rd(sitesPath).filter((r) => r.kind !== 'ref'));
const oracle = group(rd(oraclePath));
const isTest = (f) => /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[mc]?tsx?$|(^|\/)test_[^/]*\.py$|_test\.py$/.test(f);

const blank = () => ({
  sites: { internal: 0, nosym: 0, external: 0, abstract: 0, unknown: 0 },
  internal: { found: 0, wrongOnly: 0, unresolved: 0, notExtracted: 0 },
  nosym: { clean: 0, falseEdge: 0 }, external: { clean: 0, falseEdge: 0 },
  edges: { correct: 0, incorrect: 0, byTier: {} },
});
const all = blank(), strata = { src: blank(), test: blank() };
const examples = { wrongOnly: [], falseEdgeExternal: [], falseEdgeNosym: [], unresolved: [] };
const push = (k, x) => examples[k].length < N && examples[k].push(x);

for (const [k, os] of oracle) {
  // Pair oracle rows with CodeGraph rows at the same key. Several calls with one name on one line are paired so that
  // each CodeGraph row goes to an oracle row it agrees with when there is one.
  const cs = [...(cg.get(k) ?? [])];
  const pairs = os.map((o) => {
    let i = cs.findIndex((c) => c.targets.some((t) => o.alts?.includes(t.file + '#' + t.qname)));
    if (i < 0) i = 0;
    return [o, cs.splice(i, 1)[0]];
  });
  for (const [o, c] of pairs) {
    for (const acc of [all, strata[isTest(o.file) ? 'test' : 'src']]) {
      acc.sites[o.verdict]++;
      if (o.verdict === 'abstract' || o.verdict === 'unknown') continue;
      const got = (c?.targets ?? []).map((t) => ({ id: t.file + '#' + t.qname, tier: t.confidence }));
      for (const g of got) {
        const ok = o.verdict === 'internal' && o.alts.includes(g.id);
        const tier = (acc.edges.byTier[g.tier] ??= { correct: 0, incorrect: 0 });
        ok ? (acc.edges.correct++, tier.correct++) : (acc.edges.incorrect++, tier.incorrect++);
      }
      if (o.verdict === 'internal') {
        if (!c) acc.internal.notExtracted++;
        else if (got.some((g) => o.alts.includes(g.id))) acc.internal.found++;
        else if (got.length) acc.internal.wrongOnly++;
        else acc.internal.unresolved++;
      } else acc[o.verdict][got.length ? 'falseEdge' : 'clean']++;
      if (acc !== all) continue;
      const ex = { at: `${o.file}:${o.line}`, callee: o.callee, want: o.target ?? o.at, got: got.map((g) => `${g.id} (${g.tier})`) };
      if (o.verdict === 'internal' && c && got.length && !got.some((g) => o.alts.includes(g.id))) push('wrongOnly', ex);
      if (o.verdict === 'internal' && c && !got.length) push('unresolved', ex);
      if (o.verdict === 'external' && got.length) push('falseEdgeExternal', ex);
      if (o.verdict === 'nosym' && got.length) push('falseEdgeNosym', ex);
    }
  }
}

const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null);
const summary = (s) => {
  const emitted = s.edges.correct + s.edges.incorrect;
  const tiers = Object.fromEntries(Object.entries(s.edges.byTier).map(([t, v]) => [t, { ...v, precision: pct(v.correct, v.correct + v.incorrect) }]));
  return {
    ...s, edges: { ...s.edges, byTier: tiers }, emitted,
    precision: pct(s.edges.correct, emitted),
    recall: pct(s.internal.found, s.sites.internal),
    externalFalseEdgeRate: pct(s.external.falseEdge, s.sites.external),
    nosymFalseEdgeRate: pct(s.nosym.falseEdge, s.sites.nosym),
  };
};
console.log(JSON.stringify({ all: summary(all), src: summary(strata.src), test: summary(strata.test), ...(N ? { examples } : {}) }, null, 1));
