import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexRepo } from '@codegraph/extractors';
import { blastRadius, resolveTargets } from '@codegraph/analysis';
import { fixture } from '../../extractors/test/helpers';
import { buildTools, handle } from '../src/mcp';
import { COMMENT_MARKER, impactMarkdown } from '../src/report';

let graph: CodeGraph;
let tools: ReturnType<typeof buildTools>;
beforeAll(async () => {
  graph = (await indexRepo(fixture('ts-basic'))).graph;
  tools = buildTools(async () => ({ graph, root: fixture('ts-basic') }), () => {});
});

const call = async (name: string, args: object) => {
  const res = (await handle(tools, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as { result: { content: { text: string }[]; isError?: boolean } };
  return res.result;
};

describe('MCP server', () => {
  it('answers initialize and lists its tools', async () => {
    const init = (await handle(tools, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as { result: { protocolVersion: string; capabilities: { tools: object } } };
    expect(init.result.protocolVersion).toBe('2025-03-26');
    expect(init.result.capabilities.tools).toEqual({});
    const list = (await handle(tools, { jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['codegraph_impact', 'codegraph_diff_impact', 'codegraph_find', 'codegraph_callers_callees', 'codegraph_overview']));
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');
  });

  it('does not answer notifications', async () => {
    expect(await handle(tools, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
  });

  it('reports the callers of a changed function', async () => {
    const r = await call('codegraph_impact', { target: 'src/math.ts#add' });
    expect(r.content[0].text).toMatch(/can reach \d+ symbols/);
    expect(r.content[0].text).toContain('resolved');
  });

  it('says so when nothing matches, and rejects unknown tools and methods', async () => {
    expect((await call('codegraph_impact', { target: 'nope.ts#x' })).content[0].text).toMatch(/No symbol or file matches/);
    const bad = (await handle(tools, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } })) as { error: { code: number } };
    expect(bad.error.code).toBe(-32602);
    const unk = (await handle(tools, { jsonrpc: '2.0', id: 4, method: 'resources/list' })) as { error: { code: number } };
    expect(unk.error.code).toBe(-32601);
  });

  it('refuses a git range that could be a flag', async () => {
    expect((await call('codegraph_diff_impact', { range: '--output=/tmp/x' })).content[0].text).toMatch(/Not a valid git range/);
  });

  it('finds symbols by name, most-called first', async () => {
    const r = await call('codegraph_find', { query: 'add' });
    expect(r.content[0].text).toContain('src/math.ts#add');
  });
});

describe('pull request comment', () => {
  it('summarizes the blast radius with confidence and tests', () => {
    const seeds = resolveTargets(graph, 'src/math.ts#add').map((n) => n.id);
    const md = impactMarkdown(graph, blastRadius(graph, seeds, { minConfidence: 'probable' }));
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toMatch(/symbols in \d+ files?/);
    expect(md).toContain('🟢');
    expect(md).toContain('name matches');
  });

  it('handles a change nobody calls', () => {
    const seeds = resolveTargets(graph, 'src/app.ts#main').map((n) => n.id);
    const md = impactMarkdown(graph, blastRadius(graph, seeds, { minConfidence: 'probable' }));
    expect(md).toContain(COMMENT_MARKER);
  });
});
