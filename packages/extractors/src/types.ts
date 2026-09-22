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
}

/** Declared/inferred type of a variable, parameter or field: enables `x.method()` resolution. */
export interface TypeHint {
  /** Enclosing symbol qname, `class:<qname>` for fields (`this.x`), or null for module scope. */
  scope: string | null;
  /** Variable name as written at the call site (`g`, `this.graph`, `self.store`). */
  name: string;
  /** Class name as written (`Foo`, `ns.Foo`). */
  type: string;
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

export interface FileFacts {
  path: string;
  lang: string;
  family: 'js' | 'python';
  symbols: SymbolFact[];
  imports: ImportFact[];
  exports: ExportFact[];
  calls: CallFact[];
  types: TypeHint[];
  vars: VarFact[];
  lineCount?: number;
}
