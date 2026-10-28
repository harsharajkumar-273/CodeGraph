// Does `check_change` catch a breaking edit before it is written? Mutation test with the TypeScript compiler as ground truth.
//
//   npx tsx scripts/eval/mutation-bench.mts <repo-dir> [perKind=15] [seed=1] [out.json]
//
// For functions and methods that have callers, it makes one edit at a time, in memory:
//   remove      delete the function                      (truth: the compiler reports errors at the calls that are left)
//   add-param   give it one more required parameter      (truth: the compiler reports errors at calls that pass too few)
// and three edits that should NOT be flagged as breaking:
//   body-edit   add a statement inside the body
//   add-func    add a new function to the file
//   remove-unused  delete a function nobody calls
// The compiler (`ts.Program` over the repository's own tsconfig, mutated file served from memory) says whether each edit
// breaks anything and where. `check_change` is given the same new file text. A grep baseline gets the same job: list the
// lines that mention the function's name outside its own definition.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import ts from 'typescript';
import { Workspace } from '../../packages/cli/src/workspace';

const [, , repoArg, perKindArg, seedArg, outPath] = process.argv;
const root = resolve(repoArg);
const perKind = Number(perKindArg ?? 15);
let seed = Number(seedArg ?? 1);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const shuffle = <T,>(xs: T[]) => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

const cfgPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')!;
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, dirname(cfgPath));
const rel = (f: string) => relative(root, f).split(sep).join('/');

/** Compiler errors as `file:line` -> message, with the given file served from memory. */
function tscErrors(over?: { path: string; text: string }): Map<string, string> {
  const host = ts.createCompilerHost(cfg.options);
  const read = host.readFile.bind(host);
  const abs = over && resolve(root, over.path);
  host.readFile = (f) => (abs && resolve(f) === abs ? over!.text : read(f));
  const sf = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onErr, shouldCreate) => (abs && resolve(f) === abs ? ts.createSourceFile(f, over!.text, lang) : sf(f, lang, onErr, shouldCreate));
  const program = ts.createProgram(cfg.fileNames, cfg.options, host);
  const out = new Map<string, string>();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (!d.file || d.start === undefined) continue;
    const line = d.file.getLineAndCharacterOfPosition(d.start).line + 1;
    out.set(`${rel(d.file.fileName)}:${line}`, ts.flattenDiagnosticMessageText(d.messageText, ' '));
  }
  return out;
}

const ws = new Workspace(root, 0);
const snap = await ws.current();
const g = snap.index.graph;
const base = tscErrors();
console.error(`baseline: ${snap.files.size} files, ${base.size} compiler errors already present`);

const baseProgram = ts.createProgram(cfg.fileNames, cfg.options);
const checker = baseProgram.getTypeChecker();
const callIndex = new Map<ts.Symbol, string[]>(); // declaration symbol -> call sites as file:line
for (const sf of baseProgram.getSourceFiles()) {
  if (sf.isDeclarationFile || !sf.fileName.startsWith(root)) continue;
  (function visit(n: ts.Node) {
    let callee: ts.Node | undefined;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) callee = n.expression;
    else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) callee = n.tagName;
    if (callee) {
      const id = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
      let sym = checker.getSymbolAtLocation(id);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      if (sym) callIndex.set(sym, [...(callIndex.get(sym) ?? []), `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(id.getStart()).line + 1}`]);
    }
    ts.forEachChild(n, visit);
  })(sf);
}
function callSitesOf(path: string, namePos: number): string[] {
  const sf = baseProgram.getSourceFile(resolve(root, path));
  if (!sf) return [];
  const nameNode = (function find(n: ts.Node): ts.Node | undefined { return n.getStart(sf) <= namePos && namePos < n.getEnd() && n.getChildCount(sf) === 0 ? n : ts.forEachChild(n, find); })(sf);
  const sym = nameNode && checker.getSymbolAtLocation(nameNode);
  return (sym && callIndex.get(sym)) || [];
}

type Decl = ts.FunctionDeclaration | ts.MethodDeclaration;
function findDecl(text: string, path: string, line: number): { sf: ts.SourceFile; d: Decl } | undefined {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let hit: Decl | undefined;
  (function visit(n: ts.Node) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.body && n.name && sf.getLineAndCharacterOfPosition(n.name.getStart()).line + 1 === line) hit = n;
    if (!hit) ts.forEachChild(n, visit);
  })(sf);
  return hit && { sf, d: hit };
}
const cut = (t: string, a: number, b: number, mid = '') => t.slice(0, a) + mid + t.slice(b);

const MUT: Record<string, (text: string, d: Decl) => string> = {
  remove: (t, d) => cut(t, d.getFullStart(), d.getEnd()),
  'remove-unused': (t, d) => cut(t, d.getFullStart(), d.getEnd()),
  'add-param': (t, d) => {
    const ps = d.parameters;
    return ps.length ? cut(t, ps[ps.length - 1].getEnd(), ps[ps.length - 1].getEnd(), ', __extra: number') : cut(t, d.body!.getStart() - 0, d.body!.getStart(), '') && insertEmptyParam(t, d);
  },
  'body-edit': (t, d) => cut(t, d.body!.getStart() + 1, d.body!.getStart() + 1, ' void 0; '),
  'add-func': (t) => t + '\nexport function __cgBenchNew(a: number) { return a; }\n',
};
function insertEmptyParam(t: string, d: Decl) {
  const open = t.indexOf('(', d.name!.getEnd());
  return cut(t, open + 1, open + 1, '__extra: number');
}

const funcs = g.nodes(['function', 'method']).filter((n) => n.file && n.startLine && /packages\/.*\/src\//.test(n.file) && /\.tsx?$/.test(n.file) && !n.qualifiedName?.includes('.<'));
const callers = (id: string) => g.incoming(id, ['calls']).length;
const called = shuffle(funcs.filter((n) => callers(n.id) > 0));
const uncalled = shuffle(funcs.filter((n) => callers(n.id) === 0 && n.kind === 'function' && n.exported === false));

interface Row { truthAll: number; toolFileOk: number; toolAt: string[]; truth: string[]; grep: string[]; kind: string; symbol: string; truthBreaks: boolean; truthSites: number; verdict: string; flagged: boolean; toolSites: number; toolHit: number; toolHitFile: number; grepSites: number; grepHit: number; grepHitFile: number; ms: number }
const rows: Row[] = [];
const plan: [string, typeof funcs][] = [
  ['remove', called], ['add-param', called], ['body-edit', called], ['add-func', called], ['remove-unused', uncalled],
];
for (const [kind, pool] of plan) {
  let done = 0;
  for (const n of pool) {
    if (done >= perKind) break;
    const path = n.file!;
    const text = snap.files.get(path)!;
    const found = findDecl(text, path, n.startLine!);
    if (!found || (kind === 'add-param' && found.d.parameters.some((p) => p.dotDotDotToken || p.questionToken || p.initializer))) continue; // a required parameter after an optional one is not valid TypeScript
    const mutated = MUT[kind](text, found.d);
    const t0 = Date.now();
    const errs = tscErrors({ path, text: mutated });
    const truth = [...errs.keys()].filter((k) => !base.has(k) || base.get(k) !== errs.get(k));
    // The call sites are what the compiler binds to the declaration in the unmutated program (calls, `new`, JSX): the error
    // lines are a poor list of them, because a missing import hides every use of the name behind one error at the import.
    // Sites in the mutated file are renumbered the way the edit renumbered them; sites inside deleted lines are gone.
    const oldL = text.split('\n');
    const newL = mutated.split('\n');
    let pre = 0;
    while (pre < oldL.length && pre < newL.length && oldL[pre] === newL[pre]) pre++;
    let suf = 0;
    while (suf < oldL.length - pre && suf < newL.length - pre && oldL[oldL.length - 1 - suf] === newL[newL.length - 1 - suf]) suf++;
    const shift = (k: string) => {
      const [f, l] = [k.slice(0, k.lastIndexOf(':')), Number(k.slice(k.lastIndexOf(':') + 1))];
      if (f !== path || l <= pre) return k;
      if (l > oldL.length - suf) return `${f}:${l - (oldL.length - newL.length)}`;
      return undefined;
    };
    const siteOnly = kind === 'remove' || kind === 'add-param';
    const truthCalls = siteOnly ? callSitesOf(path, found.d.name!.getStart(found.sf)).map(shift).filter((k): k is string => !!k) : [];
    const r = await ws.check([{ path, content: mutated }]);
    const toolAt = r.findings.flatMap((f) => (f.kind === 'public-api-removed' ? [] : f.at));
    const toolFiles = new Set(toolAt.map((k) => k.split(':')[0]));
    // grep baseline: every line elsewhere that mentions the name (whole word), what a text search would hand an agent.
    const name = n.name;
    const re = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
    const grep: string[] = [];
    for (const [f, t] of snap.files) t.split('\n').forEach((l, i) => { if (re.test(l) && !(f === path && Math.abs(i + 1 - n.startLine!) < 1)) grep.push(`${f}:${i + 1}`); });
    if (kind === 'remove') grep.splice(0, grep.length, ...grep.map(shift).filter((k): k is string => !!k));
    const grepFiles = new Set(grep.map((k) => k.split(':')[0]));
    rows.push({
      toolAt, truth, grep: grep.slice(0, 40), kind, symbol: `${path}#${n.qualifiedName}`, truthBreaks: truth.length > 0, truthSites: truthCalls.length, truthAll: truth.length,
      verdict: r.verdict, flagged: r.verdict === 'breaking', toolSites: toolAt.length,
      toolHit: toolAt.filter((k) => truthCalls.includes(k)).length, toolFileOk: toolAt.filter((k) => truth.some((t) => t.split(':')[0] === k.split(':')[0])).length, toolHitFile: truth.filter((k) => toolFiles.has(k.split(':')[0])).length,
      grepSites: grep.length, grepHit: grep.filter((k) => truthCalls.includes(k)).length, grepHitFile: truth.filter((k) => grepFiles.has(k.split(':')[0])).length,
      ms: Date.now() - t0,
    });
    done++;
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a');
const lines: string[] = [];
lines.push('| edit | n | compiler says broken | check_change says breaking | caught (of broken) | false alarms (of sound) | call-site recall | call-site precision | grep: recall | grep: precision |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const [kind] of plan) {
  const rs = rows.filter((r) => r.kind === kind);
  if (!rs.length) continue;
  const broken = rs.filter((r) => r.truthBreaks);
  const sound = rs.filter((r) => !r.truthBreaks);
  const sites = kind === 'remove' || kind === 'add-param';
  lines.push(
    `| ${kind} | ${rs.length} | ${broken.length} | ${rs.filter((r) => r.flagged).length} | ${pct(broken.filter((r) => r.flagged).length, broken.length)} | ${pct(sound.filter((r) => r.flagged).length, sound.length)} | ` +
      (sites
        ? `${pct(sum(rs.map((r) => r.toolHit)), sum(rs.map((r) => r.truthSites)))} | ${pct(sum(rs.map((r) => r.toolHit)), sum(rs.map((r) => r.toolSites)))} | ` +
          `${pct(sum(rs.map((r) => r.grepHit)), sum(rs.map((r) => r.truthSites)))} | ${pct(sum(rs.map((r) => r.grepHit)), sum(rs.map((r) => r.grepSites)))} |`
        : 'n/a | n/a | n/a | n/a |'),
  );
}
console.log(lines.join('\n'));
const misses = rows.filter((r) => r.truthBreaks !== r.flagged);
console.log(`\ndisagreements with the compiler (${misses.length}):`);
for (const m of misses) console.log(`  ${m.kind.padEnd(14)} ${m.symbol}  compiler:${m.truthBreaks ? `breaks(${m.truthSites})` : 'ok'}  tool:${m.verdict}`);
console.log(`\nmedian check time ${[...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]}ms (includes the compiler run)`);
if (outPath) writeFileSync(outPath, JSON.stringify({ root: repoArg, perKind, seed: Number(seedArg ?? 1), rows }, null, 1));
