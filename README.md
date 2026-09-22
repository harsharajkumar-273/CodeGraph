# CodeGraph

**AST dependency, call-graph and blast-radius engine for real repositories** — TypeScript + Tree-sitter, with a React Flow UI.

Point it at a local repo or a GitHub URL and it builds a multi-granular graph (folders → file imports → function calls → local variable dataflow). Then it answers:

- **Blast radius** — *"If I change this function (or this diff), what else can break, how confident are we, and which tests should I run?"*
- **Slice** — *"Show me only the code relevant to this function"*: its callers and callees, with exact line ranges.
- **Variable lineage** (new, stage 1) — *"Where did this variable's value come from, and what does it feed?"*, traced within its own function.

```
$ codegraph impact --diff --repo ~/code/flask
Changed  src/flask/app.py#Flask.dispatch_request, src/flask/app.py#Flask.url_for
Impact   3 symbols in 6 files  (3 resolved · 0 probable · 0 ambiguous)
  d1  resolved  src/flask/app.py#Flask.full_dispatch_request
  d2  resolved  src/flask/app.py#Flask.wsgi_app
  d3  resolved  src/flask/app.py#Flask.__call__
```

Every edge is labelled **resolved / probable / ambiguous**, so you can see *how much* of a blast radius is proven vs. guessed, and filter accordingly.

## Quick start

```bash
npm install

# index a local repo, a GitHub repo (owner/repo or URL), or this one
npm run cg -- index .
npm run cg -- index pallets/flask

# what breaks if I change this?
npm run cg -- impact "Resolver.resolveModule" --repo .
npm run cg -- impact src/app.ts#main --min-confidence probable
npm run cg -- impact --diff --range main...HEAD --repo .     # blast radius of a git diff / PR

# only the code that matters for a function
npm run cg -- slice UserService.run --callers 2 --callees 2 --print

# where did this variable's value come from, and where does it go?
npm run cg -- vars pipeline               # lists pipeline's local variables
npm run cg -- vars pipeline.count         # traces one of them

# import cycles
npm run cg -- cycles .

# interactive UI
npm run build:web && npm run cg -- serve .        # http://localhost:4173
# or, with hot reload:  npm run cg -- serve .   +   npm run dev:web
```

Targets accepted by `impact` / `slice`: `src/a.ts`, `src/a.ts#Foo.bar`, `src/a.ts:42`, or a bare `Foo.bar`.

## What it understands

| | TypeScript / JavaScript | Python |
|---|---|---|
| Imports | ESM, `require()`, dynamic `import()`, barrels (`export *`), `tsconfig` paths, workspace packages | absolute/relative imports, `__init__.py` re-exports, `from pkg import submodule` |
| Symbols | functions, arrows, classes, methods, `Foo.prototype.x =`, `module.exports` | functions, classes, methods, nested functions |
| Calls | plain, member, `this`, `new`, JSX components, callbacks passed by name | plain, member, `self`/`super()`, decorators, callbacks |
| Type-aware | annotations, `new Foo()`, constructor parameter properties | annotations, `x = Foo()`, `self.x = Foo()` |
| Variables | `const`/`let`/`var`, params, `for`/`for-of`, `catch`, `+=` | assignment, params, `for`, `+=` |

Variable lineage is **intra-procedural** (stage 1): it tracks a variable's value only within its own function, not across closures or object fields (`this.x`, `self.x`) — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#6-variable-lineage--stage-1-intra-procedural) for exactly what is and isn't tracked yet.

## Layout

```
packages/core        graph types + CodeGraph
packages/parser      web-tree-sitter loader (WASM grammars)
packages/extractors  per-file fact extraction (incl. variable def/use) + cross-file resolver + indexer
packages/analysis    blast radius, slice, variable lineage, diff→symbols, import cycles  (pure TS: Node or browser)
packages/cli         codegraph index | impact | slice | vars | cycles | serve
packages/web         React Flow UI with folder → file → function zoom, plus a variable dataflow view
fixtures/            tiny TS/JS and Python repos with hand-verified expected edges
docs/ARCHITECTURE.md design, schema, resolution algorithm, decisions, roadmap
```

## Honest limitations

Tree-sitter parses syntax; it is not a type checker. Dynamic dispatch (`getattr`, `obj[name]()`, DI containers, monkey-patching, `current_app`-style proxies) is invisible, and return-type inference is not attempted — that is exactly why edges carry confidence. Variable lineage doesn't yet cross closures, doesn't track object fields, and orders reads/writes lexically rather than with a real control-flow graph (a stage-2 item). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development

```bash
npm test             # vitest: fixtures pin expected call/import/flows edges
npm run typecheck
```

Indexing speed on a laptop-class machine: Flask (83 files, ~1.6k symbols, ~3k variable nodes) in well under a second, Express (141 files) similarly fast.
