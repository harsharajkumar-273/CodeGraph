// Resolves Go calls. Go's unit is the package (a directory), not the file: every file of a package sees the others'
// functions and types without importing them, packages are imported by module path, methods attach to types wherever
// they are declared, and embedding promotes methods. So this does not share the file-and-import model of resolve.ts.
import * as p from './posix';
import { CodeGraph, externalId, fileId, symbolId, type Confidence, type GraphNode } from '@codegraph/core';
import type { BuildStats, CallTrace } from './resolve';
import { outerScope } from './go';
import type { CallFact, FileFacts, SymbolFact, TypeHint, CallTypeHint } from './types';

interface Ref {
  file: FileFacts;
  sym: SymbolFact;
}
interface TypeInfo extends Ref {
  pkg: Pkg;
  fields: Record<string, string>;
}
interface Pkg {
  dir: string;
  name: string;
  files: FileFacts[];
  funcs: Map<string, Ref>;
  types: Map<string, TypeInfo>;
  methods: Map<string, Map<string, Ref>>;
  /** Package-level variables with a declared or inferable type, as written in the file that declares them. */
  vars: Map<string, { file: FileFacts; type?: string; call?: { shape: Shape; index: number } }>;
}
/** A resolved type: a repo type, a type with no repo methods, a slice or map (with its element), or unknown. */
type TypeRef = { pkg: Pkg; name: string } | { elem: TypeRef } | 'builtin' | 'external' | undefined;
/** A call without its caller; `line` is absent on a call that only describes a receiver. */
type Shape = Omit<CallFact, 'caller' | 'line'> & { line?: number };
type Target = { ref: Ref; confidence: Confidence };

const BUILTIN_TYPES = new Set([
  'bool', 'string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'byte', 'rune', 'float32', 'float64', 'complex64', 'complex128', 'error', 'any', 'comparable', 'func', 'chan', 'interface',
  'struct', 'slice', 'map',
]);

const isNamed = (t: TypeRef): t is { pkg: Pkg; name: string } => typeof t === 'object' && t !== undefined && 'pkg' in t;
const isTestFile = (path: string) => path.endsWith('_test.go');
const isUpper = (s: string) => /^[A-Z]/.test(s);

const GOOS = new Set(['aix', 'android', 'darwin', 'dragonfly', 'freebsd', 'hurd', 'illumos', 'ios', 'js', 'linux', 'nacl', 'netbsd', 'openbsd', 'plan9', 'solaris', 'wasip1', 'windows', 'zos']);
const GOARCH = new Set(['386', 'amd64', 'amd64p32', 'arm', 'armbe', 'arm64', 'arm64be', 'loong64', 'mips', 'mipsle', 'mips64', 'mips64le', 'mips64p32', 'mips64p32le', 'ppc', 'ppc64', 'ppc64le', 'riscv', 'riscv64', 's390', 's390x', 'sparc', 'sparc64', 'wasm']);
const TAGS_ON = new Set(['linux', 'amd64', 'unix', 'gc', 'cgo']);

/** Evaluates a `//go:build` expression for linux/amd64, the platform the type checker used (unknown tags are off). */
function buildOk(expr: string): boolean {
  const tokens = expr.match(/\|\||&&|!|\(|\)|[\w.]+/g) ?? [];
  let i = 0;
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === '!') return !atom();
    if (t === '(') {
      const v = or();
      i++; // ')'
      return v;
    }
    return TAGS_ON.has(t) || /^go1\.\d+$/.test(t);
  };
  const and = (): boolean => {
    let v = atom();
    while (tokens[i] === '&&') {
      i++;
      v = atom() && v;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (tokens[i] === '||') {
      i++;
      v = and() || v;
    }
    return v;
  };
  return or();
}

/** Whether a file is part of the build on linux/amd64: its name suffix (`_windows.go`, `_arm64.go`) and `//go:build` line. */
function activeFile(f: FileFacts): boolean {
  const parts = p.basename(f.path).replace(/\.go$/, '').replace(/_test$/, '').split('_');
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  if (parts.length > 1 && GOARCH.has(last)) {
    if (last !== 'amd64') return false;
    if (parts.length > 2 && GOOS.has(prev) && prev !== 'linux') return false;
  } else if (parts.length > 1 && GOOS.has(last) && last !== 'linux') return false;
  return f.go?.build ? buildOk(f.go.build) : true;
}

export class GoResolver {
  private pkgs: Pkg[] = [];
  private pkgOf = new Map<string, Pkg>();
  private modules: { path: string; dir: string }[] = [];
  private aliases = new Map<string, Map<string, string>>(); // file -> local name -> import path
  private dotImports = new Map<string, string[]>();
  private importCache = new Map<string, Pkg | null>();
  private localSets = new Map<string, Set<string>>();
  private varCache = new Map<string, TypeRef | 'pending'>();
  private depth = 0;
  private activeCache = new Map<string, boolean>();

  constructor(
    private graph: CodeGraph,
    private files: FileFacts[],
    configs: Map<string, string>,
    private stats: BuildStats,
    private trace?: (t: CallTrace) => void,
  ) {
    for (const [path, text] of configs) {
      if (p.basename(path) !== 'go.mod') continue;
      const m = /^\s*module\s+("?)([^\s"]+)\1/m.exec(text);
      if (m) this.modules.push({ path: m[2], dir: p.dirname(path) === '.' ? '' : p.dirname(path) });
    }
    this.modules.sort((a, b) => b.path.length - a.path.length);
    this.group();
  }

  private active(f: FileFacts): boolean {
    let v = this.activeCache.get(f.path);
    if (v === undefined) this.activeCache.set(f.path, (v = activeFile(f)));
    return v;
  }

  // ---------------------------------------------------------------- packages

  private group() {
    const byKey = new Map<string, Pkg>();
    for (const f of this.files) {
      const dir = p.dirname(f.path) === '.' ? '' : p.dirname(f.path);
      const name = f.go?.pkg ?? '';
      const key = `${dir}|${name}`;
      let pkg = byKey.get(key);
      if (!pkg) {
        pkg = { dir, name, files: [], funcs: new Map(), types: new Map(), methods: new Map(), vars: new Map() };
        byKey.set(key, pkg);
        this.pkgs.push(pkg);
      }
      pkg.files.push(f);
      this.pkgOf.set(f.path, pkg);
    }
    for (const pkg of this.pkgs) {
      for (const f of pkg.files) {
        for (const s of f.symbols) {
          // The same name may be declared once per platform (`_unix.go`, `_windows.go`): the active file's wins.
          const wins = (cur: Ref | undefined) => !cur || (!this.active(cur.file) && this.active(f));
          if (s.kind === 'function') {
            if (s.name !== 'init' && s.name !== '_' && wins(pkg.funcs.get(s.name))) pkg.funcs.set(s.name, { file: f, sym: s });
          } else if (s.kind === 'class') {
            if (wins(pkg.types.get(s.name))) pkg.types.set(s.name, { file: f, sym: s, pkg, fields: f.go?.fields[s.name] ?? {} });
          } else if (s.className) {
            const m = pkg.methods.get(s.className) ?? new Map<string, Ref>();
            if (wins(m.get(s.name))) m.set(s.name, { file: f, sym: s });
            pkg.methods.set(s.className, m);
          }
        }
        for (const t of f.types) if (t.scope === null && !pkg.vars.has(t.name)) pkg.vars.set(t.name, { file: f, type: t.type });
        for (const c of f.callTypes ?? []) if (c.scope === null && !pkg.vars.has(c.name)) pkg.vars.set(c.name, { file: f, call: { shape: c.call, index: c.index ?? 0 } });
        const al = new Map<string, string>();
        const dots: string[] = [];
        for (const imp of f.imports) {
          const local = imp.bindings[0]?.local;
          if (local === '.') dots.push(imp.specifier);
          else if (local && local !== '_') al.set(local, imp.specifier);
        }
        this.aliases.set(f.path, al);
        this.dotImports.set(f.path, dots);
      }
    }
    // An import without an alias is named by the package's own clause, which may differ from the last path element.
    for (const f of this.files) {
      const al = this.aliases.get(f.path)!;
      for (const [local, spec] of [...al]) {
        const target = this.importTarget(spec);
        if (target && target.name && target.name !== local && spec.endsWith('/' + local)) al.set(target.name, spec);
      }
    }
  }

  /** The repo package an import path names, or null for the standard library and third-party code. */
  private importTarget(spec: string): Pkg | null {
    const hit = this.importCache.get(spec);
    if (hit !== undefined) return hit;
    let dir: string | undefined;
    for (const m of this.modules) {
      if (spec === m.path) dir = m.dir;
      else if (spec.startsWith(m.path + '/')) dir = p.join(m.dir, spec.slice(m.path.length + 1));
      if (dir !== undefined) break;
    }
    let result: Pkg | null = null;
    if (dir !== undefined) {
      const here = this.pkgs.filter((k) => k.dir === dir && !k.name.endsWith('_test'));
      result = here.sort((a, b) => Number(a.name === 'main') - Number(b.name === 'main') || b.files.length - a.files.length)[0] ?? null;
    }
    this.importCache.set(spec, result);
    return result;
  }

  // ---------------------------------------------------------------- types

  private resolveType(file: FileFacts, s: string | undefined): TypeRef {
    if (!s || s === '?') return undefined;
    if (s.startsWith('[]') || s.startsWith('{}')) return { elem: this.resolveType(file, s.slice(2)) };
    const pkg = this.pkgOf.get(file.path)!;
    const dot = s.indexOf('.');
    if (dot < 0) {
      const t = pkg.types.get(s);
      if (t) return { pkg, name: s };
      if (BUILTIN_TYPES.has(s)) return 'builtin';
      for (const spec of this.dotImports.get(file.path) ?? []) {
        const target = this.importTarget(spec);
        if (target?.types.has(s)) return { pkg: target, name: s };
      }
      return undefined;
    }
    const spec = this.aliases.get(file.path)?.get(s.slice(0, dot));
    if (!spec) return undefined;
    const target = this.importTarget(spec);
    if (!target) return 'external';
    const name = s.slice(dot + 1);
    return target.types.has(name) ? { pkg: target, name } : undefined;
  }

  private typeInfo(t: { pkg: Pkg; name: string }) {
    return t.pkg.types.get(t.name);
  }

  /** A method of `t`, own or promoted through embedded types. */
  private findMethod(t: { pkg: Pkg; name: string }, name: string, depth = 0, seen = new Set<string>()): Ref | 'external' | undefined {
    const k = `${t.pkg.dir}|${t.pkg.name}|${t.name}`;
    if (depth > 5 || seen.has(k)) return undefined;
    seen.add(k);
    const own = t.pkg.methods.get(t.name)?.get(name);
    if (own) return own;
    const info = this.typeInfo(t);
    if (!info) return undefined;
    let sawExternal = false;
    for (const base of info.sym.bases ?? []) {
      const b = this.resolveType(info.file, base);
      if (b === 'external') sawExternal = true;
      else if (isNamed(b)) {
        const r = this.findMethod(b, name, depth + 1, seen);
        if (r && r !== 'external') return r;
        if (r === 'external') sawExternal = true;
      }
    }
    return sawExternal ? 'external' : undefined;
  }

  private fieldType(t: { pkg: Pkg; name: string }, name: string, depth = 0): TypeRef {
    const info = this.typeInfo(t);
    if (!info || depth > 5) return undefined;
    const own = info.fields[name];
    if (own) return this.resolveType(info.file, own);
    for (const base of info.sym.bases ?? []) {
      const b = this.resolveType(info.file, base);
      if (isNamed(b)) {
        const r = this.fieldType(b, name, depth + 1);
        if (r) return r;
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------- variables

  /** The scopes visible from `scope`, innermost first (`F/λ1`, `F`), ending at package level (null). */
  private *scopes(scope: string | null): Generator<string | null> {
    for (let s = scope; ; s = s === null ? null : outerScope(s)) {
      yield s;
      if (s === null) return;
    }
  }

  private localSet(file: FileFacts, scope: string): Set<string> {
    const k = `${file.path}|${scope}`;
    let s = this.localSets.get(k);
    if (!s) {
      s = new Set(file.go?.locals[scope] ?? []);
      this.localSets.set(k, s);
    }
    return s;
  }

  /** True when `name` is a variable or parameter of the function (or of a literal around the call) rather than a package-level name. */
  private isLocal(file: FileFacts, scope: string | null, name: string): boolean {
    for (const s of this.scopes(scope)) if (s !== null && this.localSet(file, s).has(name)) return true;
    return false;
  }

  /**
   * The type of a variable visible at `scope` and `line`: 'unknown' when it is a local we cannot type, 'none' when it is
   * not a variable. Where a name is declared more than once in a scope, the nearest declaration above `line` wins.
   */
  private varType(file: FileFacts, scope: string | null, name: string, line: number): TypeRef | 'unknown' | 'none' {
    for (const s of this.scopes(scope)) {
      if (s === null || !this.localSet(file, s).has(name)) continue;
      const hints: { line: number; type?: TypeHint; call?: CallTypeHint }[] = [];
      for (const t of file.types) if (t.scope === s && t.name === name) hints.push({ line: t.line ?? 0, type: t });
      for (const c of file.callTypes ?? []) if (c.scope === s && c.name === name) hints.push({ line: c.call.line, call: c });
      if (!hints.length) return 'unknown';
      const before = hints.filter((h) => h.line <= line);
      const h = (before.length ? before : hints).reduce((x, y) => ((before.length ? y.line >= x.line : y.line <= x.line) ? y : x));
      const k = `${file.path}|${s}|${name}|${h.line}`;
      const cached = this.varCache.get(k);
      if (cached === 'pending') return 'unknown';
      if (this.varCache.has(k)) return (cached as TypeRef) ?? 'unknown';
      this.varCache.set(k, 'pending');
      // `for _, c := range c.commands` and `x := x.next` read the name they are about to declare: look above this line.
      const r = h.type ? this.fromHint(file, s, h.type.type, h.line - 1) : this.callResult(file, s, h.call!.call, h.call!.index ?? 0);
      this.varCache.set(k, r);
      return r ?? 'unknown';
    }
    const pkg = this.pkgOf.get(file.path)!;
    const v = pkg.vars.get(name);
    if (!v) return 'none';
    const k = `${v.file.path}||${name}`;
    const cached = this.varCache.get(k);
    if (cached === 'pending') return 'unknown';
    if (this.varCache.has(k)) return (cached as TypeRef) ?? 'unknown';
    this.varCache.set(k, 'pending');
    const r = v.type ? this.resolveType(v.file, v.type) : v.call ? this.callResult(v.file, null, v.call.shape, v.call.index) : undefined;
    this.varCache.set(k, r);
    return r ?? 'unknown';
  }

  private fromHint(file: FileFacts, scope: string | null, type: string, line: number): TypeRef {
    if (type.startsWith('@alias:')) return this.chainType(file, scope, type.slice(7), line);
    if (!type.startsWith('@elem:')) return this.resolveType(file, type);
    const c = this.chainType(file, scope, type.slice(6), line);
    return typeof c === 'object' && c && 'elem' in c ? c.elem : undefined;
  }

  /** The type of `a.b.c` where `a` is a variable (fields followed through structs and embedding) or an imported package's variable. */
  private chainType(file: FileFacts, scope: string | null, text: string, line: number): TypeRef {
    if (this.depth > 12) return undefined;
    this.depth++;
    try {
      const parts = text.split('.');
      const indexed = (t: TypeRef, part: string): TypeRef => {
        for (let n = (part.match(/\[\]/g) ?? []).length; n > 0; n--) t = typeof t === 'object' && t && 'elem' in t ? t.elem : undefined;
        return t;
      };
      const bare = (part: string) => part.replace(/(\[\])+$/, '');
      let cur: TypeRef;
      let i = 1;
      const head = this.varType(file, scope, bare(parts[0]), line);
      if (head === 'none') {
        const spec = this.aliases.get(file.path)?.get(parts[0]);
        const target = spec ? this.importTarget(spec) : null;
        if (!spec) return undefined;
        if (!target) return 'external';
        const name = parts[1] ? bare(parts[1]) : '';
        const v = name ? target.vars.get(name) : undefined;
        if (!v || !isUpper(name)) return undefined;
        cur = indexed(v.type ? this.resolveType(v.file, v.type) : v.call ? this.callResult(v.file, null, v.call.shape, v.call.index) : undefined, parts[1]);
        i = 2;
      } else cur = indexed(head === 'unknown' ? undefined : head, parts[0]);
      for (; i < parts.length; i++) {
        if (!isNamed(cur)) return cur === 'external' ? 'external' : undefined;
        cur = indexed(this.fieldType(cur, bare(parts[i])), parts[i]);
      }
      return cur;
    } finally {
      this.depth--;
    }
  }

  /** What `shape` returns at result position `index`, in the terms of the file that declares the callee. */
  private callResult(file: FileFacts, scope: string | null, shape: Shape, index: number): TypeRef {
    if (this.depth > 12) return undefined;
    this.depth++;
    try {
      const conv = this.conversion(file, shape);
      if (conv) return conv;
      const caller = scope === null ? null : scope.split('/')[0] || null;
      const targets = this.resolve(file, { ...shape, caller, scope: scope ?? undefined, line: shape.line ?? 0 });
      const t = targets.find((x) => x.confidence === 'resolved') ?? targets[0];
      if (!t) return undefined;
      const res = t.ref.file.go?.results[t.ref.sym.qname]?.[index];
      return this.resolveType(t.ref.file, res);
    } finally {
      this.depth--;
    }
  }

  /** `T(x)` and `pkg.T(x)` are conversions to a type, not calls. */
  private conversion(file: FileFacts, shape: Shape): TypeRef {
    const pkg = this.pkgOf.get(file.path)!;
    if (shape.kind === 'plain' && !pkg.funcs.has(shape.callee) && pkg.types.has(shape.callee)) return { pkg, name: shape.callee };
    if (shape.kind === 'member' && shape.receiver && !shape.receiver.includes('.')) {
      const spec = this.aliases.get(file.path)?.get(shape.receiver);
      const target = spec ? this.importTarget(spec) : null;
      if (target && !target.funcs.has(shape.callee) && target.types.has(shape.callee)) return { pkg: target, name: shape.callee };
    }
    return undefined;
  }

  // ---------------------------------------------------------------- calls

  private resolve(file: FileFacts, call: CallFact): Target[] {
    const pkg = this.pkgOf.get(file.path)!;
    const scope = call.scope ?? call.caller;
    const one = (ref: Ref | undefined, confidence: Confidence = 'resolved'): Target[] => (ref ? [{ ref, confidence }] : []);

    if (call.kind === 'plain' || call.kind === 'ref') {
      if (this.isLocal(file, scope, call.callee)) return []; // a closure or function value held in a variable
      const own = pkg.funcs.get(call.callee);
      if (own) return one(own, call.kind === 'ref' ? 'probable' : 'resolved');
      for (const spec of this.dotImports.get(file.path) ?? []) {
        const f = this.importTarget(spec)?.funcs.get(call.callee);
        if (f && isUpper(call.callee)) return one(f, call.kind === 'ref' ? 'probable' : 'resolved');
      }
      return [];
    }

    let type: TypeRef;
    if (call.recvType) type = this.resolveType(file, call.recvType);
    else if (call.recvCall) type = this.callResult(file, scope, { ...call.recvCall, line: call.line }, 0);
    else if (call.receiver) {
      const head = call.receiver.split('.')[0].replace(/(\[\])+$/, '');
      const v = this.varType(file, scope, head, call.line);
      if (v === 'none') {
        const spec = this.aliases.get(file.path)?.get(head);
        if (!spec) return []; // not a variable and not an import we know: nothing to say
        const target = this.importTarget(spec);
        if (!target) return [];
        if (call.receiver === head) return isUpper(call.callee) ? one(target.funcs.get(call.callee)) : [];
        type = this.chainType(file, scope, call.receiver, call.line);
      } else {
        type = this.chainType(file, scope, call.receiver, call.line);
      }
    } else return [];

    if (isNamed(type)) {
      const m = this.findMethod(type, call.callee);
      return m && m !== 'external' ? one(m) : [];
    }
    // A variable whose type could not be worked out gets no edge: Go is statically typed, so a guess by method name
    // mostly lands on the wrong receiver (measured: about one in eight such guesses was right).
    return [];
  }

  // ---------------------------------------------------------------- graph

  build() {
    const g = this.graph;
    for (const f of this.files) {
      g.addNode({ id: fileId(f.path), kind: 'file', name: p.basename(f.path), qualifiedName: f.path, file: f.path, lang: f.lang, startLine: 1, endLine: f.lineCount });
    }
    for (const f of this.files) {
      const pkg = this.pkgOf.get(f.path)!;
      for (const s of f.symbols) {
        const owner = s.className ? pkg.types.get(s.className) : undefined;
        const parent = owner ? symbolId(owner.file.path, owner.sym.qname) : fileId(f.path);
        const exported = isUpper(s.name) && (!s.className || isUpper(s.className));
        const node: GraphNode = { id: symbolId(f.path, s.qname), kind: s.kind, name: s.name, qualifiedName: s.qname, file: f.path, lang: f.lang, startLine: s.startLine, endLine: s.endLine, exported, parent };
        g.addNode(node);
      }
    }
    for (const f of this.files) {
      for (const s of f.symbols) {
        const id = symbolId(f.path, s.qname);
        g.addEdge({ from: g.node(id)!.parent!, to: id, kind: 'defines', confidence: 'resolved', line: s.startLine });
      }
    }
    for (const f of this.files) this.addImports(f);
    for (const f of this.files) this.addExtends(f);
    for (const f of this.files) this.addCalls(f);
  }

  private addImports(f: FileFacts) {
    const g = this.graph;
    const from = fileId(f.path);
    for (const imp of f.imports) {
      const target = this.importTarget(imp.specifier);
      if (target) {
        // Importing a package depends on all of it: a change in any of its files can reach this one.
        for (const t of target.files) if (!isTestFile(t.path)) g.addEdge({ from, to: fileId(t.path), kind: 'imports', confidence: 'resolved', line: imp.line });
      } else {
        const id = externalId(imp.specifier);
        g.addNode({ id, kind: 'external', name: imp.specifier });
        g.addEdge({ from, to: id, kind: 'imports', confidence: 'resolved', line: imp.line });
      }
    }
  }

  private addExtends(f: FileFacts) {
    for (const s of f.symbols) {
      if (s.kind !== 'class') continue;
      for (const base of s.bases ?? []) {
        const b = this.resolveType(f, base);
        if (!isNamed(b)) continue;
        const info = this.typeInfo(b);
        if (info) this.graph.addEdge({ from: symbolId(f.path, s.qname), to: symbolId(info.file.path, info.sym.qname), kind: 'extends', confidence: 'resolved' });
      }
    }
  }

  private addCalls(f: FileFacts) {
    for (const call of f.calls) {
      const from = call.caller ? symbolId(f.path, call.caller) : fileId(f.path);
      if (call.caller && !this.graph.hasNode(from)) continue;
      const targets = this.resolve(f, call);
      this.trace?.({ file: f.path, call, targets: targets.map((t) => ({ file: t.ref.file.path, qname: t.ref.sym.qname, confidence: t.confidence })) });
      if (!targets.length) {
        this.stats.unresolvedCalls++;
        continue;
      }
      for (const t of targets) {
        this.graph.addEdge({ from, to: symbolId(t.ref.file.path, t.ref.sym.qname), kind: 'calls', confidence: t.confidence, line: call.line });
        if (t.confidence === 'resolved') this.stats.resolvedCalls++;
        else if (t.confidence === 'probable') this.stats.probableCalls++;
        else this.stats.ambiguousCalls++;
      }
    }
  }
}
