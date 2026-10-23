import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexRepo } from '@codegraph/extractors';
import { blastRadius, resolveTargets } from '@codegraph/analysis';
import { fixture } from '../../extractors/test/helpers';
import { cmdImpact } from '../src/commands';
import { buildTools, handle } from '../src/mcp';
import { COMMENT_MARKER, impactMarkdown, testCommands } from '../src/report';

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

  it('counts only callers outside the files the change edits', () => {
    const seeds = resolveTargets(graph, 'src/math.ts#add').map((n) => n.id);
    const r = blastRadius(graph, seeds, { minConfidence: 'probable' });
    const everyFile = new Set(r.impacted.map((i) => graph.node(i.id)?.file as string).concat('src/math.ts'));
    const md = impactMarkdown(graph, r, { changedFiles: everyFile });
    expect(md).toMatch(/nothing outside the files it edits calls/);
    expect(md).not.toMatch(/\*\*\d+ symbols in/);
  });

  it('says plainly when a change only adds code', () => {
    const empty = blastRadius(graph, [], { minConfidence: 'probable' });
    const md = impactMarkdown(graph, empty, { created: 12 });
    expect(md).toMatch(/only adds new code \(12 new symbols\)/);
  });

  it('notes new symbols and deleted files next to a real change', () => {
    const seeds = resolveTargets(graph, 'src/math.ts#add').map((n) => n.id);
    const md = impactMarkdown(graph, blastRadius(graph, seeds, { minConfidence: 'probable' }), { changedFiles: new Set(['src/math.ts']), created: 3, deletedFiles: ['old.ts'] });
    expect(md).toMatch(/adds 3 new symbols; deletes 1 file/);
  });
});

describe('grouping by edited symbol', () => {
  it('lists callers under the edit that reaches them, most callers first, and marks top-level code', () => {
    const seeds = ['src/math.ts#add', 'src/math.ts#mul'].flatMap((q) => resolveTargets(graph, q).map((n) => n.id));
    const r = blastRadius(graph, seeds, { minConfidence: 'probable' });
    const md = impactMarkdown(graph, r, { changedFiles: new Set(['src/math.ts']) });
    expect(md).toContain('Which edit reaches whom');
    expect(md).toMatch(/- `src\/math\.ts#\w+` is reached by \*\*\d+\*\* in \d+ files?/);
    const counts = [...md.matchAll(/is reached by \*\*(\d+)\*\*/g)].map((m) => Number(m[1]));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('shows the test list only when it adds something beyond the command', () => {
    const seeds = resolveTargets(graph, 'src/math.ts#add').map((n) => n.id);
    const r = blastRadius(graph, seeds, { minConfidence: 'probable' });
    const many = { ...r, tests: Array.from({ length: 12 }, (_, i) => `t/a${i}.test.ts`) };
    const withCmd = impactMarkdown(graph, many, { jsRunner: 'vitest', changedFiles: new Set() });
    expect(withCmd).toContain('npx vitest run');
    expect(withCmd).not.toContain('- `t/a0.test.ts`');
    const noCmd = impactMarkdown(graph, many, { changedFiles: new Set() });
    expect(noCmd).toContain('- `t/a0.test.ts`');
  });
});

describe('wording', () => {
  it('uses singular and plural correctly and keeps the headline the action reads', () => {
    const seeds = resolveTargets(graph, 'src/math.ts#add').map((n) => n.id);
    const r = blastRadius(graph, seeds, { minConfidence: 'probable' });
    const one = { ...r, impacted: r.impacted.slice(0, 1), tests: ['t/a.test.ts'] };
    const md = impactMarkdown(graph, one, { changedFiles: new Set(['src/math.ts']), jsRunner: 'vitest' });
    expect(md).toMatch(/\*\*1 symbol in 1 file\*\*/);
    expect(md).toMatch(/\d+ test files? to run|1 of \d+ test files to run|1 test file to run/);
    expect(md).not.toMatch(/1 symbols|1 files/);
    expect(md).toMatch(/```\n\n- `t\/a\.test\.ts`/); // a blank line between the command and the list
  });
});

describe('test commands', () => {
  it('gives one command per ecosystem, and Go packages rather than files', () => {
    expect(testCommands(['a/x_test.go', 'a/y_test.go', 'b/z_test.go', 'tests/test_a.py', 'web/a.test.ts'], 'vitest')).toEqual([
      'go test ./a ./b',
      'pytest tests/test_a.py',
      'npx vitest run web/a.test.ts',
    ]);
  });

  it('offers no JavaScript command when the runner is unknown', () => {
    expect(testCommands(['web/a.test.ts'])).toEqual([]);
  });
});

describe('comparing a pull request with its base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-rename-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'pipe' });
  const write = (name: string, text: string) => writeFileSync(join(dir, name), text);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function comment(): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await cmdImpact([], { diff: true, range: 'main...HEAD', repo: dir, format: 'markdown' });
      return log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  }

  it('flags a renamed function that one caller still uses, and not the caller that was updated', async () => {
    git('init', '-q', '-b', 'main');
    write('lib.ts', 'export function parseConfig(t: string) { return t; }\nexport function keep() { return 1; }\n');
    write('app.ts', "import { parseConfig, keep } from './lib';\nexport function load(t: string) { return parseConfig(t); }\nexport function other(t: string) { return parseConfig(t); }\nexport function noop() { return keep(); }\n");
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    write('lib.ts', 'export function parseSettings(t: string) { return t; }\nexport function keep() { return 1; }\n');
    write('app.ts', "import { parseSettings, keep } from './lib';\nimport { parseConfig } from './lib';\nexport function load(t: string) { return parseSettings(t); }\nexport function other(t: string) { return parseConfig(t); }\nexport function noop() { return keep(); }\n");
    git('commit', '-qam', 'rename');
    const md = await comment();
    expect(md).toMatch(/1 call to code this change removes is still there/);
    expect(md).toContain('`lib.ts#parseConfig` was removed, but `app.ts#other` still calls `parseConfig`');
    expect(md).not.toContain('app.ts#load');
  });

  it('says nothing about removals once every caller is updated', async () => {
    write('app.ts', "import { parseSettings, keep } from './lib';\nexport function load(t: string) { return parseSettings(t); }\nexport function other(t: string) { return parseSettings(t); }\nexport function noop() { return keep(); }\n");
    git('commit', '-qam', 'fix the missed caller');
    expect(await comment()).not.toMatch(/still there/);
  });
});
