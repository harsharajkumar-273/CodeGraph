# Changelog

All notable changes to [`codegraph-engine`](https://www.npmjs.com/package/codegraph-engine).

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

### Added
- `codegraph serve` listens on `$PORT` when `--port` is not given (for Cloud Run and similar hosts).
- A Dockerfile for a read-only hosted demo; see [`docs/DEPLOY.md`](docs/DEPLOY.md).

### Accuracy (TypeScript, against the compiler, pooled over Hono, Immer and NestJS)
| Tier | first evaluation (before the parse and built-in fixes) | 0.2.0 |
|---|---|---|
| `resolved` | 98.1% | 98.1% |
| `probable` | 58.6% | 69.1% |
| `ambiguous` | 12.4% | 32.1% |

## 0.1.0

First release.
