# Compiler-oracle evaluation (TypeScript)

The earlier evaluations ([`PRECISION.md`](PRECISION.md), [`EVALUATION.md`](EVALUATION.md)) were labeled by the
analyzer author's LLM on a few hundred call sites. They were also partly on repos the resolver was tuned against.
That shows CodeGraph working; it is not independent evidence that it is accurate. This evaluation swaps the labeler
for the **TypeScript compiler's own type checker**, scores **every** call site in each repo instead of a sample, and
runs on three repos that were **picked before any result was seen and never used during development**.

What this is not: evidence of adoption. Nobody outside the project has used or reviewed these results, and the
human-labeled sample C ([`EVALUATION.md`](EVALUATION.md#human-reviewed-validation-sample-c--pending)) is still
unlabeled.

## Method

- **Oracle** (`scripts/eval/ts-oracle.mts`). The script builds one `ts.Program` over every `.ts/.tsx` file in the
  repo, using the root `tsconfig` compiler options. For each `f()`, `a.b.f()`, `this.f()` and `new F()` it asks
  `checker.getSymbolAtLocation`, follows import aliases and `const f = g` chains, and records one of these verdicts:
  - `internal`: the call resolves to a repo function/method/class that has a graph node.
  - `nosym`: it resolves to repo code with no graph node, such as an object-literal method, a class-field arrow
    `text = () => …`, or `const parse = _parse(Err)`. The right answer here is no edge.
  - `external`: it resolves to `lib.d.ts`/`node_modules`. Any internal edge is wrong.
  - `abstract`: it resolves to an interface or overload signature, so the runtime target can't be determined
    statically. Excluded.
  - `unknown`: the checker can't resolve it. Excluded.
- **Scoring** (`scripts/eval/score-oracle.mjs`). Scoring is per call site, matched on `file|line|callee`. Callbacks
  passed by name (`ref`) are excluded. Each emitted edge counts as correct or incorrect. Recall is computed over the
  `internal` sites.
- **Oracle check.** About 120 disagreements across the four repos were inspected, and about a dozen of them were
  traced by hand to the source. Two oracle bugs turned up and were fixed before the numbers below were produced:
  - a `const f =\n () => …` declaration did not map to its node;
  - a local bound to a call result was mapped to the enclosing function.

  After the fixes, every disagreement traced to the source was a real CodeGraph error.
- **Repos.** Dependencies were not installed. Hono `5ca49b07`, Immer `a42c121e` and NestJS `62647d3e` were chosen up
  front for different styles (a class-heavy web framework, a small functional/class library, and a decorator/DI
  monorepo with `tsconfig` paths). Zod at `afdac65e` is included for comparison, but it is **development data**: its
  earlier failures drove the resolver fixes.

## Results

All call sites. The `src` rows exclude test files.

| Repo | | oracle-resolved calls | recall | `resolved` precision | `probable` precision | `ambiguous` precision | all edges | false edge at external call | false edge at no-node call |
|---|---|---|---|---|---|---|---|---|---|
| **Hono** | all | 7,750 | 99.2% | 7,261/7,357 (98.7%) | 100/349 (**28.7%**) | 328/2,406 (13.6%) | 76.0% | 11.9% | 56.4% |
| | src | 1,136 | 99.5% | 1,063/1,067 (99.6%) | 11/23 (47.8%) | 56/141 (39.7%) | 91.8% | 1.8% | 31.4% |
| **Immer** | all | 576 | 100% | 573/581 (98.6%) | 3/3 | 0/109 (0%) | 83.1% | 26.5% | 5.5% |
| | src | 322 | 100% | 320/320 (100%) | 2/2 | 0/79 (0%) | 80.3% | 24.4% | 0% |
| **NestJS** | all | 13,839 | 98.4% | 13,123/13,435 (97.7%) | 369/453 (81.5%) | 122/1,112 (11.0%) | 90.8% | 9.0% | 37.6% |
| | src | 3,590 | 98.7% | 3,434/3,434 (100%) | 75/103 (72.8%) | 36/414 (8.7%) | 89.7% | 8.4% | 2.0% |
| *Zod (dev)* | all | 16,773 | 97.4% | 14,277/14,302 (99.8%) | 1,769/1,822 (97.1%) | 292/706 (41.4%) | 97.1% | 3.8% | 1.3% |
| | src | 4,343 | 96.6% | 3,965/3,965 (100%) | 113/143 (79.0%) | 116/273 (42.5%) | 95.7% | 4.9% | 0% |

Pooled over the three fresh repos:

| Tier | Correct / emitted | Precision |
|---|---|---|
| `resolved` | 20,957 / 21,373 | 98.1% |
| `probable` | 472 / 805 | 58.6% |
| `ambiguous` | 450 / 3,627 | 12.4% |

Per-repo JSON, with example errors in each category, is in `docs/eval/oracle/`. These tables are from the code at
the time of the evaluation; for the effect of the parse fix found by it, see [below](#fix-1-files-the-parser-silently-dropped).

### What changes relative to the earlier claims

- **`resolved` holds up: 97.7–99.8%, and 100% in non-test code in every repo.** Almost all of the errors inspected
  come from one cause. Same-named locals in different test callbacks share a qualified name, so they collapse
  into one graph node: `createApp` in one `it()` links to the `createApp` of another (Nest, Hono tests).
- **`probable` does not hold up in general.** PRECISION.md reported 97%, from 33 LLM-labeled edges. On fresh repos it
  ranges from 29% (Hono) to 82% (Nest), with Zod's 97% being the tuned case. For Hono, every sampled error falls into
  two categories:
  - `Context.text/json/header` had no graph node, so `c.text()` fell back to the only other `text` method,
    `HonoRequest.text`. The cause turned out not to be the class-field arrows themselves but a parse failure that
    dropped all of `src/context.ts`; see [Fix 1](#fix-1-files-the-parser-silently-dropped).
  - Web-platform `Response.text()/json()` calls collide with those same internal names.

  The README's "resolved/probable are 97% accurate" therefore holds for `resolved` but overstates `probable`.
- **`ambiguous` is worse than reported:** 0–14% on fresh repos, against 45% in PRECISION.md. It is hidden by default
  (`--min-confidence probable`), and should be read as a list of name matches, not edges.
- **Native-API name collisions** are the main source of false edges outside `resolved`. Calls like `Map.get`,
  `Set.add` and `Response.text` match an internal method of the same name, at 2–27% of external call sites.
- **Recall is high (97–100%), but only on calls the type checker can resolve.** That set is biased toward easy,
  statically-typed calls. Interface-dispatched and untyped calls are excluded, and they are where CodeGraph is
  weakest.

## Fix 1: files the parser silently dropped

The Hono errors led to a tree-sitter-typescript bug. In an interface of overloaded call signatures with no `;`
between them,

```ts
  ): Response
  <T extends null>(data: T): Response
```

the line break is read as `Response<T extends …`. In large interfaces the resulting error spreads to the end of the
file, so every class and function after it vanishes from the graph, with no warning. That is what happened to all of
Hono's `src/context.ts`, as well as `src/types.ts`, `src/helper/factory/index.ts` and Immer's
`src/types/types-external.ts`. The newer 0.23 grammar has the same bug; it just recovers better on some files.

`parse()` now retries a TS/TSX file that has errors with a `;` appended to lines that end a type and are followed by
a line starting with `<`. Line numbers are unchanged, and the retry is kept only if it has fewer error lines. The
`fixtures/ts-grammar` test fails without the retry. It is still a heuristic: one Nest test file (a parenthesized
decorator, `@((…))`) still has parse errors.

Re-run on the same commits:

| Repo | | oracle-resolved calls | correct edges found | `resolved` | `probable` | `ambiguous` | all edges | false edge at external call |
|---|---|---|---|---|---|---|---|---|
| Hono | before | 7,750 | 7,689 | 7,261/7,357 (98.7%) | 100/349 (28.7%) | 328/2,406 (13.6%) | 76.0% | 949 / 7,959 |
| | after | 9,824 | 9,668 | 8,132/8,225 (98.9%) | 490/868 (56.5%) | 1,046/3,099 (33.8%) | 79.3% | 1,278 / 7,959 |
| Immer, NestJS, Zod | | unchanged | | | | | | |

About 2,000 calls into `Context` now have a target to find, and 1,979 more correct edges are emitted. Most of the
remaining `probable`/`ambiguous` errors are native-API collisions: now that `Context.text`/`json` exist, Web
`Response.text()/json()` calls get linked to them, which raised false edges at external calls from 949 to 1,278.
Those collisions are the next problem to fix.

Pooled over the three fresh repos after the fix: `resolved` 21,828 / 22,241 (98.1%), `probable` 862 / 1,324
(65.1%), `ambiguous` 1,168 / 4,320 (27.0%). Hono's non-test `resolved` edges are 1,107 / 1,108. `hono.parse-fix.json`
holds the re-run.

## Limits of this evaluation

- **Scope.** Only TypeScript is covered: no JavaScript (Express, Immer's JS tests) and no Python (Flask). Only the
  call shapes CodeGraph extracts are scored, and JSX is skipped.
- **Coverage.** With dependencies not installed, `unknown` is large. It is mostly test-framework globals (`expect`,
  `describe`), so it is mostly external anyway. Even so, a share of CodeGraph's edges cannot be scored at all:
  - Hono: 1,374 of 11,486 edges (12%) are unscored, mostly JSX.
  - Nest: 11,294 of 26,296 edges (43%) are unscored, mostly calls on mocks and on DI-typed values the checker couldn't
    type.
  - Immer: 1,090 of 1,783 edges (61%) are unscored, because its tests are `.js`.
- **Oracle semantics.** The checker reports the *declared* target. Where a subclass overrides the method at runtime,
  the base declaration counts as truth. Where several declarations share one qualified name (overloads, or a static
  and an instance `log`), an edge to the collapsed node counts as incorrect.
- **Independence.** The oracle is independent of CodeGraph and of the LLM labeler, but the method, the oracle script
  and this write-up are all by the same author. Nobody else has reproduced these results.

## Reproduce

```bash
git clone https://github.com/honojs/hono && git -C hono checkout 5ca49b0720755c585c9a9835f0a479ceea36fb52
# Immer a42c121e5ee740aec9b4f128e93858dacbe3847e · NestJS 62647d3ec95e816a4556b3e04106eb4af002b4b8 · Zod afdac65e0f80c0ccf9e8909da97c411567908b57
npm run cg -- index hono
npx tsx scripts/eval/dump-call-sites.mts hono hono.sites.jsonl
npx tsx scripts/eval/ts-oracle.mts hono hono/.codegraph/graph.json hono.oracle.jsonl
node scripts/eval/score-oracle.mjs hono.sites.jsonl hono.oracle.jsonl --examples 10
```

Each repo takes well under a minute.
