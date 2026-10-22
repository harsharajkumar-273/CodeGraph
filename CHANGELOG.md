# Changelog

All notable changes to [`codegraph-engine`](https://www.npmjs.com/package/codegraph-engine).

## Unreleased

### Added
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
