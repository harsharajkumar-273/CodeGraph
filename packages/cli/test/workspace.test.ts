import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTools, handle } from '../src/mcp';
import { Workspace, safeRel } from '../src/workspace';

let dir: string;
const put = (rel: string, text: string, when?: number) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  if (when) utimesSync(join(dir, rel), when, when);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cg-ws-'));
  put('src/math.ts', 'export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n');
  put('src/app.ts', "import { add, sub } from './math';\nexport function total(x: number) {\n  return add(x, 1) + sub(x, 2);\n}\n");
  put('tests/app.test.ts', "import { total } from '../src/app';\nexport const t = total(1);\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('check_change', () => {
  it('flags a call left behind by a removed function, with the line', async () => {
    const ws = new Workspace(dir, 0);
    const r = await ws.check([{ path: 'src/math.ts', content: 'export function add(a: number, b: number): number {\n  return a + b;\n}\n' }]);
    expect(r.verdict).toBe('breaking');
    expect(r.findings[0]).toMatchObject({ kind: 'removed-but-called' });
    expect(r.findings[0].at).toEqual(['src/app.ts:3']);
    expect(r.text).toContain('BREAKING');
  });

  it('flags calls that no longer pass enough arguments', async () => {
    const ws = new Workspace(dir, 0);
    const r = await ws.check([{ path: 'src/math.ts', content: 'export function add(a: number, b: number, c: number): number {\n  return a + b + c;\n}\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n' }]);
    expect(r.verdict).toBe('breaking');
    expect(r.findings[0].kind).toBe('too-few-arguments');
    expect(r.findings[0].at).toEqual(['src/app.ts:3']);
  });

  it('is quiet about a change nothing outside depends on, and says what an ordinary edit reaches', async () => {
    const ws = new Workspace(dir, 0);
    const none = await ws.check([{ path: 'src/math.ts', content: 'export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\nexport function mul(a: number, b: number): number {\n  return a * b;\n}\n' }]);
    expect(none.verdict).toBe('additive');
    expect(none.findings).toEqual([]);
    const shared = await ws.check([{ path: 'src/math.ts', content: 'export function add(a: number, b: number): number {\n  return b + a;\n}\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n' }]);
    expect(shared.verdict).toBe('shared');
    expect(shared.reaches.map((r) => r.symbol).join(' ')).toContain('total');
    expect(shared.tests).toContain('tests/app.test.ts');
  });

  it('writes nothing to disk, ignores paths outside the repository, and handles deletion', async () => {
    const ws = new Workspace(dir, 0);
    const r = await ws.check([{ path: '../evil.ts', content: 'x' }, { path: 'notes.md', content: 'x' }, { path: 'src/math.ts', content: null }]);
    expect(r.verdict).toBe('breaking');
    expect(r.text).toContain('Ignored');
    const after = await ws.check([{ path: 'src/math.ts', content: null }]);
    expect(after.findings.length).toBeGreaterThan(0);
    expect((await ws.verify(['add'])).startsWith('EXISTS')).toBe(true); // still there on disk
  });

  it('says there is nothing to check for an identical file', async () => {
    const ws = new Workspace(dir, 0);
    const r = await ws.check([{ path: 'src/app.ts', content: "import { add, sub } from './math';\nexport function total(x: number) {\n  return add(x, 1) + sub(x, 2);\n}\n" }]);
    expect(r.verdict).toBe('nothing');
  });

  it('checks Python and Go the same way', async () => {
    put('py/lib.py', 'def helper(a, b):\n    return a + b\n');
    put('py/main.py', 'from lib import helper\n\ndef run():\n    return helper(1, 2)\n');
    const ws = new Workspace(dir, 0);
    const py = await ws.check([{ path: 'py/lib.py', content: 'def helper(a, b, c):\n    return a + b + c\n' }]);
    expect(py.verdict).toBe('breaking');
    put('go/go.mod', 'module example.com/m\n\ngo 1.21\n');
    put('go/a/a.go', 'package a\n\nfunc Hello(n int) int { return n }\n');
    put('go/main.go', 'package main\n\nimport "example.com/m/a"\n\nfunc main() { a.Hello(1) }\n');
    const go = await ws.check([{ path: 'go/a/a.go', content: 'package a\n\nfunc Hello(n int, m int) int { return n + m }\n' }]);
    expect(go.verdict).toBe('breaking');
  });
});

describe('verify_symbol', () => {
  it('returns the real signature, and the closest names for one that does not exist', async () => {
    const ws = new Workspace(dir, 0);
    const out = await ws.verify(['add', 'src/math.ts#sub', 'ad', 'totall']);
    expect(out).toContain('EXISTS function add(a: number, b: number)');
    expect(out).toContain('takes 2 arguments');
    expect(out).toContain('NOT FOUND ad — did you mean: add');
    expect(out).toContain('NOT FOUND totall — did you mean: total');
  });
});

describe('repo_map and freshness', () => {
  it('lists the most-called files first and follows edits on disk', async () => {
    const ws = new Workspace(dir, 0);
    const map = await ws.map();
    expect(map.indexOf('src/math.ts')).toBeLessThan(map.indexOf('src/app.ts'));
    expect(map).not.toContain('tests/app.test.ts');
    expect(await ws.verify(['mul'])).toContain('NOT FOUND');
    put('src/math.ts', 'export function mul(a: number, b: number): number {\n  return a * b;\n}\n', Date.now() / 1000 + 5);
    expect(await ws.verify(['mul'])).toContain('EXISTS function mul');
  });

  it('keeps the index while nothing changed', async () => {
    const ws = new Workspace(dir, 0);
    const a = await ws.current();
    expect(await ws.current()).toBe(a);
  });
});

describe('over MCP', () => {
  it('lists the agent tools and answers a check_change call', async () => {
    const tools = buildTools(new Workspace(dir, 0));
    const list = (await handle(tools, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['codegraph_check_change', 'codegraph_verify_symbol', 'codegraph_repo_map']));
    const res = (await handle(tools, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'codegraph_check_change', arguments: { files: [{ path: 'src/math.ts', content: 'export function sub(a: number, b: number): number {\n  return a - b;\n}\n' }] } },
    })) as { result: { content: { text: string }[] } };
    expect(res.result.content[0].text).toContain('BREAKING');
  });
});

describe('safeRel', () => {
  it('rejects anything that could leave the repository', () => {
    for (const p of ['/etc/passwd', '../x.ts', 'a/../../x.ts', 'C:\\x.ts', '']) expect(safeRel(p)).toBeUndefined();
    expect(safeRel('./src/a.ts')).toBe('src/a.ts');
  });
});
