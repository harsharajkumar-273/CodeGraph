// Seeded sampler of source windows for hand-labeling recall AND precision on the same code.
// Prints CODE ONLY (no analyzer output) so the ground truth is written blind to what the analyzer found.
//
//   node scripts/eval/sample-windows.mjs <repo-dir> <seed> "<path-prefix>:<count>,..." <out.json> [exclude.json]
//
// `exclude.json` (a previous windows file) keeps a held-out sample from overlapping a development sample.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , repoRoot, seedS, spec, outJson, excludeJson] = process.argv;
const excl = excludeJson ? JSON.parse(readFileSync(excludeJson, 'utf8')) : [];
function rng(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(Number(seedS));
const files = [];
(function walk(d) {
  for (const e of readdirSync(join(repoRoot, d || '.'))) {
    if (['node_modules', '.git', '.codegraph', 'dist'].includes(e)) continue;
    const p = d ? d + '/' + e : e;
    if (statSync(join(repoRoot, p)).isDirectory()) walk(p);
    else if (/\.(js|ts|mjs|cjs|tsx)$/.test(p) && !/\.d\.ts$/.test(p)) files.push(p);
  }
})('');
const WIN = 40, out = [];
for (const item of spec.split(',')) {
  const [prefix, count] = item.split(':');
  const pool = files.filter((f) => f.startsWith(prefix) && readFileSync(join(repoRoot, f), 'utf8').split('\n').length >= WIN + 10);
  let made = 0, tries = 0;
  while (made < Number(count) && tries++ < 10000) {
    const f = pool[Math.floor(r() * pool.length)];
    const n = readFileSync(join(repoRoot, f), 'utf8').split('\n').length;
    const start = 1 + Math.floor(r() * (n - WIN)), end = start + WIN - 1;
    if ([...excl, ...out].some((w) => w.file === f && start <= w.end && end >= w.start)) continue;
    out.push({ file: f, start, end });
    made++;
  }
}
writeFileSync(outJson, JSON.stringify(out, null, 1));
out.forEach((w, i) => {
  const L = readFileSync(join(repoRoot, w.file), 'utf8').split('\n');
  console.log(`\n===== W${i + 1} ${w.file}:${w.start}-${w.end}`);
  for (let k = w.start; k <= w.end; k++) console.log(String(k).padStart(5) + '  ' + L[k - 1]);
});
