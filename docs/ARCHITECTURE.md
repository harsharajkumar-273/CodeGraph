# CodeGraph — Architecture

CodeGraph turns a repository into a **multi-granular dependency graph** (folders → files → functions → variables) and answers three questions on top of it:

1. **Blast radius** — if I change this function/file/diff, what else could break, and how sure are we?
2. **Slice** — show me only the code that matters for this function: its callers and callees.
3. **Variable lineage** (stage 1, intra-procedural) — where did this variable's value come from, and what does it flow into, inside its own function?

Everything is built on one idea: the graph is a plain, versioned data format (`GraphJSON`). Extractors produce it, analyses and UIs consume it, and none of them know about each other.

## 1. Pipeline

```
 repo on disk / GitHub URL
        │  walk (.gitignore + .codegraphignore + defaults)
        ▼
 ┌──────────────┐   web-tree-sitter (WASM)    ┌───────────────┐
 │ @codegraph/  │ ─────── AST per file ─────▶ │ @codegraph/   │
 │ parser       │                             │ extractors    │
 └──────────────┘                             │  js.ts        │  FileFacts (one file only):
                                              │  python.ts    │  symbols, imports, exports,
                                              └──────┬────────┘  calls, type hints
                                                     │
                                                     ▼
                                              resolve.ts  (cross-file)
                                              module resolution, barrels,
                                              class hierarchy, call resolution
                                                     │
                                                     ▼
                                          CodeGraph  (@codegraph/core)
                                          nodes + edges + confidence
                                       ┌─────────────┼───────────────┐
                                       ▼             ▼               ▼
                               @codegraph/analysis   CLI           Web UI
                               blast · slice ·       (index/impact/  (React Flow,
                               diff · cycles         slice/serve)    semantic zoom)
```

**Why the split between `extractors` and `resolve`?** Extractors are pure functions of *one file's* AST (easy to test, parallelizable, cacheable by content hash). All cross-file knowledge — "what does `./util` point to?", "which class is `Base`?" — lives in the resolver. Adding a language means writing one extractor; the resolver is shared.

## 2. Graph schema (`packages/core`)

| Node kind | Meaning | Id |
|---|---|---|
| `file` | source file | `file:<path>` |
| `function` / `method` / `class` | symbol, with `startLine`/`endLine`, `exported`, `parent` | `sym:<path>#<qualified.name>` |
| `variable` | one local variable/param, scoped to its function (or module) | `var:<path>#<scope>.<name>` |
| `external` | third-party / stdlib package | `ext:<name>` |

| Edge kind | Direction | Notes |
|---|---|---|
| `imports` | file → file \| external | includes re-exports and `require()` |
| `defines` | file → symbol, class → method, function → nested function \| variable | containment |
| `calls` | file \| symbol → symbol | file source = module-level code |
| `extends` | class → base class | |
| `flows` | variable → variable | dataflow: `y = f(x)` ⇒ `x --flows--> y`; self-loop on reassignment/`+=` |

Every edge carries a **confidence**:

- `resolved` — proven through scope/imports/types (e.g. `import {a} from './a'; a()`, `this.repo.get()` where `repo: Repo`).
- `probable` — name-based match with exactly one candidate in the caller's file or the files it imports (directly or through barrels), or a function passed as a value (callback / JSX prop).
- `ambiguous` — several candidates, or a very common method name (`get`, `push`, …).

Analyses take a `minConfidence`; blast-radius results report the **weakest edge on the strongest path** to each impacted node. This is what makes the numbers trustworthy: "12 resolved · 5 probable" is a different statement from "17".

## 3. Packages

```
packages/
  core/        types, CodeGraph (adjacency indexes, subgraph, JSON round-trip)        no deps
  parser/      web-tree-sitter loader, grammar registry (ts, tsx, js, python)
  extractors/  js.ts, python.ts (per-file facts, incl. variable def/use) · resolve.ts (cross-file) · indexer.ts (walk + orchestrate)
  analysis/    blast.ts · slice.ts · lineage.ts · diff.ts · query.ts · cycles.ts      depends on core only
  cli/         index · impact · slice · vars · cycles · serve
  web/         Vite + React + @xyflow/react + dagre; imports analysis directly, so the UI computes impact/lineage in-browser
fixtures/      small repos (ts-basic, py-basic) with hand-verified expected edges
```

`analysis` depends only on `core`, so it runs unchanged in Node, the browser, or a GitHub Action.

## 4. Resolution algorithm

**Modules** (`resolveModule`): relative paths (with `.js → .ts` mapping and `index.*`), `tsconfig` `paths`/`baseUrl` (nearest config), workspace packages by `package.json` name (so monorepo imports like `@scope/pkg` land on real files), Python absolute/relative imports incl. `__init__.py` and `from pkg import submodule`. Anything else is an `external` node.

**Exports** (`lookupExport`): named/default exports, `export { x } from`, `export * from` (barrels), `export * as ns`, CommonJS `module.exports = {…}` / `exports.x =`, Python module namespace including names re-exported through `__init__.py`. Cycle-safe.

**Calls** (`resolveCall`), tried in order:

1. `plain` / `new` / `ref`: lexical scope (innermost enclosing function outwards) → import binding → star imports.
2. `this` / `self`: method lookup on the enclosing class, walking resolved base classes; `super` skips the class itself.
3. `member` (`recv.foo()`):
   1. **Type hints** — `x: Foo` parameters, `const x = new Foo()`, `x = Foo()`, class fields, TS constructor parameter properties (`this.repo`), Python `self.x = Foo()`. Resolved through the class hierarchy.
   2. Static call on a local class.
   3. Receiver is an import binding: namespace/module → export lookup; imported class → static method.
   4. Name-based fallback (`nameFallback`): candidates in the caller's *near files* (self + imports + barrel targets); unique → `probable`, several → `ambiguous`; ubiquitous names are downgraded.

Function references passed as values (`arr.map(handler)`, `onClick={handler}`, `@decorator`) become `ref` calls with `probable` confidence; JSX `<Component/>` counts as a call to `Component`.

## 5. Analyses (`packages/analysis`)

- **`blastRadius(graph, seeds, {maxDepth, minConfidence})`** — reverse reachability over `calls` + `extends`, relaxed so each node keeps its *strongest* path. File seeds expand to all their symbols. Also reports affected files, direct importers of changed files, and likely tests (files holding impacted code or importing them directly; longer import chains are reported separately as "transitive").
- **`slice(graph, seeds, {callersDepth, calleesDepth})`** — induced sub-graph plus merged per-file line ranges, so `codegraph slice --print` prints just the relevant code.
- **`variableLineage(graph, id, {maxDepth})`** — BFS over `flows` edges in both directions from one variable node: `upstream` (what fed it) and `downstream` (what it feeds). See §6 for how the underlying edges are built.
- **`changedNodes` + `parseUnifiedDiff`** — map `git diff -U0` hunks to the innermost changed symbol *or variable* (or the file node for module-level edits): `codegraph impact --diff --range main...HEAD`.
- **`importCycles`** — Tarjan SCCs over file imports.

## 6. Variable lineage — stage 1 (intra-procedural)

Each extractor also emits `VarFact`s per file: one per (re)definition of a local variable — declarations (`const`/`let`/`var`, Python assignment), parameters, `for`/`for-of`/`for-in` loop targets, `catch` variables, and augmented assignment (`+=`) — each carrying the **names read** while producing it (the RHS of `=`, a loop's iterable, a default value).

The resolver (`Resolver.addVariables`) merges all definitions of the same `(scope, name)` into **one graph node** (not SSA-versioned — a variable has one identity across its reassignments, matching how `calls` already models one node per function regardless of call-site count). For each read name, if it's *also* a tracked local variable in the exact same scope, a `flows` edge is added from that variable's node to this one. A name that resolves to a function, import, global, or object field (`this.x`, `self.x`) is not tracked, so it silently drops out of the read list — this is what keeps `flows` edges to what's actually provable within the function, no confidence-tiering needed (there is exactly one legal source-scope for a name, and either that name has a tracked binding or it doesn't).

This produces two intentional, documented gaps for stage 1:

- **Same-scope only.** A free variable read from an enclosing (closure) scope, or a global, is invisible — `flows` edges never cross a function boundary. `f(x) { function g() { return x; } }` will not connect `x` to `g`'s body.
- **No object/array destructuring, no fields.** `const {a, b} = obj` and `self.x = ...` are not tracked as variables yet (though `self.x = Foo()` still contributes a *type hint* for call resolution — that's a separate mechanism, §4).

Self-loops are meaningful and intentional: `count += 1` adds a `flows` edge from `count` to itself, showing the variable carries its value forward across the reassignment (`CodeGraph.addEdge` special-cases `flows` to allow this; every other edge kind drops self-loops).

The CLI's `codegraph vars <function>` lists a function's local variables; `codegraph vars <function.variable>` (or `file#function.variable`) traces one variable's lineage. The web UI does the same by clicking a variable in a file's symbol list — the canvas switches to a dedicated lineage view (blue = the variable, purple = upstream sources, green = downstream uses), separate from the calls/blast-radius view since `flows` and `calls` are different edge kinds answering different questions.

**Stage 2** (not yet built) would replace textual/lexical ordering with a real per-function CFG and reaching-definitions analysis (so a read after a conditional reassignment resolves to the *correct* definition, not just "the merged node for that name"), extend across closures, and add field-sensitive tracking for `this.x`/`self.x`.

## 7. Known limitations (be honest in the README, too)

- Tree-sitter is syntax only. There is no real type checker: types come from annotations and `new`/constructor assignments; inferred return types, generics, union dispatch and duck typing are not followed.
- Dynamic behaviour is invisible: `getattr`, `obj[name]()`, monkey-patching, DI containers, string-based routing, Flask-style `current_app` proxies.
- Call edges to external libraries are intentionally dropped (counted as "unresolved" in stats).
- Python `import a.b.c` chains and conditional/late imports are approximated.
- Variable lineage is intra-procedural and lexical (no CFG yet, no closures, no object fields) — see §6.
- `importCycles` and layout are recursive/synchronous — fine up to tens of thousands of files, not millions.

## 8. Decisions (ADR-lite)

| Decision | Why | Trade-off |
|---|---|---|
| **web-tree-sitter (WASM)**, pinned `0.25.10` with `tree-sitter-wasms@0.1.13` | no node-gyp/native builds; same parser can run in a browser or Action | slower than native; newer runtime versions cannot load the older prebuilt grammars |
| **Confidence-labelled edges** instead of pretending to be exact | static call graphs are heuristic; users can filter | more concepts in the UI |
| **Facts → resolve** two-phase design | per-file extraction is cacheable/parallel; one shared resolver | resolver is the complexity hotspot |
| **No build step** (workspace packages export `.ts`; tsx/vitest/vite consume source) | fast iteration, zero config | must add a build before publishing to npm |
| **`analysis` is pure TS on `core`** | reuse in CLI, browser, Action | — |
| **dagre + React Flow** with folder→file→symbol zoom | good DX; the aggregation keeps graphs readable | React Flow degrades past ~1–2k visible nodes → aggregate, cap, and later add a WebGL renderer |

## 9. Roadmap

1. **v0.2 — Def-use chains, stage 2**: real per-function CFG + reaching definitions (branch-correct, not textual-order); cross-closure lineage; field-sensitive `this.x`/`self.x`; destructuring.
2. **Incremental indexing**: per-file content hash → cached `FileFacts` (SQLite); only re-resolve dirty files + dependents.
3. **Git co-change coupling**: mine `git log` for files that change together and add a `cochange` weight to blast radius (catches coupling static analysis cannot see).
4. **GitHub Action**: comment the blast radius of a PR (`impact --diff --range base...head`) with confidence breakdown and tests to run.
5. **MCP server** exposing `impact` / `slice` / `vars` / `find` to coding agents.
6. **More languages** (Go, Java, Rust) — one extractor each; optional **SCIP** ingestion for compiler-grade precision.
7. **UI**: WebGL renderer (Sigma) for the file-level view, edge bundling, "explain this edge".

## 10. Evaluation plan

Hand-label a sample of call sites (e.g. 200 across 3 repos) and report precision/recall per confidence tier; publish index-time numbers (Flask: 83 files / 1.6k symbols / ~3k variable nodes / 758 flows edges in ~0.25 s; Express: 141 files in ~0.5 s on a laptop-class VM). The fixtures in `fixtures/` already pin expected edges — call, import, and now `flows` — as regression tests.
