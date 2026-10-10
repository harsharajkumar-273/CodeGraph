// Dumps the resolver's verdict for EVERY call site (one JSON line each). The graph itself dedups edges per
// caller/callee pair, so recall/precision at call-site level has to come from the trace hook.
//
//   npx tsx scripts/eval/dump-call-sites.mts <repo-dir> <out.jsonl>
import { writeFileSync } from 'node:fs';
import { indexRepo } from '../../packages/extractors/src/index.ts';

const [, , repo, out] = process.argv;
const rows: unknown[] = [];
await indexRepo(repo, {
  trace: (t) =>
    rows.push({ file: t.file, caller: t.call.caller, callee: t.call.callee, receiver: t.call.receiver ?? null, kind: t.call.kind, line: t.call.line, targets: t.targets }),
});
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n'));
console.log(`${out}: ${rows.length} call sites`);
