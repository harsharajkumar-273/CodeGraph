import { execFile } from 'node:child_process';
import { promises as fs, existsSync, createReadStream, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CodeGraph, type Confidence, type GraphJSON, type GraphNode } from '@codegraph/core';
import { indexRepo, type IndexOptions } from '@codegraph/extractors';
import {
  blastRadius, changedNodes, importCycles, isTestPath, parseUnifiedDiff, removedButStillCalled, resolveTargets, slice, summarizeImpact, variableLineage,
  changedSignatures, removedPublicApi, type CallSite, type DanglingCall,
} from '@codegraph/analysis';
import { resolveRepo } from './repo';
import { impactMarkdown, symbolLabel, type BaseComparison } from './report';

const exec = promisify(execFile);

export interface Flags {
  [k: string]: string | boolean | undefined;
}

const C = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' };
const color = process.stdout.isTTY ? C : { dim: '', red: '', yellow: '', green: '', bold: '', off: '' };
const confColor = (c: Confidence) => (c === 'resolved' ? color.green : c === 'probable' ? color.yellow : color.red);

const label = (g: CodeGraph, id: string) => {
  const n = g.node(id);
  if (!n) return id;
  return n.kind === 'file' ? n.file! : `${n.file}#${n.qualifiedName}`;
};

async function load(repoArg: string, flags: Flags, trace?: IndexOptions['trace']): Promise<{ graph: CodeGraph; root: string }> {
  if (typeof flags.graph === 'string') {
    const json = JSON.parse(await fs.readFile(flags.graph, 'utf8')) as GraphJSON;
    return { graph: CodeGraph.fromJSON(json), root: json.root };
  }
  const root = await resolveRepo(repoArg);
  const { graph, stats, warnings } = await indexRepo(root, { trace });
  console.error(`${color.dim}indexed ${stats.files} files, ${stats.symbols} symbols in ${stats.ms}ms${color.off}`);
  for (const w of warnings.slice(0, 5)) console.error(`${color.yellow}warn${color.off} ${w}`);
  return { graph, root };
}

/** How the project runs its JavaScript tests, from package.json. */
async function jsRunner(root: string): Promise<'vitest' | 'jest' | undefined> {
  try {
    const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    return 'vitest' in all ? 'vitest' : 'jest' in all ? 'jest' : undefined;
  } catch {
    return undefined;
  }
}

// Default to 'probable': ambiguous edges are, by design, low-confidence name-only
// matches, and a blast radius or slice that defaults to including them is more
// likely to mislead than help. Pass --min-confidence ambiguous to see everything.
const minConf = (f: Flags): Confidence => {
  const v = f['min-confidence'];
  return v === 'resolved' || v === 'probable' || v === 'ambiguous' ? v : 'probable';
};

export async function cmdIndex(pos: string[], flags: Flags) {
  const root = await resolveRepo(pos[0] ?? '.');
  const res = await indexRepo(root);
  const out = typeof flags.o === 'string' ? flags.o : typeof flags.out === 'string' ? flags.out : join(root, '.codegraph', 'graph.json');
  await fs.mkdir(dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(res.graph.toJSON(res.stats as unknown as Record<string, number>)));
  const s = res.stats;
  console.log(`${color.bold}Indexed${color.off} ${root}`);
  console.log(`  files ${s.files} · symbols ${s.symbols} · import edges ${s.importEdges} · call edges ${s.callEdges}`);
  console.log(`  calls: ${s.resolvedCalls} resolved · ${s.probableCalls} probable · ${s.ambiguousCalls} ambiguous · ${s.unresolvedCalls} unresolved (external/builtin)`);
  console.log(`  ${s.ms}ms${s.skipped ? ` · ${s.skipped} large files skipped` : ''}${s.parseErrors ? ` · ${s.parseErrors} parse errors` : ''}`);
  console.log(`  graph written to ${out}`);
}

/**
 * A trace callback that records, per caller, the call sites that resolved to nothing (`name -> line`), and optionally every
 * call that did resolve, by the `file#name` it resolved to, with how many arguments it passes.
 */
function collectCalls(unresolved: Map<string, Map<string, number>>, sites?: Map<string, CallSite[]>): NonNullable<IndexOptions['trace']> {
  return (t) => {
    if (t.call.kind === 'ref') return;
    const caller = t.call.caller ? `${t.file}#${t.call.caller}` : t.file;
    if (!t.targets.length) {
      const m = unresolved.get(caller) ?? new Map<string, number>();
      m.set(t.call.callee, t.call.line);
      unresolved.set(caller, m);
      return;
    }
    if (!sites) return;
    for (const target of t.targets) {
      const k = `${target.file}#${target.qname}`;
      const list = sites.get(k) ?? [];
      list.push({ caller, file: t.file, line: t.call.line, argc: t.call.argc });
      sites.set(k, list);
    }
  };
}

/**
 * What the change did to the code it started from: functions removed that surviving callers still call (the shape of a
 * rename that missed a caller), functions whose argument counts changed, and public API removed. Needs the base commit,
 * which it unpacks and indexes; any failure just means no comparison.
 */
async function compareWithBase(root: string, range: string, head: CodeGraph, unresolved: Map<string, Map<string, number>>, sites: Map<string, CallSite[]>): Promise<BaseComparison> {
  const none: BaseComparison = { dangling: [], signatures: [], removedApi: [] };
  try {
    const threeDot = range.includes('...');
    const [left, right] = range.split(threeDot ? '...' : '..');
    let rev = left || 'HEAD';
    if (threeDot) rev = (await exec('git', ['merge-base', rev, right || 'HEAD'], { cwd: root })).stdout.trim();
    if (!/^[0-9A-Za-z][\w./~^@-]*$/.test(rev)) return none;
    const dir = await fs.mkdtemp(join(tmpdir(), 'codegraph-base-'));
    try {
      await exec('sh', ['-c', 'git archive "$REV" | tar -x -C "$DIR"'], { cwd: root, env: { ...process.env, REV: rev, DIR: dir }, maxBuffer: 64 * 1024 * 1024 });
      const baseUnresolved = new Map<string, Map<string, number>>();
      const base = await indexRepo(dir, { trace: collectCalls(baseUnresolved) });
      const found: BaseComparison = {
        dangling: removedButStillCalled(base.graph, head, unresolved, baseUnresolved),
        signatures: changedSignatures(base.graph, head, sites),
        removedApi: removedPublicApi(base.graph, head),
        baseSymbols: new Set(base.graph.nodes(['function', 'method', 'class']).map((n) => `${n.file}#${n.qualifiedName}`)),
        baseNames: new Set(base.graph.nodes(['function', 'method', 'class']).map((n) => `${n.kind}:${n.qualifiedName ?? n.name}`)),
      };
      console.error(`${color.dim}compared with the base commit ${rev.slice(0, 10)}: ${base.stats.files} files, ${found.dangling.length} removed call${found.dangling.length === 1 ? '' : 's'} still used, ${found.signatures.length} changed signature${found.signatures.length === 1 ? '' : 's'}${color.off}`);
      return found;
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`${color.dim}could not compare with the base commit: ${(e as Error).message.split('\n')[0]}${color.off}`);
    return none;
  }
}

export async function cmdImpact(pos: string[], flags: Flags) {
  const repo = typeof flags.repo === 'string' ? flags.repo : '.';
  // A pull request comment also compares with the base commit, so it needs every call site the new version could not resolve.
  const compare = !!flags.diff && flags.format === 'markdown' && typeof flags.graph !== 'string' && flags['no-compare'] !== true;
  const unresolved = new Map<string, Map<string, number>>();
  const sites = new Map<string, CallSite[]>();
  const { graph, root } = await load(
    repo,
    flags,
    compare ? collectCalls(unresolved, sites) : undefined,
  );
  let comparison: BaseComparison | undefined;
  let seeds: string[] = [];
  let diffInfo: { changedFiles: Set<string>; created: number; createdPublic: string[]; deletedFiles: string[] } | undefined;
  if (flags.diff) {
    const range = [typeof flags.range === 'string' ? flags.range : 'HEAD'];
    const { stdout } = await exec('git', ['diff', '-U0', ...range], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const changes = parseUnifiedDiff(stdout);
    const changed = changedNodes(graph, changes);
    let { nodes, created } = changed;
    const { unmapped } = changed;
    diffInfo = { changedFiles: new Set(changes.filter((c) => !c.deleted).map((c) => c.file)), created: created.length, createdPublic: created.filter((n) => n.exported && !n.name.startsWith('_') && !isTestPath(n.file ?? '')).map((n) => `${n.file}#${n.qualifiedName}`), deletedFiles: changes.filter((c) => c.deleted).map((c) => c.file) };
    if (unmapped.length) console.error(`${color.dim}not in graph (non-source or new): ${unmapped.slice(0, 8).join(', ')}${color.off}`);
    if (compare) comparison = await compareWithBase(root, typeof flags.range === 'string' ? flags.range : 'HEAD', graph, unresolved, sites);
    if (comparison?.baseSymbols) {
      // A hunk that edits one function and adds another looks like a single edit; the base commit says which symbols are new.
      const isFresh = (n: GraphNode) => ['function', 'method', 'class'].includes(n.kind) && !comparison!.baseSymbols!.has(`${n.file}#${n.qualifiedName}`);
      created = [...created, ...nodes.filter(isFresh)];
      nodes = nodes.filter((n) => !isFresh(n));
    }
    seeds = nodes.map((n) => n.id);
    // A function that only moved to another file is not new public API.
    const wasThere = (n: GraphNode) => !!comparison?.baseNames?.has(`${n.kind}:${n.qualifiedName ?? n.name}`);
    diffInfo = { ...diffInfo!, created: created.length, createdPublic: created.filter((n) => n.exported && !n.name.startsWith('_') && !isTestPath(n.file ?? '') && !wasThere(n)).map((n) => `${n.file}#${n.qualifiedName}`) };
    const anyFinding = !!comparison && (comparison.dangling.length > 0 || comparison.signatures.length > 0 || comparison.removedApi.length > 0);
    if (!seeds.length && !(flags.format === 'markdown' && (created.length || anyFinding || diffInfo.deletedFiles.length))) {
      return console.log(flags.format === 'markdown' ? '' : 'No changed source symbols found in diff.');
    }
  } else {
    if (!pos[0]) throw new Error('usage: codegraph impact <target> | --diff [range]');
    const found = resolveTargets(graph, pos[0]);
    if (!found.length) throw new Error(`No symbol or file matches "${pos[0]}"`);
    if (found.length > 1) console.error(`${color.dim}${found.length} matches, analyzing all:${color.off}\n${found.slice(0, 8).map((n) => '  ' + label(graph, n.id)).join('\n')}`);
    seeds = found.map((n) => n.id);
  }
  const res = blastRadius(graph, seeds, {
    maxDepth: flags.depth ? Number(flags.depth) : undefined,
    minConfidence: minConf(flags),
    expandFiles: !flags.diff,
  });
  if (flags.format === 'markdown') {
    console.log(impactMarkdown(graph, res, { ...diffInfo, comparison, jsRunner: await jsRunner(root) }));
    return;
  }
  if (flags.json) {
    console.log(JSON.stringify({ summary: summarizeImpact(graph, res), impacted: res.impacted.map((i) => ({ ...i, label: label(graph, i.id) })), files: res.files, tests: res.tests, testsTransitive: res.testsTransitive }, null, 2));
    return;
  }
  const sum = summarizeImpact(graph, res);
  console.log(`${color.bold}Changed${color.off}  ${sum.changed.slice(0, 6).join(', ')}${sum.changed.length > 6 ? ` (+${sum.changed.length - 6})` : ''}`);
  console.log(
    `${color.bold}Impact${color.off}   ${sum.impactedSymbols} symbols in ${sum.files} files  ` +
      `(${color.green}${sum.byConfidence.resolved} resolved${color.off} · ${color.yellow}${sum.byConfidence.probable} probable${color.off} · ${color.red}${sum.byConfidence.ambiguous} ambiguous${color.off})`,
  );
  const limit = flags.limit ? Number(flags.limit) : 40;
  for (const i of res.impacted.slice(0, limit)) {
    console.log(`  d${i.depth}  ${confColor(i.confidence)}${i.confidence.padEnd(9)}${color.off} ${label(graph, i.id)}`);
  }
  if (res.impacted.length > limit) console.log(`  ${color.dim}... ${res.impacted.length - limit} more (use --limit)${color.off}`);
  if (res.files.length) {
    console.log(`${color.bold}Files${color.off}`);
    for (const f of res.files.slice(0, limit)) console.log(`  d${f.depth}  ${f.path}`);
  }
  if (res.tests.length) {
    console.log(`${color.bold}Tests likely affected${color.off}`);
    for (const t of res.tests.slice(0, limit)) console.log(`  ${t}`);
    if (res.tests.length > limit) console.log(`  ${color.dim}... ${res.tests.length - limit} more${color.off}`);
  }
  if (res.testsTransitive.length) console.log(`${color.dim}+ ${res.testsTransitive.length} more test files reach this only through 2-3 import hops${color.off}`);
}

export async function cmdSlice(pos: string[], flags: Flags) {
  const repo = typeof flags.repo === 'string' ? flags.repo : '.';
  const { graph, root } = await load(repo, flags);
  if (!pos[0]) throw new Error('usage: codegraph slice <target> [--callers N] [--callees N] [--print]');
  const found = resolveTargets(graph, pos[0]);
  if (!found.length) throw new Error(`No symbol or file matches "${pos[0]}"`);
  const res = slice(graph, found.map((n) => n.id), {
    callersDepth: flags.callers !== undefined ? Number(flags.callers) : undefined,
    calleesDepth: flags.callees !== undefined ? Number(flags.callees) : undefined,
    minConfidence: minConf(flags),
  });
  if (flags.json) {
    console.log(JSON.stringify(res.graph.toJSON()));
    return;
  }
  const counts = { seed: 0, caller: 0, callee: 0 };
  for (const r of res.roles.values()) counts[r]++;
  console.log(`${color.bold}Slice${color.off}  ${counts.seed} target · ${counts.caller} callers · ${counts.callee} callees · ${res.ranges.size} files`);
  for (const [file, ranges] of res.ranges) {
    const lines = ranges.reduce((n, r) => n + r[1] - r[0] + 1, 0);
    console.log(`  ${file}  ${color.dim}${ranges.map((r) => `${r[0]}-${r[1]}`).join(', ')} (${lines} lines)${color.off}`);
  }
  if (flags.print) {
    for (const [file, ranges] of res.ranges) {
      const text = (await fs.readFile(join(root, file), 'utf8')).split('\n');
      console.log(`\n${color.bold}// ${file}${color.off}`);
      for (const [a, b] of ranges) {
        console.log(text.slice(a - 1, b).join('\n'));
        console.log(`${color.dim}// ...${color.off}`);
      }
    }
  }
}

export async function cmdVars(pos: string[], flags: Flags) {
  const repo = typeof flags.repo === 'string' ? flags.repo : '.';
  const { graph } = await load(repo, flags);
  if (!pos[0]) throw new Error('usage: codegraph vars <function> | <function#var> | <file:line>');
  const found = resolveTargets(graph, pos[0]);
  if (!found.length) throw new Error(`No function or variable matches "${pos[0]}"`);

  for (const n of found) {
    if (n.kind !== 'variable') {
      const vars = graph
        .outgoing(n.id, ['defines'])
        .map((e) => graph.node(e.to))
        .filter((v): v is NonNullable<typeof v> => v?.kind === 'variable')
        .sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
      if (!vars.length) {
        console.log(`${label(graph, n.id)} — no tracked local variables.`);
        continue;
      }
      console.log(`${color.bold}${label(graph, n.id)}${color.off}  ${vars.length} local variable(s)`);
      for (const v of vars) console.log(`  ${v.name.padEnd(16)} line ${v.startLine}${v.startLine !== v.endLine ? '-' + v.endLine : ''}`);
      console.log(`  ${color.dim}codegraph vars "${vars[0].qualifiedName}" to trace one${color.off}`);
      continue;
    }
    const res = variableLineage(graph, n.id, { maxDepth: flags.depth ? Number(flags.depth) : undefined });
    console.log(`${color.bold}${label(graph, n.id)}${color.off}`);
    if (res.upstream.length) {
      console.log(`  ${color.dim}sources (what fed this variable)${color.off}`);
      for (const u of res.upstream) console.log(`    d${u.depth}  ${graph.node(u.id)!.name}`);
    } else {
      console.log(`  ${color.dim}no tracked upstream sources (parameter, literal, or reads something not tracked yet)${color.off}`);
    }
    if (res.downstream.length) {
      console.log(`  ${color.dim}flows into${color.off}`);
      for (const d of res.downstream) console.log(`    d${d.depth}  ${graph.node(d.id)!.name}`);
    } else {
      console.log(`  ${color.dim}does not flow into another tracked local variable${color.off}`);
    }
  }
}

export async function cmdCycles(pos: string[], flags: Flags) {
  const { graph } = await load(pos[0] ?? '.', flags);
  const cycles = importCycles(graph);
  if (!cycles.length) return console.log('No import cycles found.');
  console.log(`${color.bold}${cycles.length} import cycle group(s)${color.off}`);
  for (const c of cycles.slice(0, 20)) console.log(`  (${c.length} files) ${c.join(' <-> ')}`);
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

export async function cmdServe(pos: string[], flags: Flags) {
  const { graph } = await load(pos[0] ?? '.', flags);
  const json = JSON.stringify(graph.toJSON());
  // Dev/monorepo layout: packages/cli/src/commands.ts -> ../../web/dist.
  // Published-package layout: dist/bin.js -> ./web (copied there by the build script).
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = [resolve(here, '../../web/dist'), resolve(here, 'web')].find((p) => existsSync(p)) ?? resolve(here, '../../web/dist');
  const port = flags.port ? Number(flags.port) : process.env.PORT ? Number(process.env.PORT) : 4173;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (url.pathname === '/api/graph') {
      res.setHeader('content-type', 'application/json');
      res.end(json);
      return;
    }
    let file = join(webDist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(webDist) || !existsSync(file)) file = join(webDist, 'index.html');
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end('Web UI is not built. Run `npm run build:web` or use `npm run dev:web` (Vite proxies /api to this server).');
      return;
    }
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    if (basename(file) === 'index.html') {
      // Tell the page a graph is waiting at /api/graph; a static host has none, and the page shouldn't probe for one.
      res.end(readFileSync(file, 'utf8').replace('<head>', '<head><script>window.__CODEGRAPH_SERVED__=true</script>'));
      return;
    }
    createReadStream(file).pipe(res);
  });
  server.listen(port, () => console.log(`CodeGraph serving ${graph.size.nodes} nodes / ${graph.size.edges} edges at http://localhost:${port}`));
}
