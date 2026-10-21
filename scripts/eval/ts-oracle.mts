// Independent ground truth for TypeScript call edges: asks the TypeScript compiler (not CodeGraph, not a human or
// an LLM labeler) which declaration every call site binds to. One JSON line per call site.
//
//   npx tsx scripts/eval/ts-oracle.mts <repo-dir> <graph.json> <out.jsonl>
//
// Only call shapes CodeGraph extracts are considered: `f()`, `a.b.f()`, `this.f()`, `new F()` (identifier or
// property-access callee). Each row's `verdict`:
//   internal  the checker resolved the callee to a function/method/class declared in this repo, and `target` is the
//             graph node (`<file>#<qualifiedName>`) whose definition starts at that declaration
//   nosym     resolved to a declaration in this repo that has no graph node (object-literal method, a const bound to a
//             call result, ...) -> the right answer for CodeGraph is to emit nothing
//   external  resolved to a declaration outside the repo (lib.d.ts, node_modules) -> any internal edge is wrong
//   abstract  resolved to an interface/abstract/overload signature with no body: the runtime target is not
//             determined statically, so the site is excluded from scoring
//   unknown   the checker could not resolve it (any-typed, missing dependency types) -> excluded from scoring
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const [, , repoArg, graphPath, out] = process.argv;
const root = resolve(repoArg);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const SKIP = new Set(['node_modules', '.git', '.codegraph', 'dist', 'build', 'coverage']);

const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    if (SKIP.has(e)) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mts|cts)$/.test(e) && !/\.d\.[mc]?ts$/.test(e)) files.push(p);
  }
})(root);

// Root tsconfig compilerOptions (paths/baseUrl matter for resolution); every source file is a root name so that
// tests, examples and sub-packages are all covered.
let options: ts.CompilerOptions = {};
const cfgPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
if (cfgPath && resolve(cfgPath).startsWith(root)) {
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  options = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root).options;
}
options = { ...options, noEmit: true, skipLibCheck: true, allowJs: false, composite: false, incremental: false };
const program = ts.createProgram(files, options);
const checker = program.getTypeChecker();

const rel = (f: string) => relative(root, f).split(sep).join('/');
const inRepo = (f: string) => {
  const r = relative(root, f);
  return !r.startsWith('..') && !r.split(sep).some((s) => SKIP.has(s)) && !/\.d\.[mc]?ts$/.test(f);
};

type GNode = { file: string; qualifiedName: string; kind: string; startLine: number; endLine: number };
const byFile = new Map<string, GNode[]>();
for (const n of graph.nodes as GNode[]) {
  if (!n.file || !['function', 'method', 'class'].includes(n.kind)) continue;
  (byFile.get(n.file) ?? byFile.set(n.file, []).get(n.file)!).push(n);
}

const lineOf = (sf: ts.SourceFile, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const isFnExpr = (e: ts.Expression | undefined): e is ts.Expression => {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
  return !!e && (ts.isFunctionExpression(e) || ts.isArrowFunction(e) || ts.isClassExpression(e));
};
const initOf = (d: ts.Declaration) =>
  ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d) ? d.initializer : undefined;
const hasBody = (d: ts.Declaration) =>
  ((ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isConstructorDeclaration(d)) && !!d.body) ||
  ts.isFunctionExpression(d) || ts.isArrowFunction(d) || ts.isClassDeclaration(d) || ts.isClassExpression(d) ||
  isFnExpr(initOf(d));
// A declaration that binds a value computed at runtime (`const parse = _parse(Err)`, `x = cond ? f : g`): the code
// that runs exists, but no single declaration names it.
const isOpaqueValue = (d: ts.Declaration) => !!initOf(d) && !isFnExpr(initOf(d));

// The graph node whose definition starts at this declaration: same file, its range covers the declaration's name, and
// it starts between the declaration's first line and its name (or, for `const f =\n () => …`, its initializer), so an
// object-literal method does not map to its enclosing function.
function nodeFor(d: ts.Declaration): GNode | null {
  const sf = d.getSourceFile();
  const cands = byFile.get(rel(sf.fileName)) ?? [];
  const name = ts.getNameOfDeclaration(d) ?? d;
  const nameLine = lineOf(sf, name.getStart(sf));
  const lo = Math.min(lineOf(sf, d.getStart(sf)), nameLine);
  const init = initOf(d);
  const hi = Math.max(nameLine, init ? lineOf(sf, init.getStart(sf)) : 0);
  const hits = cands.filter((n) => n.startLine >= lo && n.startLine <= hi && n.endLine >= hi);
  hits.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  return hits[0] ?? null;
}

const rows: unknown[] = [];
const counts: Record<string, number> = {};
for (const sf of program.getSourceFiles()) {
  if (!inRepo(sf.fileName) || !files.includes(sf.fileName)) continue;
  const file = rel(sf.fileName);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) ? callee.name : null;
      if (nameNode && !(ts.isIdentifier(callee) && callee.text === 'require')) {
        const row = classify(nameNode, ts.isNewExpression(node));
        rows.push({ file, line: lineOf(sf, node.getStart(sf)), callee: nameNode.text, isNew: ts.isNewExpression(node), ...row });
        counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function classify(nameNode: ts.Identifier, isNew: boolean): { verdict: string; target?: string; alts?: string[]; at?: string } {
  let sym = checker.getSymbolAtLocation(nameNode);
  if (!sym) return { verdict: 'unknown' };
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  // `const f = g` / `export { g as f }` chains: follow a variable initialised with a bare identifier.
  for (let i = 0; i < 5 && sym.valueDeclaration && ts.isVariableDeclaration(sym.valueDeclaration) && sym.valueDeclaration.initializer && ts.isIdentifier(sym.valueDeclaration.initializer); i++) {
    const next = checker.getSymbolAtLocation(sym.valueDeclaration.initializer);
    if (!next) break;
    sym = next.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(next) : next;
  }
  const decls = (sym.declarations ?? []).filter((d) => !ts.isTypeAliasDeclaration(d) && !ts.isInterfaceDeclaration(d) && !ts.isModuleDeclaration(d));
  if (!decls.length) return { verdict: (sym.declarations ?? []).length ? 'abstract' : 'unknown' };
  if (decls.every((d) => !inRepo(d.getSourceFile().fileName))) return { verdict: 'external', at: decls[0].getSourceFile().fileName.split('node_modules/').pop() };
  const local = decls.filter((d) => inRepo(d.getSourceFile().fileName));
  const impl = local.filter(hasBody);
  if (!impl.length) {
    const v = local.find(isOpaqueValue);
    return v ? { verdict: 'nosym', at: `${rel(v.getSourceFile().fileName)}:${lineOf(v.getSourceFile(), v.getStart())}` } : { verdict: 'abstract' };
  }
  const targets = [...new Set(impl.map(nodeFor).filter((n): n is GNode => !!n).map((n) => `${n.file}#${n.qualifiedName}`))];
  if (isNew) {
    // `new C()` is correct when it points at the class or at its constructor.
    for (const t of [...targets]) if (!t.endsWith('.constructor')) targets.push(t + '.constructor');
  }
  const d0 = impl[0];
  const at = `${rel(d0.getSourceFile().fileName)}:${lineOf(d0.getSourceFile(), d0.getStart())}`;
  if (!targets.length) return { verdict: 'nosym', at };
  return { verdict: 'internal', target: targets[0], alts: targets, at };
}

writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n'));
console.log(`${out}: ${rows.length} call sites`, counts);
