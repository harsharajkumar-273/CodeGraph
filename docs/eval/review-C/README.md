# Sample C — human-reviewed validation packet (labels NOT yet provided)

Fresh seeded windows (seed 777001) that exclude every window of samples A and B. The code files contain source
only: no analyzer output, no call lists. Nothing here has been labeled by anyone.

## Protocol
1. Two reviewers label **independently**, without running the analyzer, writing `express.truth.<initials>.json` /
   `zod.truth.<initials>.json` in the format of the `*.TEMPLATE.json` files (and `scripts/eval/score.mjs`'s header):
   every call in a window that executes code in this repo, with `line` = the line the call expression *starts* on and
   `target` = `<file>#<qualifiedName>` of the function that actually runs, or `NOSYM:<why>` when you can name the target
   but the graph has no node for it. Skip calls you cannot name from the source (callbacks/parameters).
   Look up definitions with `node scripts/eval/symbols.mjs <graph.json> '<regex>'` (definitions only, not edges).
2. `node scripts/eval/agreement.mjs a.json b.json` -> resolve every DIFF / ONLY-* together into
   `express.truth.json` / `zod.truth.json` (keep `reviewer` as e.g. `AB`).
3. `node scripts/eval/validate-truth.mjs <truth> docs/eval/<repo>C.windows.json <graph.json>`
4. Score base vs. current code with `scripts/eval/dump-call-sites.mts` + `scripts/eval/score.mjs` (see
   `docs/EVALUATION.md`, "Reproduce"). Base = commit `88469cd` plus the trace hook (the dump script needs `trace`).
5. Report the result **next to** A/B, with the same qualifications: A is development data, B is only partly blind to
   the last import fixes, and a sample labeled by humans is the first one not touched by the analyzer author's LLM.

Pinned sources: Express `9efc29e280aa…`, Zod `0b216ef674e2…` (shallow clone HEAD at the time; `git checkout` them).
