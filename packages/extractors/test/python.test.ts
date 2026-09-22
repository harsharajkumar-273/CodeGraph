import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexFiles, indexRepo } from '../src';
import { conf, edge, fixture } from './helpers';

let g: CodeGraph;
beforeAll(async () => {
  g = (await indexRepo(fixture('py-basic'))).graph;
});

describe('Python extraction', () => {
  it('resolves relative and absolute imports, including package __init__', () => {
    expect(edge(g, 'imports', 'pkg/__init__.py', 'pkg/core.py')).toBeTruthy();
    expect(edge(g, 'imports', 'pkg/core.py', 'pkg/utils.py')).toBeTruthy();
    expect(edge(g, 'imports', 'app.py', 'pkg/__init__.py')).toBeTruthy();
    expect(edge(g, 'imports', 'app.py', 'pkg/utils.py')).toBeTruthy();
    expect(edge(g, 'imports', 'tests/test_app.py', 'app.py')).toBeTruthy();
  });

  it('follows `from pkg import Engine` through __init__ re-exports', () => {
    expect(conf(g, 'calls', 'app.py#main', 'pkg/core.py#Engine')).toBe('resolved');
  });

  it('resolves module-alias calls', () => {
    expect(conf(g, 'calls', 'app.py#main', 'pkg/utils.py#helper')).toBe('resolved');
  });

  it('resolves self.method(), including inherited methods', () => {
    expect(conf(g, 'calls', 'pkg/core.py#Engine.start', 'pkg/core.py#Engine._spin')).toBe('resolved');
    expect(conf(g, 'calls', 'pkg/core.py#Engine.start', 'pkg/core.py#Base.warm')).toBe('resolved');
  });

  it('uses assignment types: e = Engine(); e.start()', () => {
    expect(conf(g, 'calls', 'app.py#main', 'pkg/core.py#Engine.start')).toBe('resolved');
  });

  it('resolves imported helper called from a method', () => {
    expect(conf(g, 'calls', 'pkg/core.py#Engine.start', 'pkg/utils.py#helper')).toBe('resolved');
  });

  it('records module-level calls under the file node', () => {
    expect(conf(g, 'calls', 'app.py', 'app.py#main')).toBe('resolved');
  });

  it('does not let a nested same-named package shadow the standard library (pkg/json/provider.py: `import json`)', () => {
    // Before the fix, every ancestor directory of the importing file was treated as an
    // implicit search root, so `import json` inside pkg/json/provider.py resolved to the
    // sibling package pkg/json/__init__.py instead of the stdlib `json` module.
    expect(edge(g, 'imports', 'pkg/json/provider.py', 'ext:json')).toBeTruthy();
    expect(edge(g, 'imports', 'pkg/json/provider.py', 'pkg/json/__init__.py')).toBeFalsy();
  });

  it('downgrades name-only matches on builtin dict/dunder method names to ambiguous', async () => {
    const { graph } = await indexFiles({
      'store.py': [
        'class Store:',
        '    def setdefault(self, k, v):',
        '        return v',
        '',
        'def use(x):',
        "    return x.setdefault('a', 1)",
      ].join('\n'),
    });
    // `x`'s type is unknown, so this is a bare-name match against Store.setdefault — but
    // `setdefault` is a builtin dict method too common to trust a name-only match on.
    expect(conf(graph, 'calls', 'store.py#use', 'store.py#Store.setdefault')).toBe('ambiguous');
  });
});
