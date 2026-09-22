import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexFiles, indexRepo } from '@codegraph/extractors';
import { blastRadius, changedNodes, importCycles, parseUnifiedDiff, resolveTargets, slice, variableLineage } from '../src';
import { fixture } from '../../extractors/test/helpers';

let g: CodeGraph;
beforeAll(async () => {
  g = (await indexRepo(fixture('ts-basic'))).graph;
});

const ids = (r: { impacted: { id: string }[] }) => r.impacted.map((i) => g.node(i.id)!.qualifiedName ?? g.node(i.id)!.file);

describe('resolveTargets', () => {
  it('accepts file, file#symbol, file:line and bare names', () => {
    expect(resolveTargets(g, 'src/math.ts')[0].kind).toBe('file');
    expect(resolveTargets(g, 'src/math.ts#add')[0].qualifiedName).toBe('add');
    expect(resolveTargets(g, 'src/math.ts:6')[0].qualifiedName).toBe('mul');
    expect(resolveTargets(g, 'UserService.run')).toHaveLength(1);
  });
});

describe('blastRadius', () => {
  it('finds transitive callers with depth and confidence', () => {
    const [mul] = resolveTargets(g, 'src/math.ts#mul');
    const r = blastRadius(g, [mul.id]);
    const byName = new Map(r.impacted.map((i) => [g.node(i.id)!.qualifiedName, i]));
    expect(byName.get('square')?.depth).toBe(1);
    expect(byName.get('main')?.depth).toBe(2);
    expect(byName.get('main')?.confidence).toBe('resolved');
  });

  it('reports affected files and likely tests', () => {
    const [add] = resolveTargets(g, 'src/math.ts#add');
    const r = blastRadius(g, [add.id]);
    expect(r.files.map((f) => f.path)).toEqual(expect.arrayContaining(['src/app.ts', 'lib/legacy.js']));
    expect(r.tests).toContain('test/app.test.ts');
    expect(r.testsTransitive).not.toContain('test/app.test.ts');
    expect(ids(r)).toContain('legacy');
  });

  it('respects depth and confidence limits', () => {
    const [mul] = resolveTargets(g, 'src/math.ts#mul');
    expect(blastRadius(g, [mul.id], { maxDepth: 1 }).impacted).toHaveLength(1);
    const [get] = resolveTargets(g, 'Repo.get');
    expect(blastRadius(g, [get.id], { minConfidence: 'resolved' }).impacted.length).toBeGreaterThan(0);
  });

  it('propagates through inheritance (subclass depends on base)', () => {
    const [base] = resolveTargets(g, 'src/service.ts#Base');
    const r = blastRadius(g, [base.id]);
    expect(ids(r)).toContain('UserService');
  });
});

describe('slice', () => {
  it('returns callers and callees within depth, plus line ranges', () => {
    const [run] = resolveTargets(g, 'UserService.run');
    const s = slice(g, [run.id], { callersDepth: 1, calleesDepth: 1 });
    const names = [...s.roles].map(([id, role]) => `${role}:${g.node(id)!.qualifiedName}`);
    expect(names).toEqual(expect.arrayContaining(['seed:UserService.run', 'caller:main', 'callee:shout', 'callee:Base.greet']));
    expect(s.ranges.get('src/service.ts')?.length).toBeGreaterThan(0);
    expect(s.graph.node('file:src/app.ts')).toBeTruthy();
  });
});

describe('diff mapping', () => {
  it('maps changed line ranges to the innermost symbol', () => {
    const diff = ['--- a/src/math.ts', '+++ b/src/math.ts', '@@ -6,0 +7,1 @@ ', '+  // touch'].join('\n');
    const { nodes } = changedNodes(g, parseUnifiedDiff(diff));
    expect(nodes.map((n) => n.qualifiedName)).toEqual(['mul']);
  });

  it('attributes a module-level variable edit to that variable, not the whole file', () => {
    const diff = ['+++ b/src/app.ts', '@@ -5,0 +6,1 @@'].join('\n'); // `const svc = new UserService(...)`
    const { nodes } = changedNodes(g, parseUnifiedDiff(diff));
    expect(nodes.map((n) => n.kind)).toEqual(['variable']);
    expect(nodes[0].qualifiedName).toBe('svc');
  });

  it('falls back to the file when the line matches no tracked symbol', () => {
    const diff = ['+++ b/src/app.ts', '@@ -0,0 +1,1 @@'].join('\n'); // an import line
    const { nodes } = changedNodes(g, parseUnifiedDiff(diff));
    expect(nodes.map((n) => n.kind)).toEqual(['file']);
  });
});

describe('variableLineage', () => {
  it('traces upstream sources and downstream sinks through a for-of loop and reassignment', async () => {
    const { graph } = await indexFiles({
      'p.ts': `
        function pipeline(raw: string) {
          const trimmed = raw.trim();
          let count = trimmed.length;
          for (const ch of trimmed) {
            count += ch.length;
          }
          return count;
        }
      `,
    });
    const count = resolveTargets(graph, 'pipeline.count')[0];
    const res = variableLineage(graph, count.id);
    const up = res.upstream.map((u) => graph.node(u.id)!.name).sort();
    expect(up).toEqual(['ch', 'raw', 'trimmed'].sort());
    expect(res.downstream).toHaveLength(0); // count is never read into another tracked variable

    const trimmed = resolveTargets(graph, 'pipeline.trimmed')[0];
    const down = variableLineage(graph, trimmed.id).downstream.map((d) => graph.node(d.id)!.name).sort();
    expect(down).toEqual(['ch', 'count'].sort());
  });

  it('reports depth correctly across a longer chain', async () => {
    const { graph } = await indexFiles({ 'c.ts': 'function f(a: number) { const b = a; const c = b; const d = c; return d; }' });
    const a = resolveTargets(graph, 'f.a')[0];
    const res = variableLineage(graph, a.id);
    const byName = new Map(res.downstream.map((d) => [graph.node(d.id)!.name, d.depth]));
    expect(byName.get('b')).toBe(1);
    expect(byName.get('c')).toBe(2);
    expect(byName.get('d')).toBe(3);
  });
});

describe('cycles', () => {
  it('detects import cycles', async () => {
    const { graph } = await indexFiles({
      'a.ts': "import { b } from './b'; export const a = () => b();",
      'b.ts': "import { a } from './a'; export const b = () => a();",
      'c.ts': "import { a } from './a'; export const c = a;",
    });
    expect(importCycles(graph)).toEqual([['a.ts', 'b.ts']]);
  });

  it('does not report a cycle through imports only reachable inside `if TYPE_CHECKING:`', async () => {
    const { graph } = await indexFiles({
      'a.py': [
        'from typing import TYPE_CHECKING',
        'if TYPE_CHECKING:',
        '    from b import Bee',
        'def f(x: "Bee") -> None: ...',
      ].join('\n'),
      'b.py': [
        'from typing import TYPE_CHECKING',
        'if TYPE_CHECKING:',
        '    from a import Aye',
        'def g(x: "Aye") -> None: ...',
      ].join('\n'),
    });
    // Both edges are typeOnly (erased at runtime), so this is not a real cycle by default...
    expect(importCycles(graph)).toEqual([]);
    // ...but the edges are still there, tagged, for anyone who explicitly wants to see them.
    expect(importCycles(graph, { includeTypeOnly: true })).toEqual([['a.py', 'b.py']]);
  });

  it('recognizes `if t.TYPE_CHECKING:` behind an aliased `import typing as t` too (as Flask itself writes it)', async () => {
    const { graph } = await indexFiles({
      'a.py': [
        'import typing as t',
        'if t.TYPE_CHECKING:',
        '    from b import Bee',
        'def f(x: "Bee") -> None: ...',
      ].join('\n'),
      'b.py': [
        'import typing as t',
        'if t.TYPE_CHECKING:',
        '    from a import Aye',
        'def g(x: "Aye") -> None: ...',
      ].join('\n'),
    });
    expect(importCycles(graph)).toEqual([]);
  });
});
