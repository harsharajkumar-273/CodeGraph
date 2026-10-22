// A small Model Context Protocol server (JSON-RPC over stdio) so AI agents can ask what a change touches.
// Hand-written on purpose: it needs three methods, and this keeps the published package free of an SDK dependency.
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { CodeGraph, Confidence } from '@codegraph/core';
import { indexRepo } from '@codegraph/extractors';
import { blastRadius, changedNodes, parseUnifiedDiff, resolveTargets, summarizeImpact } from '@codegraph/analysis';
import { resolveRepo } from './repo';
import { symbolLabel } from './report';
import type { Flags } from './commands';

const exec = promisify(execFile);
const VERSION = '0.2.0';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<string>;
}

const confidence = (v: unknown): Confidence => (v === 'resolved' || v === 'probable' || v === 'ambiguous' ? v : 'probable');
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const where = (g: CodeGraph, id: string) => {
  const n = g.node(id);
  return n?.startLine ? `${symbolLabel(g, id)} (line ${n.startLine})` : symbolLabel(g, id);
};

export function buildTools(getGraph: () => Promise<{ graph: CodeGraph; root: string }>, reindex: () => void): Tool[] {
  return [
    {
      name: 'codegraph_impact',
      description:
        'What could break if this function, class or file changes? Returns the callers that reach it (with how sure the link is), the files involved and the test files to run. Use before editing shared code.',
      inputSchema: {
        type: 'object',
        required: ['target'],
        properties: {
          target: { type: 'string', description: 'A file (src/a.ts), a symbol (src/a.ts#Foo.bar or Foo.bar) or a line (src/a.ts:42).' },
          depth: { type: 'number', description: 'How many hops to follow (default 4).' },
          min_confidence: { type: 'string', enum: ['resolved', 'probable', 'ambiguous'], description: 'Weakest link to include (default probable).' },
        },
      },
      async run(a) {
        const { graph } = await getGraph();
        const found = resolveTargets(graph, str(a.target));
        if (!found.length) return `No symbol or file matches "${str(a.target)}". Try codegraph_find.`;
        const res = blastRadius(graph, found.map((n) => n.id), { maxDepth: num(a.depth, 4), minConfidence: confidence(a.min_confidence) });
        const s = summarizeImpact(graph, res);
        const lines = [
          `Changing ${s.changed.slice(0, 5).join(', ')}${s.changed.length > 5 ? ` (+${s.changed.length - 5})` : ''} can reach ${s.impactedSymbols} symbols in ${s.files} files ` +
            `(${s.byConfidence.resolved} proven, ${s.byConfidence.probable} probable, ${s.byConfidence.ambiguous} name-match guesses).`,
        ];
        for (const i of res.impacted.slice(0, 30)) lines.push(`  hop ${i.depth} ${i.confidence.padEnd(9)} ${where(graph, i.id)}`);
        if (res.impacted.length > 30) lines.push(`  ...and ${res.impacted.length - 30} more`);
        if (res.tests.length) lines.push('Tests to run:', ...res.tests.slice(0, 20).map((t) => `  ${t}`));
        return lines.join('\n');
      },
    },
    {
      name: 'codegraph_diff_impact',
      description: 'What could the current uncommitted changes (or a git range such as main...HEAD) break? Maps the diff onto symbols and returns the combined blast radius and tests to run.',
      inputSchema: { type: 'object', properties: { range: { type: 'string', description: 'Git diff range. Default: working tree against HEAD.' } } },
      async run(a) {
        const { graph, root } = await getGraph();
        const range = str(a.range) || 'HEAD';
        if (!/^[\w./~^@:-]+(\.\.\.?[\w./~^@:-]+)?$/.test(range)) return `Not a valid git range: ${range}`;
        const { stdout } = await exec('git', ['diff', '-U0', range], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
        const { nodes } = changedNodes(graph, parseUnifiedDiff(stdout));
        if (!nodes.length) return 'No changed source symbols in that diff.';
        const res = blastRadius(graph, nodes.map((n) => n.id), { maxDepth: 4, minConfidence: 'probable', expandFiles: false });
        const s = summarizeImpact(graph, res);
        const lines = [`${nodes.length} changed symbols can reach ${s.impactedSymbols} symbols in ${s.files} files (${s.byConfidence.resolved} proven, ${s.byConfidence.probable} probable).`];
        for (const i of res.impacted.slice(0, 30)) lines.push(`  hop ${i.depth} ${i.confidence.padEnd(9)} ${where(graph, i.id)}`);
        if (res.tests.length) lines.push('Tests to run:', ...res.tests.slice(0, 20).map((t) => `  ${t}`));
        return lines.join('\n');
      },
    },
    {
      name: 'codegraph_find',
      description: 'Find functions, methods and classes by name (substring match), most-called first. Use to get the exact target for the other tools.',
      inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'number' } } },
      async run(a) {
        const { graph } = await getGraph();
        const q = str(a.query).toLowerCase();
        if (!q) return 'Give a name to search for.';
        const hits = graph
          .nodes(['function', 'method', 'class'])
          .filter((n) => (n.qualifiedName ?? n.name).toLowerCase().includes(q))
          .map((n) => ({ n, callers: graph.incoming(n.id, ['calls']).length }))
          .sort((x, y) => y.callers - x.callers || (x.n.qualifiedName ?? x.n.name).length - (y.n.qualifiedName ?? y.n.name).length)
          .slice(0, num(a.limit, 15));
        return hits.length ? hits.map((h) => `${where(graph, h.n.id)}  ${h.n.kind}, ${h.callers} callers`).join('\n') : `Nothing named like "${str(a.query)}".`;
      },
    },
    {
      name: 'codegraph_callers_callees',
      description: 'Who calls this symbol, and what does it call? One hop each way, with how sure each link is.',
      inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string' } } },
      async run(a) {
        const { graph } = await getGraph();
        const found = resolveTargets(graph, str(a.target)).slice(0, 3);
        if (!found.length) return `No symbol or file matches "${str(a.target)}".`;
        const out: string[] = [];
        for (const n of found) {
          out.push(where(graph, n.id));
          const callers = graph.incoming(n.id, ['calls']);
          const callees = graph.outgoing(n.id, ['calls']);
          out.push(`  called by ${callers.length}:`, ...callers.slice(0, 15).map((e) => `    ${e.confidence.padEnd(9)} ${where(graph, e.from)}`));
          out.push(`  calls ${callees.length}:`, ...callees.slice(0, 15).map((e) => `    ${e.confidence.padEnd(9)} ${where(graph, e.to)}`));
        }
        return out.join('\n');
      },
    },
    {
      name: 'codegraph_overview',
      description: 'Size of the indexed repository and the most-called symbols, which are the riskiest to change.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const { graph, root } = await getGraph();
        const top = graph
          .nodes(['function', 'method', 'class'])
          .map((n) => ({ n, c: graph.incoming(n.id, ['calls']).length }))
          .sort((x, y) => y.c - x.c)
          .slice(0, 10);
        return [`${root}: ${graph.size.nodes} nodes, ${graph.size.edges} edges.`, 'Most-called (riskiest to change):', ...top.map((t) => `  ${t.c} callers  ${where(graph, t.n.id)}`)].join('\n');
      },
    },
    {
      name: 'codegraph_reindex',
      description: 'Re-read the repository after files changed on disk. Other tools use the index built at the first call.',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        reindex();
        const { graph } = await getGraph();
        return `Re-indexed: ${graph.size.nodes} nodes, ${graph.size.edges} edges.`;
      },
    },
  ];
}

interface Rpc {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** Handles one JSON-RPC message; returns the response, or undefined for notifications. */
export async function handle(tools: Tool[], msg: Rpc): Promise<object | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (msg.id === undefined) return undefined; // notification (e.g. notifications/initialized)
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codegraph', version: VERSION },
        instructions: 'Call codegraph_impact before changing shared code, and codegraph_diff_impact before committing, to see which callers and tests a change can reach.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(msg.params?.name)}`);
      try {
        const text = await tool.run((msg.params?.arguments as Record<string, unknown>) ?? {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: 'text', text: `error: ${(e as Error).message}` }] });
      }
    }
    default:
      return fail(-32601, `Method not found: ${String(msg.method)}`);
  }
}

export async function cmdMcp(pos: string[], _flags: Flags) {
  const root = await resolveRepo(pos[0] ?? '.');
  let cached: Promise<{ graph: CodeGraph; root: string }> | undefined;
  const getGraph = () =>
    (cached ??= indexRepo(root).then(({ graph, stats }) => {
      console.error(`codegraph: indexed ${stats.files} files, ${stats.symbols} symbols`);
      return { graph, root };
    }));
  const tools = buildTools(getGraph, () => (cached = undefined));
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Rpc;
    try {
      msg = JSON.parse(line) as Rpc;
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      continue;
    }
    const res = await handle(tools, msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  }
}
