# Receiver / import resolution: collisions, fixes, and a recall-aware evaluation

Follow-up to [`PRECISION.md`](PRECISION.md), which found two classes of wrong call edges:

1. **Express** — a receiver named `app` resolved to the unrelated `res.get` (same method name, different
   prototype object).
2. **Zod** — calls from `v4/*` code resolved to the `v3` implementation of the same API name.

A precision gain alone could come from emitting fewer edges, so this evaluation reports **correct, incorrect,
missed and unresolved separately**, against hand-labeled ground truth that includes calls the analyzer never found.

## What was wrong (root causes)

| Symptom | Root cause |
|---|---|
| `res.json` → `res.get` shown as **resolved** (the one "undiagnosed" bug in PRECISION.md) | Two bugs. (a) `CodeGraph.addEdge` dedups per caller/callee, keeps the *first* call site's `line` but the *highest* confidence — so the correct `this.get()` (resolved) lent its tier to the wrong `app.get()` site. (b) `app.get` is attached in a `methods.forEach(m => app[m] = …)` loop, so no `app.get` symbol exists, and the bare-name fallback grabbed `res.get`. |
| `route.all` → `User.all` | Name-only fallback with no use of the receiver. |
| `v4` → `v3` (`parse`, `safeParse`, `trim`, …; ~5,400 sites in Zod) | v4's instance methods are object-literal methods passed to `$constructor(...)`, which are not extracted, so the *only* repo-wide candidate was v3's. The global fallback accepted it. |
| `schema.parse` → one test's `schema.parse = () => "overridden"` (~720 sites, introduced mid-way by my first affinity attempt and caught in review) | Prototype-style assignments inside anonymous test callbacks were recorded as module-level methods. |
| 13 of 20 (sample A) and 19 of 20 (sample B) remaining Express misses were `express()` | Two import bugs: `require('..')` / `require('../')` never resolved to the root `index.js` (the index probe built `'/index.js'`), and `module.exports = require('./lib/express')` forwarding was not modelled. |

## Fixes

- **Receiver ↔ owner affinity** (`resolve.ts`, `nameFallback`): a receiver whose last segment equals a method
  owner's name (`app` ↔ `app.*`, `route` ↔ `Route.*`, `self.app` ↔ `App.*`) selects that owner. If the receiver names a
  known prototype-style owner that has no such method, a same-named method on a *different* owner is no longer
  offered (→ unresolved, not wrong). Skipped when the receiver is an imported name (`import flask.views` ⇒
  `flask.make_response()` is the module, not class `Flask`).
- **Unreached sibling tree** (`resolve.ts`): the repo-wide bare-name guess is dropped when the candidate lives in a
  sibling subtree (`v3/` vs `v4/`) that nothing the caller imports ever reaches — **but only when the caller has at
  least one resolved internal import**. With no resolved imports there is no evidence about its tree, so the old
  guess stands (found via Flask: `from flaskr import …` is unresolvable, and `app.app_context()` is a true edge).
- **Test-local monkeypatches** (`js.ts`): `x.m = …` inside an anonymous callback is flagged `local` when `x` is a
  local variable, and is never offered to other files. Owners that are the callback's *parameter*
  (`$constructor("X", (inst) => { inst.min = … })`) are real definitions and stay normal.
- **Imports**: `exports` subpath maps for workspace packages (`zod/v4`, `zod/mini`), `require('..')` → root
  `index.js`, and `module.exports = require('./x')` as a forwarded default export.
- **Edge merge**: the surviving edge now reports the call site that earned its confidence.
- `indexFiles/indexRepo` accept a `trace` callback so every call site's verdict can be inspected.

Fixtures: `fixtures/express-proto`, `fixtures/zod-versions`, `fixtures/py-affinity`; tests in
`packages/extractors/test/collisions.test.ts`. The `app.get`, `route.all`, v4→v3 and mini fan-out tests were seen
failing before their fix; the monkeypatch, `require('..')`, forwarding and initializer-parameter tests were written
alongside theirs; the `py-affinity` guard test was verified by disabling the guard (it then fails). Existing fixtures and tests are unchanged and pass (60 tests).

## Method

- Code under test: Express `9efc29e`, Zod `0b216ef`, Flask `d086db8` (shallow clones, HEAD at evaluation time).
- **Sample A (development)** and **sample B (held-out)**: seeded 40-line windows (seed 20261008 / 4242;
  B excludes any overlap with A). Express: 12 windows each; Zod: 14 each; stratified across `lib`, tests, examples,
  and Zod's v3 / v4 classic / core / mini.
- For each window **every call that executes repo code was labeled from the source, before any analyzer output
  was viewed** (`docs/eval/*.truth.json`; `NOSYM:<why>` marks calls whose target a human can name but the graph has no
  node for). Calls through parameters/callbacks that can't be named from source are not labeled — so an edge there
  counts as incorrect.
- Scoring is **per call site** (the graph dedups edges), `ref` (callback-by-reference) sites excluded.
  `node scripts/eval/score.mjs …`; after scoring, every emitted edge at an unlabeled site was audited by hand.
  Labeling errors found this way (two wrong line numbers, a wrong target name and an omitted call in Zod A; an
  unlabeled stretch of one window in Zod B) were corrected in the truth file — and the audit also surfaced real false
  positives (`Number.isFinite` → `ZodNumber.isFinite`, `Set.add` → `$ZodRegistry.add`) that stay counted as incorrect.
- **Single labeler (an LLM) — no inter-annotator agreement.** Windows are small (40 lines) and clustered, so the
  confidence intervals are wide.

## Results (final code)

“resolvable” = the target has a graph node (recall denominator). “unrepresentable” = a real call whose target
has no node (object-literal methods, dynamic definitions, aliased/const-bound exports) — correct behaviour is to emit nothing.

| Sample | | real calls | resolvable | edges emitted | **correct** | **incorrect** | precision | **recall** (of resolvable) | missed: unresolved / wrong-only / not extracted | unrepresentable: clean / false edge |
|---|---|---|---|---|---|---|---|---|---|---|
| Express A (dev) | before | 80 | 65 | 31 | 31 | 0 | 100% | 48% | 34 / 0 / 0 | 15 / 0 |
| | after | 80 | 65 | 58 | 58 | 0 | 100% | **89%** | 7 / 0 / 0 | 15 / 0 |
| Express B (held-out) | before | 64 | 60 | 36 | 36 | 0 | 100% | 60% | 24 / 0 / 0 | 4 / 0 |
| | after | 64 | 60 | 57 | 57 | 0 | 100% | **95%**¹ | 3 / 0 / 0 | 4 / 0 |
| Zod A (dev) | before | 198 | 164 | 167 | 128 | 39 | 77% | 78% | 36 / 0 / 0 | 10 / 24 |
| | after | 198 | 164 | 131 | 128 | 3 | **98%** | 78% | 36 / 0 / 0 | 32 / 2 |
| Zod B (held-out) | before | 215 | 135 | 189 | 133 | 56 | 70% | 98.5% | 2 / 0 / 0 | 41 / 39 |
| | after | 215 | 135 | 143 | 133 | 10 | **93%** | 98.5% | 2 / 0 / 0 | 75 / 5 |

Reading it:

- **Zod: the precision gain is pure error removal, and it removes no correct edge** — correct edges are 128→128 and
  133→133 while the 36 (A) and 46 (B) *ambiguous* edges — none of them correct — disappear. Recall does not move: those v4
  calls had no correct answer to find (object-literal methods), so they are now honestly unresolved.
- **Express: recall rose without losing precision** — correct 31→58 and 36→57, incorrect stays 0. Random windows
  contain almost no collisions (the baseline was already 100% precise there); the collision fixes are verified by the
  targeted checks below and by the fixtures.
- ¹ Held-out B before the last two import fixes: **40/60 = 67%** with 0 incorrect. The remaining gain
  (`express()` → `createApplication`) was found by looking at B's misses, so B is no longer blind to it. The precision
  of that fix was checked on separate data: 22 of 22 sampled new `resolved` edges (of 652) were correct.
- Strict recall including unrepresentable calls: Express 73% / 89%, Zod 65% / 62% (A / B).
- Samples are small and clustered: all 36 Zod-A misses come from one file (`v3/tests/readonly.test.ts`,
  `z.string()` → `ZodString.create` through `const stringType = ZodString.create; export { stringType as string }`).

### Targeted check of the sites the changes touched

(Random windows can't test the collision fixes, so changed call sites were sampled and labeled separately.)

| Repo | Class | Result |
|---|---|---|
| Express | gained edges (ambiguous/none → probable), 14 sampled of 1,475 | 14/14 correct (`app.use/set/enable`, `res.send`, `req.*`) |
| Express | dropped edges (all 14 at the time; 13 in the final code) | 14/14 were wrong (`app.get`→`res.get`, `express.json`→`res.json`, `self.engine`→`app.engine`); an earlier version also dropped 2 *true* `app.use` edges — traced to the `require('..')` bug and fixed |
| Express | retargeted, 8 sampled | 4 now correct (`app.render`), 4 still wrong (`router.route().all()` etc. — external `router` package) |
| Zod | dropped, 18 sampled of 5,373 | 18/18 were wrong v3 targets for v4 calls |
| Zod | retargeted, 8 sampled | 3 correct, 5 still wrong (files importing **both** v3 and v4) |
| Flask | changed sites (44 of 5,276), ~40 reviewed individually | gained `App.add_url_rule` / `register_blueprint`-style edges looked correct; the 4 dropped (`MockCtx.exit`, `View.index`, `ObjectWithHTML.__html__`) were wrong test-local targets; found and fixed two regressions of my own: dropped true `app.app_context()` edges, and `flask.make_response()` → `Flask.make_response` |

## Known limits (not fixed)

- **Unresolved by design, and large for Zod v4**: methods defined as object literals passed to `$constructor(…)`,
  `app[method] = …` loops, `export const decode = _decode(…)`, `a = b = function` aliases (`res.set`/`req.get` are
  recorded only as `res.header`/`req.header`), `export { stringType as string }` over a static method. These show up
  as *missed*, never as wrong edges.
- **Residual wrong edges** (the 10 Zod-B / 3 Zod-A): native-API name collisions (`Number.isFinite`, `Math.min`,
  `Set.add` matching the library's own `isFinite`/`min`/`add`), and `inst.min` — one graph node standing in for several
  different `inst.min = …` functions. Files that import both v3 and v4 (benchmarks) still cross-wire, and callers whose
  imports don't resolve internally (aliased npm copies like `zod3`) keep the old low-confidence guess.
- Affinity upgrades a name match to `probable` when the receiver name equals a single owner; it is a naming
  convention, not proof. none of the ~25 such edges I read (14 Express, the Flask ones) were wrong, but a variable that happens to share an owner's
  name will be mislinked.

## Reproduce

```bash
git clone --depth 1 https://github.com/expressjs/express  && git -C express checkout 9efc29e
npx tsx scripts/eval/dump-call-sites.mts express sites.jsonl
npm run cg -- index express            # writes express/.codegraph/graph.json (node-existence check)
node scripts/eval/score.mjs sites.jsonl docs/eval/expressB.truth.json docs/eval/expressB.windows.json express/.codegraph/graph.json
# new samples: node scripts/eval/sample-windows.mjs express <seed> "lib/:6,test/:4" out.json docs/eval/express.windows.json
```
