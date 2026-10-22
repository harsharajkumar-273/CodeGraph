/**
 * Language-neutral "facts" extracted from a single file's AST.
 * Extractors only look at ONE file; cross-file resolution happens in resolve.ts.
 */
export interface SymbolFact {
  name: string;
  /** Dot-qualified name within the file, e.g. `Foo.bar` or `outer.inner`. */
  qname: string;
  kind: 'function' | 'method' | 'class';
  startLine: number;
  endLine: number;
  /** qname of the enclosing class (methods only). */
  className?: string;
  /** Base classes as written in source (`Base`, `ns.Base`). */
  bases?: string[];
  /**
   * Method attached to a local object inside an anonymous callback (`schema.parse = ...` in a test body).
   * Only code in the same file can plausibly call it, so name-based matching never offers it to other files.
   */
  local?: boolean;
  /** Declared return type as written (`Response`, `Foo`), for functions and methods. */
  returns?: string;
  /** What `await f()` yields: `Promise<Foo>` and `Foo | Promise<Foo>` give `Foo`. */
  returnsAwaited?: string;
}

export interface ImportBinding {
  local: string;
  /** Imported name, `default` for default imports, `*` for namespace/module imports. */
  imported: string;
}

export interface ImportFact {
  specifier: string;
  bindings: ImportBinding[];
  line: number;
  /** Python relative import depth (`from ..x import y` => 2). */
  level?: number;
  /** `export * from` (JS) / `from x import *` (Python). */
  star?: boolean;
  /** Inside `if TYPE_CHECKING:` (Python) — erased at runtime, not a real dependency edge. */
  typeOnly?: boolean;
  /** qname of the function the import sits inside (Python `def f(): from x import y`); absent for module-level imports. */
  scope?: string;
}

export interface ExportFact {
  /** Exported name; `default` for the default export. */
  name: string;
  /** qname of a local symbol being exported. */
  local?: string;
  /** Re-export: specifier of the source module and the name inside it (`*` = namespace). */
  from?: string;
  fromName?: string;
}

export interface CallFact {
  /** qname of the enclosing symbol, or null when at module top level. */
  caller: string | null;
  callee: string;
  /** Dotted receiver text for member calls (`a.b` in `a.b.c()`). */
  receiver?: string;
  /**
   * plain  : foo()
   * member : recv.foo()
   * this   : this.foo() / self.foo() / super().foo()
   * new    : new Foo() / new ns.Foo()
   * ref    : foo passed as a value (callback, JSX prop, decorator)
   */
  kind: 'plain' | 'member' | 'this' | 'new' | 'ref';
  line: number;
  /** Go: the receiver is a composite literal or conversion of this type (`T{}.M()`). */
  recvType?: string;
  /** Go: the receiver is the result of this call (`NewX().Run()`, `a.B().C()`). */
  recvCall?: Omit<CallFact, 'caller' | 'line'>;
  /** Go: the lexical scope of the call: the function's qname, plus `/λN` for each function literal around it. */
  scope?: string;
}

/** Declared/inferred type of a variable, parameter or field: enables `x.method()` resolution. */
export interface TypeHint {
  /** Enclosing symbol qname, `class:<qname>` for fields (`this.x`), or null for module scope. */
  scope: string | null;
  /** Variable name as written at the call site (`g`, `this.graph`, `self.store`). */
  name: string;
  /** Class name as written (`Foo`, `ns.Foo`). */
  type: string;
  /** Go: where the variable is declared, to pick the nearest preceding declaration when a name is reused. */
  line?: number;
}

/**
 * A variable initialised from a call (`const res = await app.request('/')`, `resp = client.get(url)`): typed by the
 * declared return type of whatever that call resolves to, which only the resolver can know.
 */
export interface CallTypeHint {
  /** Enclosing symbol qname, or null for module scope (as in TypeHint). */
  scope: string | null;
  name: string;
  call: Omit<CallFact, 'caller'>;
  awaited: boolean;
  /** Go: which of the call's results the variable takes (`a, err := f()` => 0 and 1). */
  index?: number;
}

/**
 * One (re)definition of a local variable or parameter within a function/module scope.
 * Stage 1 is intra-procedural and lexical: `reads` only ever resolves against variables
 * declared in the SAME scope. Free variables, closures over an outer scope, and object
 * fields (`this.x`, `self.x`) are intentionally not tracked yet.
 */
export interface VarFact {
  /** Enclosing function/method qname, or null for module-level code. */
  scope: string | null;
  name: string;
  kind: 'param' | 'const' | 'let' | 'var' | 'assign' | 'aug' | 'loop' | 'catch';
  line: number;
  /** Names read while producing this definition (RHS of `=`, the iterable of a `for`, a param default). */
  reads: string[];
}

/** What only Go needs: its unit is the package (a directory), and its types carry fields, embedding and results. */
export interface GoFacts {
  /** The `package` clause. */
  pkg: string;
  /** The `//go:build` expression, if the file has one. */
  build?: string;
  /** Result types of each function or method, as written (`error`, `*Server`, `[]Item`). */
  results: Record<string, string[]>;
  /** Struct fields by type name; an embedded type is a field named after itself. */
  fields: Record<string, Record<string, string>>;
  /** Every name declared in a function (parameters, receiver, variables), typed or not: such a name is not a package or a function. */
  locals: Record<string, string[]>;
}

export interface FileFacts {
  path: string;
  lang: string;
  family: 'js' | 'python' | 'go';
  symbols: SymbolFact[];
  imports: ImportFact[];
  exports: ExportFact[];
  calls: CallFact[];
  types: TypeHint[];
  vars: VarFact[];
  callTypes?: CallTypeHint[];
  go?: GoFacts;
  lineCount?: number;
}
