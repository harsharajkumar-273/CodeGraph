# Precision check

A hand-verified precision check of 99 call edges (33 per repo, stratified: 11 resolved
+ 11 probable + 11 ambiguous), sampled with a fixed seed across three real, unrelated
codebases chosen to stress different code styles:

- **Flask** (Python, class-based OOP, ~1.6k symbols)
- **Express** (JavaScript, prototype-based, heavy callback-by-reference style)
- **Zod** (TypeScript, ~522 files, unusual in that it ships four largely-parallel
  implementations of the same API — `v3`, `v4/core`, `v4/classic`, `v4/mini` — side
  by side in one repo)

Each sampled edge was read by hand against the actual source (both the call site and
the target definition) and judged correct or wrong. Reproduce with:

```bash
npm run cg -- index pallets/flask
node scripts/sample-precision-edges.mjs ~/.cache/codegraph/repos/pallets__flask/.codegraph/graph.json ~/.cache/codegraph/repos/pallets__flask flask-sample.md 42 11
```

## Results

| | resolved | probable | ambiguous |
|---|---|---|---|
| Flask | 11/11 | 11/11 | 4/11 |
| Express | 10/11 | 11/11 | 10/11 |
| Zod | 11/11 | 10/11 | 1/11 |
| **Total** | **32/33 (97%)** | **32/33 (97%)** | **15/33 (45%)** |

## What this means

`resolved` and `probable` held up well — 97% each — across three codebases in two
languages with very different styles (Python OOP, JS prototypes, heavily-typed
multi-version TS). That's the number that matters most, since those are the two tiers
`impact`/`slice` show by default (`--min-confidence probable`).

`ambiguous` is not a stable number — it swung from 9% (Zod) to 91% (Express) depending
on the codebase. Treat it as "unverified, use at your own risk" rather than "45%
correct on average": that average is not representative of any single repo.

## Two new small bugs found

- **Express, `resolved` tier**: `var app = this.app; app.get('json escape')` in
  `lib/response.js#res.json` resolved to `lib/response.js#res.get` instead of
  `lib/application.js#app.get` — a same-name collision between two different
  prototypes' `.get()` methods. Concerning because it's in the tier meant to be
  near-certain. Root cause not yet diagnosed (it bypassed the usual `COMMON`-set
  downgrade, which is itself worth understanding).
- **Express, `ambiguous` tier**: `route.all(...)` (a Router `Route`'s method)
  resolved to an unrelated example file's `User.all`.

## One systemic bug found: cross-version collisions in multi-implementation repos

Zod's `ambiguous` tier was 1/11 (9%) — far worse than Flask's or Express's — and the
dominant cause is specific to codebases like Zod that ship several parallel
implementations of the same API. `v3/types.ts`, `v4/classic/schemas.ts`, and
`v4/mini/schemas.ts` each define their own `parse`, `safeParse`, `trim`, `startsWith`,
`length`, `nullable`, etc. When a `v4/classic` or `v4/mini` test called one of these,
the bare-name fallback repeatedly resolved to the **`v3` implementation** instead of
the version actually imported — 8 of the 10 wrong `ambiguous` edges in the Zod sample
were exactly this. The fallback's "near files" heuristic doesn't currently prefer the
module version actually reachable from the call site's own imports.

The same sample also caught two unrelated collisions between Zod's own method names
and native JS/Web APIs: `line.trim().startsWith(...)` on a plain string matched
`ZodString.trim`/`.startsWith`, and `URLStatic.parse(...)` (the native `URL.parse`)
matched `ZodType.parse`.

This doesn't affect `resolved` (11/11) or `probable` (10/11, one unrelated miss) in
this sample, but it means: on a codebase that maintains multiple parallel
implementations of the same interface, `ambiguous` edges are close to a coin flip, and
worse than that when native built-ins share a name with the library's own API.
