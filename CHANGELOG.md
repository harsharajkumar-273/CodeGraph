# Changelog

All notable changes to [`codegraph-engine`](https://www.npmjs.com/package/codegraph-engine).

## Unreleased

### Fixed
- **Every call to a removed function is reported**, not one per calling function (a function that called the removed one three times showed only one line). Found by the mutation benchmark.
- **Diffs no longer inflate the blast radius.** An edit on a line that declares a local variable is a change to its function (it used to be attributed to the variable, which has no callers, so the function's blast radius came out empty), and a module-level edit such as an import line no longer counts every symbol in the file as changed. Symbols a diff adds in full are reported as new instead of as changes. The pull request comment now counts only callers outside the files the change edits, says plainly when a change only adds code, and gives a test command per ecosystem (`go test ./pkg`, `pytest`, `vitest`/`jest`).
- **Python function-local imports** (`def f(): from x import y`) are scoped to that function instead of replacing the file's import of the same name, and shadow a same-named function outside it. Removes one `resolved` error each in Flask and Rich in the Jedi check.

### Added
- **Agent tools** (MCP): `codegraph_check_change` (give it the new text of the files you are about to write; reports calls left behind by a removed function, calls with the wrong number of arguments, removed public API, who is reached and which tests to run, without writing anything), `codegraph_verify_symbol` (does it exist, with what parameters; closest names if not) and `codegraph_repo_map`. The server's index now follows the files on disk. Measured in `docs/AGENT-EVAL.md`.
- **An optional model reading of the change** in the pull request comment (`anthropic-api-key` input, or `codegraph impact --ai` with `ANTHROPIC_API_KEY`): what the change does, whether it matches the description, and what to check. Off unless a key is set, never used for fork pull requests, and the diff, description and facts it sends are quoted as untrusted data.
- **Line comments on the pull request diff** for findings that have a line: a removed function that is still called (on its deleted definition), a signature that call sites no longer fit (on the new signature, naming the calls), public API removed. Replaced on each push, kept when answered. `inline-comments: all` adds a note on edits to widely used code. The action now analyses the pull request's own commit so line numbers match GitHub's diff. `codegraph impact --inline-out <file>` writes them as JSON.
- **A verdict at the top of the pull request comment**: 🔴 likely breaking, 🟠 may change public API, 🟡 changes shared code, 🟢 contained or additive. A changed signature is checked against how many arguments each call site passes, and the comment names the calls that no longer fit. Argument counts are recorded for TypeScript, JavaScript, Python and Go.
- **The pull request comment catches removed or renamed functions that are still called.** It indexes the base commit as well, and lists any function that existed before, is gone now, and has a surviving caller that still calls the old name. Works for TypeScript, JavaScript, Python and Go. `codegraph impact --no-compare` skips it.
- **The pull request comment groups callers by the edit that reaches them** (the riskiest edit first, top-level code marked as such), shows the test command once with "N of M test files", and says when a change touches most of the suite.
- **Go support.** `.go` files are indexed (CLI, web app, MCP, pull request comments): packages resolved through `go.mod`, methods attached to their types, struct embedding and promoted methods, interfaces, typed variables through constructors, results, ranges and fields, and `//go:build` for linux/amd64. Checked against the Go type checker on Cobra, Gin, Logrus and gorilla/mux: 98.5% of the calls it resolves are found, and every one of 7,550 edges is correct (first run, before any fix: 96.8% and 7,336 of 7,339). Details and limits in `docs/ORACLE-EVAL.md`.
- **Private repositories in the web app**: paste a GitHub personal access token on the home page. It stays in the browser tab, is sent only to `api.github.com`, and also raises GitHub's limit from 60 to 5,000 requests an hour.
- **`codegraph mcp`**: an MCP server (stdio) so AI agents can ask what a change touches: impact of a symbol or of the current diff, callers and callees, symbol search, an overview of the riskiest code.
- **A GitHub Action** (`uses: harsharajkumar-273/CodeGraph@main`) that comments on pull requests with the symbols, files and tests a change can reach, with an optional `fail-above` limit. `codegraph impact --format markdown` prints the same text.
- **A proper website around the app.** A new homepage with an animated pipeline (get the code, parse it, link it, label every edge, show the blast radius), a product preview, features, the accuracy results with their caveats, and the CLI commands. Analyzing now shows the same pipeline live, stage by stage, with real progress. Fonts are bundled (no third-party requests), the page works on phones, respects reduced-motion settings and passes an automated accessibility check.
- **The web app analyzes any repository, in the browser.** Paste a public GitHub repository (or `owner/repo@branch`, or
  a `github.com` link) or drop a project folder; the parser (WebAssembly) runs in a Web Worker and nothing is uploaded.
  Shareable `?repo=owner/repo` links, a "where to start" overview, search (`/`), a file tree, an inspector with the
  blast radius, callers, callees and source, and a layout that stays readable on large repositories (test functions and
  very large blast radii fold into one node per file; selecting a file shows its import neighbourhood).
- **Your own files in the web app**: drop or choose a folder, one or more source files, a mix of both, or a `.zip`
  (GitHub's "Download ZIP" works; its wrapper folder is removed). Everything is read in the page and never uploaded.
- `@codegraph/parser` and `@codegraph/extractors` have browser entry points; the in-memory indexing path no longer
  imports `node:path` or `node:fs`.

### Changed
- `codegraph serve` marks the page it serves, so the web app only probes for `/api/graph` when a graph is waiting.
- The npm package is larger: it now ships the web app's WebAssembly grammars (about 6 MB unpacked).

## 0.2.0

Accuracy fixes from an independent evaluation. Every call site in Hono, Immer and NestJS, repos CodeGraph was never
tuned on, was checked against the TypeScript compiler; see [`docs/ORACLE-EVAL.md`](docs/ORACLE-EVAL.md).

### Fixed
- **TypeScript files silently dropped from the graph.** tree-sitter-typescript misreads a line break between
  overloaded call signatures (`): Response` followed by `<T …>(…)`) as type arguments, and the error could swallow the
  rest of the file, so every class and function in it disappeared. This affected all of Hono's `src/context.ts`.
  CodeGraph now retries such files with explicit separators. On Hono, 1,979 more correct call edges are found.
- **Calls on JS built-ins linked to repo methods.** `JSON.parse`, `Promise.resolve`, `Object.assign`, `console.log`,
  and calls on values typed as `Map`, `Set`, `Response`, … are no longer name-matched to a repo method that happens to
  share the name. On NestJS, `probable` precision went from 81.5% to 93.2%.
- **Union type hints:** `A | B | Promise<X>` was read as `Promise`. It now gets a type only when every non-null
  member agrees.
- **Express-style prototype receivers:** `app.get()` was linked to an unrelated `res.get`, and `route.all()` to
  `User.all`.
- **Zod-style parallel implementations:** `v4` calls were linked to the `v3` implementation of the same name.
- `require('..')` now resolves to the root `index.js`, and `module.exports = require('./x')` forwarding is followed.
- When duplicate edges are merged, the surviving edge reports the call site that earned its confidence.

- **Declared return types:** `const res = await app.request('/')` / `resp = client.get(url)` now types the variable
  from the callee's declared return type (`Promise<X>` unwrapped when awaited), but only when every definition of the
  variable is such a call. 2,829 wrong TypeScript edges instead of 3,270, and 874 instead of 922 in Python, with no
  correct edge lost.

### Added
- `codegraph serve` listens on `$PORT` when `--port` is not given (for Cloud Run and similar hosts).
- A Dockerfile for a read-only hosted demo; see [`docs/DEPLOY.md`](docs/DEPLOY.md).

### Accuracy (TypeScript, against the compiler, pooled over Hono, Immer and NestJS)
| Tier | first evaluation (before the parse and built-in fixes) | 0.2.0 |
|---|---|---|
| `resolved` | 98.1% | 98.2% |
| `probable` | 58.6% | 69.1% |
| `ambiguous` | 12.4% | 35.4% |

Python, against Jedi on Requests, HTTPX and Rich (first measured in this release): `resolved` 99.8%, `probable`
80.0%, `ambiguous` 16.4%.

## 0.1.0

First release.
