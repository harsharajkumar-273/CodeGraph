import * as p from './posix';
import { CodeGraph, externalId, fileId, symbolId, variableId, type Confidence, type GraphNode } from '@codegraph/core';
import { GoResolver } from './resolve-go';
import type { CallFact, CallTypeHint, ExportFact, FileFacts, ImportBinding, ImportFact, SymbolFact, VarFact } from './types';

interface Entry {
  facts: FileFacts;
  symbols: Map<string, SymbolFact>;
  exportsByName: Map<string, ExportFact>;
  bindings: Map<string, { imp: ImportFact; b: ImportBinding }>;
  /** Imports inside a function body, keyed `scope|local`; they shadow the file-level ones for code in that function. */
  scopedBindings: Map<string, { imp: ImportFact; b: ImportBinding }>;
  methods: Map<string, Map<string, SymbolFact>>; // class qname -> method name -> symbol
  types: Map<string, string>; // `${scope}|${name}` -> class name
  /** Variables typed by a call's declared return type (see inferCallTypes), already resolved to a class. */
  callTypes: Map<string, { file: string; sym: SymbolFact } | 'builtin'>;
}

type Target =
  | { type: 'symbol'; file: string; sym: SymbolFact }
  | { type: 'module'; file: string }
  | { type: 'external'; pkg: string }
  | null;

type ModuleRef = { file: string } | { external: string } | null;

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts'];

/** Method names so common that a name-only match is nearly meaningless. */
const COMMON = new Set([
  'get', 'set', 'has', 'add', 'delete', 'push', 'pop', 'map', 'filter', 'forEach', 'reduce', 'join', 'split', 'slice',
  'keys', 'values', 'entries', 'toString', 'then', 'catch', 'log', 'error', 'warn', 'info', 'debug', 'append', 'extend',
  'update', 'items', 'format', 'strip', 'replace', 'find', 'includes', 'indexOf', 'copy', 'clear', 'close', 'open',
  'read', 'write', 'send', 'emit', 'on', 'off', 'call', 'apply', 'bind', 'next', 'run', 'start', 'stop', 'init', 'test',
  // dict/mapping and generic-dispatch methods, plus Python dunders implemented by nearly every class —
  // a bare-name match on these is essentially never evidence of a real call target.
  'setdefault', 'invoke', '__init__', '__repr__', '__str__', '__eq__', '__enter__', '__exit__', '__call__', '__len__',
  '__iter__', '__new__',
]);

/**
 * JS globals whose methods are never repo code (`JSON.parse`, `Promise.resolve`, `Object.assign`, `console.log`): a
 * member call on one is not a name-match candidate unless the file declares or imports that name itself.
 * (`window`/`globalThis`/`document` are left out: apps do hang their own objects off them.)
 */
const JS_GLOBALS = new Set([
  'JSON', 'Promise', 'Object', 'Math', 'Number', 'Reflect', 'Array', 'String', 'Date', 'Symbol', 'console', 'Intl',
  'BigInt', 'Boolean', 'RegExp', 'Atomics', 'URL', 'Buffer', 'process',
]);

/** Built-in JS / Web types: a receiver typed as one (and not as a repo class of that name) has no repo method. */
const JS_BUILTIN_TYPES = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Array', 'ReadonlyArray', 'String', 'Number', 'Date', 'RegExp',
  'Error', 'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'ReadableStream',
  'WritableStream', 'TransformStream', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'ArrayBuffer',
  'Uint8Array', 'DataView', 'WebSocket', 'Buffer',
]);

/** Python built-in types: a value returned as one has no repo method. */
const PY_BUILTIN_TYPES = new Set(['str', 'bytes', 'bytearray', 'int', 'float', 'bool', 'list', 'dict', 'set', 'frozenset', 'tuple']);

export function parseJsonc(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    let out = '';
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        out += c;
        if (c === '\\') out += text[++i] ?? '';
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
        out += c;
      } else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        out += '\n';
      } else if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i++;
      } else out += c;
    }
    try {
      return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

interface WorkspacePkg {
  name: string;
  dir: string;
  json: any;
}
interface TsConfig {
  dir: string;
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

export interface BuildStats {
  files: number;
  symbols: number;
  importEdges: number;
  callEdges: number;
  resolvedCalls: number;
  probableCalls: number;
  ambiguousCalls: number;
  unresolvedCalls: number;
  variableNodes: number;
  flowEdges: number;
}

/** Per-call-site resolution result, for evaluation and debugging (the graph dedups edges per caller/callee pair). */
export interface CallTrace {
  file: string;
  call: CallFact;
  targets: { file: string; qname: string; confidence: Confidence }[];
}

export function buildGraph(
  factsList: FileFacts[],
  configs: Map<string, string> = new Map(),
  root = '.',
  trace?: (t: CallTrace) => void,
): { graph: CodeGraph; stats: BuildStats } {
  const go = factsList.filter((f) => f.family === 'go');
  const res = new Resolver(go.length ? factsList.filter((f) => f.family !== 'go') : factsList, configs, root, trace).build();
  if (go.length) {
    new GoResolver(res.graph, go, configs, res.stats, trace).build();
    res.stats.files += go.length;
    res.stats.symbols += go.reduce((n, f) => n + f.symbols.length, 0);
    res.stats.importEdges = res.graph.edges('imports').length;
    res.stats.callEdges = res.graph.edges('calls').length;
  }
  return res;
}

class Resolver {
  private entries = new Map<string, Entry>();
  private paths = new Set<string>();
  private methodsByName = new Map<string, { file: string; sym: SymbolFact }[]>();
  private moduleCache = new Map<string, ModuleRef>();
  /** Lowercased names of prototype/object-style owners (`app`, `res`, `Route`): methods exist only where explicitly assigned. */
  private protoOwners = new Set<string>();
  private workspace: WorkspacePkg[] = [];
  private tsconfigs = new Map<string, TsConfig>();
  private graph: CodeGraph;
  private stats: BuildStats = {
    files: 0, symbols: 0, importEdges: 0, callEdges: 0,
    resolvedCalls: 0, probableCalls: 0, ambiguousCalls: 0, unresolvedCalls: 0,
    variableNodes: 0, flowEdges: 0,
  };

  constructor(private factsList: FileFacts[], configs: Map<string, string>, root: string, private trace?: (t: CallTrace) => void) {
    this.graph = new CodeGraph(root);
    for (const f of factsList) {
      this.paths.add(f.path);
      const symbols = new Map(f.symbols.map((s) => [s.qname, s]));
      const methods = new Map<string, Map<string, SymbolFact>>();
      for (const s of f.symbols) {
        if (s.kind === 'method' && s.className) {
          const m = methods.get(s.className) ?? new Map();
          m.set(s.name, s);
          methods.set(s.className, m);
          if (!s.local && symbols.get(s.className)?.kind !== 'class') this.protoOwners.add(s.className.split('.').pop()!.toLowerCase());
          const list = this.methodsByName.get(s.name) ?? [];
          list.push({ file: f.path, sym: s });
          this.methodsByName.set(s.name, list);
        }
      }
      const bindings = new Map<string, { imp: ImportFact; b: ImportBinding }>();
      const scopedBindings = new Map<string, { imp: ImportFact; b: ImportBinding }>();
      for (const imp of f.imports) for (const b of imp.bindings) (imp.scope ? scopedBindings : bindings).set(imp.scope ? `${imp.scope}|${b.local}` : b.local, { imp, b });
      this.entries.set(f.path, {
        facts: f,
        symbols,
        exportsByName: new Map(f.exports.map((e) => [e.name, e])),
        bindings,
        scopedBindings,
        methods,
        types: new Map(f.types.map((t) => [`${t.scope ?? ''}|${t.name}`, t.type])),
        callTypes: new Map(),
      });
    }
    for (const [path, text] of configs) {
      const json = parseJsonc(text);
      if (!json) continue;
      const base = p.basename(path);
      const dir = p.dirname(path) === '.' ? '' : p.dirname(path);
      if (base === 'package.json' && typeof json.name === 'string') this.workspace.push({ name: json.name, dir, json });
      if (base === 'tsconfig.json' || base === 'jsconfig.json') {
        const co = json.compilerOptions ?? {};
        if (co.baseUrl || co.paths) this.tsconfigs.set(dir, { dir, baseUrl: co.baseUrl, paths: co.paths });
      }
    }
    this.workspace.sort((a, b) => b.name.length - a.name.length);
  }

  // ---------------------------------------------------------------- module resolution

  private has(path: string) {
    return this.paths.has(path);
  }

  private tryFile(base: string): string | null {
    base = p.normalize(base).replace(/^\.\//, '');
    if (this.has(base)) return base;
    const m = /\.(?:m|c)?jsx?$/.exec(base);
    if (m) {
      const stem = base.slice(0, -m[0].length);
      for (const e of TS_EXTS) if (this.has(stem + e)) return stem + e;
    }
    for (const e of JS_EXTS) if (this.has(base + e)) return base + e;
    // `join` (not a template) so a directory that normalized to '' or '.' — `require('..')`, `import '.'` —
    // still finds the root `index.js` instead of probing '/index.js' / './index.js'.
    for (const e of JS_EXTS) {
      const idx = p.join(base, `index${e}`);
      if (this.has(idx)) return idx;
    }
    return null;
  }

  private resolveModule(from: string, spec: string, level = 0): ModuleRef {
    const key = `${from}|${level}|${spec}`;
    if (this.moduleCache.has(key)) return this.moduleCache.get(key)!;
    const family = this.entries.get(from)?.facts.family;
    const r = family === 'python' ? this.resolvePy(from, spec, level) : this.resolveJs(from, spec);
    this.moduleCache.set(key, r);
    return r;
  }

  private resolveJs(from: string, spec: string): ModuleRef {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? spec.slice(1) : p.join(p.dirname(from), spec);
      const f = this.tryFile(base);
      return f ? { file: f } : null; // assets, json, css... ignored
    }
    if (spec.startsWith('node:')) return { external: spec };
    // tsconfig paths / baseUrl (nearest tsconfig that defines them)
    let dir = p.dirname(from);
    for (;;) {
      const d = dir === '.' ? '' : dir;
      const tc = this.tsconfigs.get(d);
      if (tc) {
        const baseDir = p.join(tc.dir, tc.baseUrl ?? '.');
        for (const [pattern, targets] of Object.entries(tc.paths ?? {})) {
          const star = pattern.indexOf('*');
          let rest: string | null = null;
          if (star < 0) rest = pattern === spec ? '' : null;
          else if (spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1)))
            rest = spec.slice(star, spec.length - (pattern.length - star - 1));
          if (rest === null) continue;
          for (const t of targets) {
            const f = this.tryFile(p.join(baseDir, star < 0 ? t : t.replace('*', rest)));
            if (f) return { file: f };
          }
        }
        if (tc.baseUrl) {
          const f = this.tryFile(p.join(baseDir, spec));
          if (f) return { file: f };
        }
      }
      if (d === '') break;
      dir = p.dirname(dir);
    }
    // workspace packages (monorepos)
    for (const pkg of this.workspace) {
      if (spec === pkg.name) {
        const f = this.pkgEntry(pkg);
        if (f) return { file: f };
      } else if (spec.startsWith(pkg.name + '/')) {
        const sub = spec.slice(pkg.name.length + 1);
        // The package's own `exports` map is authoritative for a subpath (`zod/v4`, `zod/mini`);
        // directory guesses are only the fallback for packages that don't declare one.
        const f = this.pkgSubpath(pkg, sub) ?? this.tryFile(p.join(pkg.dir, sub)) ?? this.tryFile(p.join(pkg.dir, 'src', sub));
        if (f) return { file: f };
      }
    }
    const parts = spec.split('/');
    return { external: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] };
  }

  /** Resolves `<pkg>/<sub>` through `exports["./<sub>"]` (or a `./prefix/*` pattern) to a source file. */
  private pkgSubpath(pkg: WorkspacePkg, sub: string): string | null {
    const ex = pkg.json.exports;
    if (!ex || typeof ex !== 'object') return null;
    const key = './' + sub;
    let target: any = ex[key];
    if (target === undefined) {
      for (const [pat, t] of Object.entries<any>(ex)) {
        const star = pat.indexOf('*');
        if (star < 0 || !key.startsWith(pat.slice(0, star)) || !key.endsWith(pat.slice(star + 1))) continue;
        const rest = key.slice(star, key.length - (pat.length - star - 1));
        target = JSON.parse(JSON.stringify(t, (_k, v) => (typeof v === 'string' ? v.replace('*', rest) : v)));
        break;
      }
    }
    if (target === undefined) return null;
    return this.firstSource(pkg, target);
  }

  private firstSource(pkg: WorkspacePkg, target: any): string | null {
    const cands: string[] = [];
    const flat = (v: any) => {
      if (typeof v === 'string') cands.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(flat);
    };
    flat(target);
    for (const c of cands) {
      const direct = this.tryFile(p.join(pkg.dir, c));
      if (direct) return direct;
      const srcAlt = c.replace(/^\.?\/?(dist|lib|build|out)\//, 'src/');
      if (srcAlt !== c) {
        const f = this.tryFile(p.join(pkg.dir, srcAlt));
        if (f) return f;
      }
    }
    return null;
  }

  private pkgEntry(pkg: WorkspacePkg): string | null {
    const j = pkg.json;
    const cands: string[] = [];
    const flat = (v: any) => {
      if (typeof v === 'string') cands.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(flat);
    };
    if (j.exports) flat(typeof j.exports === 'string' || !j.exports['.'] ? j.exports : j.exports['.']);
    for (const k of ['source', 'module', 'main', 'types']) if (typeof j[k] === 'string') cands.push(j[k]);
    for (const c of cands) {
      const direct = this.tryFile(p.join(pkg.dir, c));
      if (direct) return direct;
      const srcAlt = c.replace(/^\.?\/?(dist|lib|build|out)\//, 'src/');
      if (srcAlt !== c) {
        const f = this.tryFile(p.join(pkg.dir, srcAlt));
        if (f) return f;
      }
    }
    return this.tryFile(p.join(pkg.dir, 'src/index')) ?? this.tryFile(p.join(pkg.dir, 'index'));
  }

  private pyFile(base: string): string | null {
    base = p.normalize(base).replace(/^\.\//, '');
    if (base === '.' || base === '') return this.has('__init__.py') ? '__init__.py' : null;
    if (this.has(`${base}.py`)) return `${base}.py`;
    if (this.has(`${base}/__init__.py`)) return `${base}/__init__.py`;
    return null;
  }

  /**
   * The directory that would be on `sys.path` for `from` — i.e. the parent of the
   * top-most package directory containing it, found by walking up only while each
   * directory is itself a package (has `__init__.py`).
   *
   * This is the ONE legitimate implicit search root for an absolute import; it is
   * NOT every ancestor directory. Adding every ancestor (the old behavior) let a
   * nested package shadow a same-named top-level/stdlib module — e.g. inside
   * `flask/json/provider.py`, `import json` must resolve to the stdlib, not to the
   * sibling `flask/json` package, but treating `flask/` (an ancestor two levels up)
   * as a search root made `json` match `flask/json/__init__.py`. Walking up only
   * through `__init__.py`-having directories and stopping at the first one without
   * one — the real package boundary — avoids that.
   */
  private packageRoot(from: string): string {
    let dir = p.dirname(from);
    while (dir !== '.' && dir !== '/' && this.has(p.join(dir, '__init__.py'))) {
      const parent = p.dirname(dir);
      if (parent === dir) return dir;
      dir = parent;
    }
    return dir === '.' ? '' : dir;
  }

  private resolvePy(from: string, spec: string, level: number): ModuleRef {
    const parts = spec ? spec.split('.') : [];
    if (level > 0) {
      let base = p.dirname(from);
      for (let i = 1; i < level; i++) base = p.dirname(base);
      const f = this.pyFile(p.join(base, ...parts));
      return f ? { file: f } : null;
    }
    const roots = new Set<string>([this.packageRoot(from), '', 'src', 'lib', 'app']);
    for (const r of roots) {
      const f = this.pyFile(p.join(r, ...parts));
      if (f) return { file: f };
    }
    return { external: parts[0] ?? spec };
  }

  // ---------------------------------------------------------------- exports & bindings

  private lookupExport(file: string, name: string, seen = new Set<string>()): { file: string; sym: SymbolFact } | null {
    const key = `${file}|${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const entry = this.entries.get(file);
    if (!entry) return null;
    const exp = entry.exportsByName.get(name);
    if (exp) {
      if (exp.local) {
        const sym = entry.symbols.get(exp.local);
        if (sym) return { file, sym };
        const b = entry.bindings.get(exp.local);
        if (b) {
          const t = this.resolveBinding(file, b.imp, b.b, seen);
          if (t?.type === 'symbol') return { file: t.file, sym: t.sym };
        }
        return null;
      }
      if (exp.from) {
        const m = this.resolveModule(file, exp.from);
        if (m && 'file' in m && exp.fromName !== '*') return this.lookupExport(m.file, exp.fromName ?? name, seen);
        return null;
      }
    }
    if (entry.facts.family === 'python') {
      const b = entry.bindings.get(name);
      if (b) {
        const t = this.resolveBinding(file, b.imp, b.b, seen);
        if (t?.type === 'symbol') return { file: t.file, sym: t.sym };
      }
    }
    if (name !== 'default') {
      for (const imp of entry.facts.imports) {
        if (!imp.star) continue;
        const m = this.resolveModule(file, imp.specifier, imp.level ?? 0);
        if (m && 'file' in m) {
          const r = this.lookupExport(m.file, name, seen);
          if (r) return r;
        }
      }
    }
    return null;
  }

  private resolveBinding(from: string, imp: ImportFact, b: ImportBinding, seen = new Set<string>()): Target {
    const m = this.resolveModule(from, imp.specifier, imp.level ?? 0);
    const fam = this.entries.get(from)?.facts.family;
    if (!m) {
      return null;
    }
    if ('external' in m) return { type: 'external', pkg: m.external };
    if (b.imported === '*') return { type: 'module', file: m.file };
    const r = this.lookupExport(m.file, b.imported, seen);
    if (r) return { type: 'symbol', file: r.file, sym: r.sym };
    if (fam === 'python') {
      // `from pkg import submodule`
      const sub = this.resolveModule(from, imp.specifier ? `${imp.specifier}.${b.imported}` : b.imported, imp.level ?? 0);
      if (sub && 'file' in sub) return { type: 'module', file: sub.file };
    }
    return { type: 'module', file: m.file }; // exported non-function value; keep the module for "near file" heuristics
  }

  // ---------------------------------------------------------------- scope helpers

  private scopeLookup(entry: Entry, caller: string | null, name: string): SymbolFact | undefined {
    const parts = caller ? caller.split('.') : [];
    for (let i = parts.length; i >= 0; i--) {
      const q = [...parts.slice(0, i), name].join('.');
      const s = entry.symbols.get(q);
      if (s && s.kind !== 'method') return s;
    }
    return undefined;
  }

  /** Nearest enclosing class of a caller qname (for this/self resolution). */
  private enclosingClass(entry: Entry, caller: string | null): string | undefined {
    if (!caller) return undefined;
    const parts = caller.split('.');
    for (let i = parts.length; i > 0; i--) {
      const s = entry.symbols.get(parts.slice(0, i).join('.'));
      if (s?.kind === 'class') return s.qname;
      if (s?.className) return s.className;
    }
    return undefined;
  }

  /** Resolves a written class name (`Base`, `ns.Base`) to a class symbol visible from `entry`. */
  private resolveClassName(entry: Entry, name: string, caller: string | null): { file: string; sym: SymbolFact } | null {
    const dot = name.indexOf('.');
    if (dot < 0) {
      const s = this.scopeLookup(entry, caller, name);
      if (s?.kind === 'class') return { file: entry.facts.path, sym: s };
      const b = this.bindingOf(entry, caller, name);
      if (b) {
        const t = this.resolveBinding(entry.facts.path, b.imp, b.b);
        if (t?.type === 'symbol' && t.sym.kind === 'class') return { file: t.file, sym: t.sym };
      }
      return null;
    }
    const head = name.slice(0, dot);
    const rest = name.slice(dot + 1);
    const b = this.bindingOf(entry, caller, head) ?? this.bindingOf(entry, caller, name.slice(0, name.lastIndexOf('.')));
    if (b) {
      const t = this.resolveBinding(entry.facts.path, b.imp, b.b);
      if (t?.type === 'module') {
        const r = this.lookupExport(t.file, rest.split('.').pop()!);
        if (r?.sym.kind === 'class') return r;
      }
    }
    return null;
  }

  private findMethod(file: string, cls: string, name: string, depth = 0, seen = new Set<string>()): { file: string; sym: SymbolFact } | null {
    const key = `${file}#${cls}`;
    if (depth > 6 || seen.has(key)) return null;
    seen.add(key);
    const entry = this.entries.get(file);
    if (!entry) return null;
    const own = entry.methods.get(cls)?.get(name);
    if (own) return { file, sym: own };
    const clsSym = entry.symbols.get(cls);
    for (const base of clsSym?.bases ?? []) {
      const b = this.resolveClassName(entry, base, null);
      if (b) {
        const r = this.findMethod(b.file, b.sym.qname, name, depth + 1, seen);
        if (r) return r;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- graph construction

  build(): { graph: CodeGraph; stats: BuildStats } {
    const g = this.graph;
    for (const f of this.factsList) this.addNodes(f);
    for (const f of this.factsList) this.addImports(f);
    for (const f of this.factsList) this.addExtends(f);
    this.inferCallTypes();
    for (const f of this.factsList) this.addCalls(f);
    for (const f of this.factsList) this.addVariables(f);
    this.stats.files = this.factsList.length;
    this.stats.symbols = this.factsList.reduce((n, f) => n + f.symbols.length, 0);
    this.stats.importEdges = g.edges('imports').length;
    this.stats.callEdges = g.edges('calls').length;
    this.stats.variableNodes = g.nodes('variable').length;
    this.stats.flowEdges = g.edges('flows').length;
    return { graph: g, stats: this.stats };
  }

  /**
   * Stage 1 (intra-procedural) variable lineage: one node per (scope, name), a `defines` edge
   * from the enclosing function/file, and `flows` edges from every OTHER same-scope variable
   * that appears on this variable's right-hand side across all its (re)definitions. Free
   * variables, outer-scope closures and object fields (`this.x`) are not tracked yet.
   */
  private addVariables(f: FileFacts) {
    const g = this.graph;
    const fid = fileId(f.path);
    interface Merged { scope: string | null; name: string; first: number; last: number; reads: Set<string> }
    const byKey = new Map<string, Merged>();
    const key = (v: Pick<VarFact, 'scope' | 'name'>) => `${v.scope ?? ''}|${v.name}`;
    for (const v of f.vars) {
      const k = key(v);
      const cur = byKey.get(k);
      if (cur) {
        cur.first = Math.min(cur.first, v.line);
        cur.last = Math.max(cur.last, v.line);
        for (const r of v.reads) cur.reads.add(r);
      } else {
        byKey.set(k, { scope: v.scope, name: v.name, first: v.line, last: v.line, reads: new Set(v.reads) });
      }
    }
    for (const e of byKey.values()) {
      const parent = e.scope ? symbolId(f.path, e.scope) : fid;
      if (e.scope && !g.hasNode(parent)) continue; // enclosing scope wasn't recorded as a symbol; skip defensively
      const id = variableId(f.path, e.scope, e.name);
      g.addNode({
        id, kind: 'variable', name: e.name,
        qualifiedName: e.scope ? `${e.scope}.${e.name}` : e.name,
        file: f.path, lang: f.lang, startLine: e.first, endLine: e.last, parent,
      });
      g.addEdge({ from: parent, to: id, kind: 'defines', confidence: 'resolved', line: e.first });
    }
    for (const e of byKey.values()) {
      const id = variableId(f.path, e.scope, e.name);
      for (const r of e.reads) {
        if (!byKey.has(key({ scope: e.scope, name: r }))) continue; // not a local var in this scope: free var / import / call / global
        g.addEdge({ from: variableId(f.path, e.scope, r), to: id, kind: 'flows', confidence: 'resolved' });
      }
    }
  }

  private addNodes(f: FileFacts) {
    const g = this.graph;
    const fid = fileId(f.path);
    g.addNode({ id: fid, kind: 'file', name: p.basename(f.path), qualifiedName: f.path, file: f.path, lang: f.lang, startLine: 1, endLine: f.lineCount });
    const exportedLocals = new Set(f.exports.map((e) => e.local).filter(Boolean) as string[]);
    for (const s of f.symbols) {
      const parts = s.qname.split('.');
      let parent = fid;
      for (let i = parts.length - 1; i > 0; i--) {
        const anc = parts.slice(0, i).join('.');
        if (f.symbols.some((x) => x.qname === anc)) {
          parent = symbolId(f.path, anc);
          break;
        }
      }
      const node: GraphNode = {
        id: symbolId(f.path, s.qname),
        kind: s.kind,
        name: s.name,
        qualifiedName: s.qname,
        file: f.path,
        lang: f.lang,
        startLine: s.startLine,
        endLine: s.endLine,
        exported: exportedLocals.has(s.qname),
        parent,
        ...(s.arity ? { arity: s.arity } : {}),
        ...(s.params ? { params: s.params } : {}),
        ...(s.returnText ?? s.returns ? { returns: s.returnText ?? s.returns } : {}),
      };
      g.addNode(node);
      g.addEdge({ from: parent, to: node.id, kind: 'defines', confidence: 'resolved', line: s.startLine });
    }
  }

  private addImports(f: FileFacts) {
    const g = this.graph;
    const from = fileId(f.path);
    for (const imp of f.imports) {
      const m = this.resolveModule(f.path, imp.specifier, imp.level ?? 0);
      if (!m) continue;
      const typeOnly = imp.typeOnly ? { typeOnly: true as const } : {};
      if ('file' in m) {
        g.addEdge({ from, to: fileId(m.file), kind: 'imports', confidence: 'resolved', line: imp.line, ...typeOnly });
      } else {
        const id = externalId(m.external);
        g.addNode({ id, kind: 'external', name: m.external });
        g.addEdge({ from, to: id, kind: 'imports', confidence: 'resolved', line: imp.line, ...typeOnly });
      }
    }
  }

  private addExtends(f: FileFacts) {
    const entry = this.entries.get(f.path)!;
    for (const s of f.symbols) {
      if (s.kind !== 'class') continue;
      for (const base of s.bases ?? []) {
        const b = this.resolveClassName(entry, base, s.qname.includes('.') ? s.qname.split('.').slice(0, -1).join('.') : null);
        if (b) this.graph.addEdge({ from: symbolId(f.path, s.qname), to: symbolId(b.file, b.sym.qname), kind: 'extends', confidence: 'resolved' });
      }
    }
  }

  private addCalls(f: FileFacts) {
    const entry = this.entries.get(f.path)!;
    for (const call of f.calls) {
      const from = call.caller ? symbolId(f.path, call.caller) : fileId(f.path);
      if (call.caller && !this.graph.hasNode(from)) continue;
      const targets = this.resolveCall(entry, call);
      this.trace?.({ file: f.path, call, targets: targets.map((t) => ({ file: t.file, qname: t.sym.qname, confidence: t.confidence })) });
      if (targets.length === 0) {
        this.stats.unresolvedCalls++;
        continue;
      }
      for (const t of targets) {
        this.graph.addEdge({ from, to: symbolId(t.file, t.sym.qname), kind: 'calls', confidence: t.confidence, line: call.line });
        if (t.confidence === 'resolved') this.stats.resolvedCalls++;
        else if (t.confidence === 'probable') this.stats.probableCalls++;
        else this.stats.ambiguousCalls++;
      }
    }
  }

  private nearCache = new Map<string, Set<string>>();

  /** This file, the files it imports, and (through barrel re-exports) the files behind those. */
  private nearFiles(entry: Entry): Set<string> {
    const cached = this.nearCache.get(entry.facts.path);
    if (cached) return cached;
    const near = new Set<string>([entry.facts.path]);
    const expand = (file: string, depth: number) => {
      if (near.has(file) && depth < 3) return;
      near.add(file);
      if (depth === 0) return;
      const e = this.entries.get(file);
      if (!e) return;
      const barrel = e.facts.family === 'python' && p.basename(file) === '__init__.py';
      for (const imp of e.facts.imports) {
        if (!(barrel || imp.star || e.facts.exports.some((x) => x.from === imp.specifier))) continue;
        const m = this.resolveModule(file, imp.specifier, imp.level ?? 0);
        if (m && 'file' in m) expand(m.file, depth - 1);
      }
    };
    for (const imp of entry.facts.imports) {
      const m = this.resolveModule(entry.facts.path, imp.specifier, imp.level ?? 0);
      if (m && 'file' in m) expand(m.file, 3);
    }
    this.nearCache.set(entry.facts.path, near);
    return near;
  }

  private typeOfReceiver(entry: Entry, caller: string | null, recv: string): string | undefined {
    if (recv.startsWith('this.') || recv.startsWith('self.') || recv.startsWith('cls.')) {
      const cls = this.enclosingClass(entry, caller);
      return cls ? entry.types.get(`class:${cls}|${recv}`) : undefined;
    }
    return this.scoped(entry.types, caller, recv);
  }

  /** The import that binds `name` where `caller` runs: a function-local import first, then the file's. */
  private bindingOf(entry: Entry, caller: string | null, name: string) {
    return (caller && entry.scopedBindings.size ? this.scoped(entry.scopedBindings, caller, name) : undefined) ?? entry.bindings.get(name);
  }

  /** `name` looked up from the caller's scope outwards (`a.b|x`, `a|x`, `|x`). */
  private scoped<V>(map: Map<string, V>, caller: string | null, name: string): V | undefined {
    const parts = caller ? caller.split('.') : [];
    for (let i = parts.length; i >= 0; i--) {
      const t = map.get(`${parts.slice(0, i).join('.')}|${name}`);
      if (t !== undefined) return t;
    }
    return undefined;
  }

  /**
   * `const res = await app.request('/')` / `resp = client.get(url)`: when the call resolves with certainty
   * ('resolved') to a function with a declared return type, the variable gets that type. The type name is resolved
   * in the CALLEE's file, where it is in scope, and stored as a class, or as 'builtin' for Response, Map, str, ...
   * (whose methods are never repo code).
   *
   * Types are not flow-sensitive, so a variable is typed only when EVERY definition of it in that scope is such a
   * call and they all agree: a parameter reassigned in one branch (`cookiejar = cookiejar_from_dict(...)`) keeps
   * its other meaning elsewhere, so it is left alone. Two rounds let one inferred variable type the next.
   */
  private inferCallTypes() {
    const same = (a: { file: string; sym: SymbolFact } | 'builtin', b: { file: string; sym: SymbolFact } | 'builtin') =>
      a === b || (a !== 'builtin' && b !== 'builtin' && a.file === b.file && a.sym.qname === b.sym.qname);
    for (let round = 0; round < 2; round++) {
      for (const entry of this.entries.values()) {
        const groups = new Map<string, CallTypeHint[]>();
        for (const h of entry.facts.callTypes ?? []) {
          const key = `${h.scope ?? ''}|${h.name}`;
          (groups.get(key) ?? groups.set(key, []).get(key)!).push(h);
        }
        for (const [key, hints] of groups) {
          if (entry.callTypes.has(key)) continue;
          const defs = entry.facts.vars.filter((v) => `${v.scope ?? ''}|${v.name}` === key).length;
          if (defs !== hints.length) continue;
          let type: { file: string; sym: SymbolFact } | 'builtin' | undefined;
          for (const h of hints) {
            const t = this.callReturnType(entry, h);
            if (!t || (type && !same(type, t))) {
              type = undefined;
              break;
            }
            type = t;
          }
          if (type) entry.callTypes.set(key, type);
        }
      }
    }
  }

  private callReturnType(entry: Entry, h: CallTypeHint): { file: string; sym: SymbolFact } | 'builtin' | undefined {
    const targets = this.resolveCall(entry, { caller: h.scope, ...h.call });
    if (targets.length !== 1 || targets[0].confidence !== 'resolved') return undefined;
    const { file, sym } = targets[0];
    const ret = h.awaited ? (sym.returnsAwaited ?? sym.returns) : sym.returns;
    if (!ret) return undefined;
    const cls = this.resolveClassName(this.entries.get(file)!, ret, sym.qname);
    if (cls) return cls;
    return (entry.facts.family === 'js' ? JS_BUILTIN_TYPES : PY_BUILTIN_TYPES).has(ret) ? 'builtin' : undefined;
  }


  /** Every internal file reachable from `file` through its imports (transitively, barrels included). */
  private closureCache = new Map<string, Set<string>>();
  private importClosure(file: string): Set<string> {
    const hit = this.closureCache.get(file);
    if (hit) return hit;
    const seen = new Set<string>();
    const stack = [file];
    while (stack.length) {
      const cur = stack.pop()!;
      const e = this.entries.get(cur);
      if (!e) continue;
      for (const imp of e.facts.imports) {
        const m = this.resolveModule(cur, imp.specifier, imp.level ?? 0);
        if (m && 'file' in m && !seen.has(m.file)) {
          seen.add(m.file);
          stack.push(m.file);
        }
      }
    }
    this.closureCache.set(file, seen);
    return seen;
  }

  /**
   * True when `cand` lives in a sibling subtree of `from`'s own tree (`v3/` vs `v4/`, `lib/` vs `examples/`)
   * that nothing `from` imports ever reaches. A bare-name guess into such a tree is how parallel
   * implementations of one API (Zod's v3 / v4 / mini) get cross-wired: the caller demonstrably works
   * against its own tree, and the name is shared only by coincidence.
   */
  private inUnreachedSiblingTree(from: string, cand: string): boolean {
    const dirs = (f: string) => (p.dirname(f) === '.' ? [] : p.dirname(f).split('/'));
    const a = dirs(from);
    const b = dirs(cand);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i >= a.length || i >= b.length) return false; // one directory contains the other: not sibling trees
    const closure = this.importClosure(from);
    // No resolved internal import means no evidence about which tree the caller works against (an unresolvable
    // `from flaskr import ...`, a script with only external imports): leave the guess alone rather than drop it.
    if (closure.size === 0) return false;
    const prefix = b.slice(0, i + 1).join('/') + '/';
    for (const f of closure) if (f.startsWith(prefix)) return false;
    return true;
  }

  /** Last identifier of a receiver (`this.app` -> `app`), lowercased; none for this/self/super. */
  private receiverHint(recv?: string): string | undefined {
    const last = recv?.split('.').pop()?.replace(/^_+/, '').toLowerCase();
    return last && !['this', 'self', 'cls', 'super'].includes(last) ? last : undefined;
  }

  private nameFallback(entry: Entry, name: string, only?: Set<string>, recv?: string): { file: string; sym: SymbolFact; confidence: Confidence }[] {
    const all = (this.methodsByName.get(name) ?? []).filter((c) => !c.sym.local || c.file === entry.facts.path);
    const near = only ?? this.nearFiles(entry);
    // Receiver/owner affinity: in prototype-style code (`app.get = ...`, `res.get = ...`, `Route.prototype.all = ...`)
    // the owner IS the conventional variable name, so `app.get()` belongs to `app`, not to the unrelated `res.get`.
    const hint = only ? undefined : this.receiverHint(recv);
    // An imported name (`import shop.views` -> `shop.make_response()`) is a module namespace, not an instance of
    // the same-named class: the receiver's name says nothing about an owner then.
    const head = recv?.split('.')[0];
    const isImported = !!head && [...entry.bindings.keys()].some((k) => k === head || k.startsWith(head + '.'));
    if (hint && !isImported) {
      const owned = all.filter((c) => c.sym.className?.split('.').pop()?.toLowerCase() === hint);
      if (owned.length) {
        const nearOwned = owned.filter((c) => near.has(c.file));
        const pick = nearOwned.length ? nearOwned : owned;
        if (pick.length <= 4) return pick.map((c) => ({ ...c, confidence: (pick.length === 1 ? 'probable' : 'ambiguous') as Confidence }));
      } else if (this.protoOwners.has(hint)) {
        // The receiver names a prototype-style object we know (`app`) that has no extracted method of this
        // name (e.g. `app.get` is attached in a `methods.forEach` loop). A same-named method on a DIFFERENT
        // owner (`res.get`) is a collision, not evidence: report it unresolved rather than guess.
        return [];
      }
    }
    const nearC = all.filter((c) => near.has(c.file));
    const common = COMMON.has(name);
    if (nearC.length === 1) return [{ ...nearC[0], confidence: common ? 'ambiguous' : 'probable' }];
    if (nearC.length > 1 && nearC.length <= 4) return nearC.map((c) => ({ ...c, confidence: 'ambiguous' as Confidence }));
    if (!only && nearC.length === 0 && all.length >= 1 && all.length <= 3 && !common) {
      // Same gate as before (the filter must only ever remove edges, never widen the fallback).
      return all
        .filter((c) => !this.inUnreachedSiblingTree(entry.facts.path, c.file))
        .map((c) => ({ ...c, confidence: 'ambiguous' as Confidence }));
    }
    return [];
  }

  private resolveCall(entry: Entry, call: CallFact): { file: string; sym: SymbolFact; confidence: Confidence }[] {
    const path = entry.facts.path;
    const one = (file: string, sym: SymbolFact, confidence: Confidence) => [{ file, sym, confidence }];
    const strength: Confidence = call.kind === 'ref' ? 'probable' : 'resolved';

    if (call.kind === 'plain' || call.kind === 'new' || call.kind === 'ref') {
      // `def f(): from x import f; f()`: a function-local import shadows a same-named function declared outside it.
      const shadowed = !!call.caller && entry.scopedBindings.size > 0 && this.scoped(entry.scopedBindings, call.caller, call.callee) !== undefined;
      const local = shadowed ? undefined : this.scopeLookup(entry, call.caller, call.callee);
      if (local && !(call.kind === 'new' && local.kind !== 'class')) return one(path, local, strength);
      const b = this.bindingOf(entry, call.caller, call.callee);
      if (b) {
        const t = this.resolveBinding(path, b.imp, b.b);
        if (t?.type === 'symbol') return one(t.file, t.sym, strength);
        if (t?.type === 'module' && b.b.imported === '*' && call.kind !== 'ref') {
          const d = this.lookupExport(t.file, 'default');
          if (d) return one(d.file, d.sym, strength);
        }
        return [];
      }
      for (const imp of entry.facts.imports) {
        if (!imp.star) continue;
        const m = this.resolveModule(path, imp.specifier, imp.level ?? 0);
        if (m && 'file' in m) {
          const r = this.lookupExport(m.file, call.callee);
          if (r) return one(r.file, r.sym, strength);
        }
      }
      return [];
    }

    if (call.kind === 'this') {
      const cls = this.enclosingClass(entry, call.caller);
      if (cls) {
        const skipOwn = call.receiver === 'super';
        if (!skipOwn) {
          const own = this.findMethod(path, cls, call.callee);
          if (own) return one(own.file, own.sym, 'resolved');
        } else {
          for (const base of entry.symbols.get(cls)?.bases ?? []) {
            const b = this.resolveClassName(entry, base, null);
            const r = b && this.findMethod(b.file, b.sym.qname, call.callee);
            if (r) return one(r.file, r.sym, 'resolved');
          }
          // `super().method()` is a deliberate, scoped reference to the resolved base
          // chain. If nothing there matches, do NOT fall back to an unconstrained
          // same-file name search — that produces high-confidence-looking but wrong
          // edges: the class's own method of the same name, or an unrelated sibling
          // class's, neither of which is what `super()` refers to.
          return [];
        }
      }
      return this.nameFallback(entry, call.callee, new Set([path]));
    }

    // member call: recv.foo()
    const recv = call.receiver;
    if (recv) {
      // typed receiver: `g: CodeGraph`, `const g = new CodeGraph()`, `this.graph`, `self.store`
      const T = this.typeOfReceiver(entry, call.caller, recv);
      if (T) {
        const cls = this.resolveClassName(entry, T, call.caller);
        const m = cls && this.findMethod(cls.file, cls.sym.qname, call.callee);
        if (m) return one(m.file, m.sym, 'resolved');
        // `const seen = new Map()` -> `seen.get(k)` is Map#get, not some repo class's `get`.
        if (!cls && entry.facts.family === 'js' && JS_BUILTIN_TYPES.has(T)) return [];
      }
      // typed by a call's declared return type; a declared type that resolved to a class above takes precedence
      const R = recv.includes('.') ? undefined : this.scoped(entry.callTypes, call.caller, recv);
      if (R === 'builtin') return [];
      if (R) {
        const m = this.findMethod(R.file, R.sym.qname, call.callee);
        if (m) return one(m.file, m.sym, 'resolved');
      }
      // local class (static call)
      const localCls = this.scopeLookup(entry, call.caller, recv);
      if (localCls?.kind === 'class') {
        const m = this.findMethod(path, localCls.qname, call.callee);
        if (m) return one(m.file, m.sym, 'resolved');
      }
      // imported module / class
      let b = this.bindingOf(entry, call.caller, recv);
      let rest = '';
      if (!b) {
        const head = recv.split('.')[0];
        b = this.bindingOf(entry, call.caller, head);
        rest = recv.slice(head.length + 1);
      }
      if (b) {
        const t = this.resolveBinding(path, b.imp, b.b);
        if (t?.type === 'external') return [];
        if (t?.type === 'module') {
          if (!rest) {
            const r = this.lookupExport(t.file, call.callee);
            if (r) return one(r.file, r.sym, 'resolved');
          } else {
            const cls = this.lookupExport(t.file, rest.split('.')[0]);
            if (cls?.sym.kind === 'class') {
              const m = this.findMethod(cls.file, cls.sym.qname, call.callee);
              if (m) return one(m.file, m.sym, 'resolved');
            }
          }
          return this.nameFallback(entry, call.callee, new Set([t.file]));
        }
        if (t?.type === 'symbol' && t.sym.kind === 'class' && !rest) {
          const m = this.findMethod(t.file, t.sym.qname, call.callee);
          if (m) return one(m.file, m.sym, 'resolved');
        }
        if (t?.type === 'symbol') return this.nameFallback(entry, call.callee, new Set([t.file]));
      }
    }
    if (recv && this.isJsGlobal(entry, call.caller, recv.split('.')[0])) return [];
    return this.nameFallback(entry, call.callee, undefined, recv);
  }

  /** `name` is a JS global (JSON, Promise, ...) not shadowed by an import, symbol or variable of this file. */
  private isJsGlobal(entry: Entry, caller: string | null, name: string): boolean {
    return (
      entry.facts.family === 'js' &&
      JS_GLOBALS.has(name) &&
      !entry.bindings.has(name) &&
      !this.scopeLookup(entry, caller, name) &&
      !entry.facts.vars.some((v) => v.name === name)
    );
  }
}
