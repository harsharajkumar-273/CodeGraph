import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexFiles, indexRepo } from '../src';
import { fixture } from './helpers';

describe('Variable lineage (TypeScript / JavaScript)', () => {
  let g: CodeGraph;
  beforeAll(async () => {
    g = (await indexRepo(fixture('ts-basic'))).graph;
  });

  const vars = () => g.nodes('variable').filter((n) => n.file === 'src/pipeline.ts');
  const flow = (a: string, b: string) =>
    g.edges('flows').find((e) => g.node(e.from)?.qualifiedName === `pipeline.${a}` && g.node(e.to)?.qualifiedName === `pipeline.${b}`);

  it('creates one variable node per local binding, including params, loop vars and catch vars', () => {
    const names = vars().map((v) => v.qualifiedName);
    expect(names).toEqual(expect.arrayContaining(['pipeline.raw', 'pipeline.trimmed', 'pipeline.count', 'pipeline.ch', 'pipeline.err']));
  });

  it('parents variables under their enclosing function via a defines edge', () => {
    const trimmed = vars().find((v) => v.name === 'trimmed')!;
    const fn = g.node('sym:src/pipeline.ts#pipeline')!;
    expect(trimmed.parent).toBe(fn.id);
    expect(g.outgoing(fn.id, ['defines']).some((e) => e.to === trimmed.id)).toBe(true);
  });

  it('tracks a simple def -> use chain (`const trimmed = raw.trim()`)', () => {
    expect(flow('raw', 'trimmed')).toBeTruthy();
  });

  it('tracks reassignment and augmented assignment as flows into the same variable node', () => {
    // `count += 1` then `count += ch.length` inside the loop: count and ch both feed count.
    expect(flow('count', 'count')).toBeTruthy(); // self-loop: count depends on its own prior value
    expect(flow('ch', 'count')).toBeTruthy();
  });

  it('tracks a for-of loop variable as fed by the iterable', () => {
    expect(flow('trimmed', 'ch')).toBeTruthy();
  });

  it('does not create a flows edge for a free variable / function reference', () => {
    // `risky(count)` and `console.log(err)`: risky/console are not local variables.
    const bad = g.edges('flows').filter((e) => g.node(e.from)?.file === 'src/pipeline.ts' && (g.node(e.from)?.name === 'risky' || g.node(e.from)?.name === 'console'));
    expect(bad).toHaveLength(0);
  });

  it('keeps variable scopes local to their own function (no cross-function edges)', () => {
    const risky = g.nodes('variable').filter((v) => v.qualifiedName?.startsWith('risky.'));
    expect(risky.map((v) => v.name)).toEqual(['n']);
    const crossScope = g.edges('flows').some((e) => {
      const from = g.node(e.from)?.qualifiedName;
      const to = g.node(e.to)?.qualifiedName;
      return from?.startsWith('pipeline.') && to?.startsWith('risky.');
    });
    expect(crossScope).toBe(false);
  });
});

describe('Variable lineage (inline JS: assignment / augmented-assignment / try-catch)', () => {
  it('produces the exact def-use graph for a small hand-checked function', async () => {
    const { graph: g } = await indexFiles({
      'a.ts': `
        function f(input: number) {
          const x = input + 1;
          let y = x;
          y += x;
          return y;
        }
      `,
    });
    const q = (n: string) => g.node(`var:a.ts#f.${n}`);
    expect(q('x')).toBeTruthy();
    const edges = g.edges('flows').map((e) => `${g.node(e.from)!.name}->${g.node(e.to)!.name}`).sort();
    // x->y from `let y = x` (and again, deduped, from `y += x`); y->y self-loop from the `+=` carrying y's prior value forward.
    expect(edges).toEqual(['input->x', 'x->y', 'y->y'].sort());
  });
});

describe('Variable lineage (Python)', () => {
  let g: CodeGraph;
  beforeAll(async () => {
    g = (await indexRepo(fixture('py-basic'))).graph;
  });

  const flow = (a: string, b: string) =>
    g.edges('flows').find((e) => g.node(e.from)?.qualifiedName === `transform.${a}` && g.node(e.to)?.qualifiedName === `transform.${b}`);

  it('tracks assignment, augmented assignment and a for loop the same way as TS/JS', () => {
    expect(flow('raw', 'trimmed')).toBeTruthy();
    expect(flow('trimmed', 'total')).toBeTruthy();
    expect(flow('total', 'total')).toBeTruthy();
    expect(flow('ch', 'total')).toBeTruthy();
    expect(flow('trimmed', 'ch')).toBeTruthy();
  });

  it('tracks `self` as a param variable but does not follow attribute reads (self.x)', () => {
    const self = g.node('var:pkg/core.py#Engine.start.self');
    expect(self).toBeTruthy();
    // Engine.start calls self.warm() and self._spin() — attribute reads, not variable flows.
    expect(g.outgoing(self!.id, ['flows'])).toHaveLength(0);
  });
});
