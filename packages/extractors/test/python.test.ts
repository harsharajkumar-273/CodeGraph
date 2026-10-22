import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexFiles, indexRepo } from '../src';
import { conf, edge, fixture, label } from './helpers';

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

  it('does not resolve super().method() to an unrelated same-file class when the base chain has no match', async () => {
    const { graph } = await indexFiles({
      'classes.py': [
        'class Other:',
        '    def __init__(self):',
        '        self.x = 1',
        '',
        'class Base:',
        '    pass',
        '',
        'class Derived(Base):',
        '    def __init__(self):',
        '        super().__init__()',
      ].join('\n'),
    });
    // Base (Derived's only resolved base) defines no __init__, so super().__init__() has no
    // real target. Before the fix, this fell back to an unconstrained same-file name search
    // and matched the unrelated Other.__init__ instead of producing no edge at all.
    expect(edge(graph, 'calls', 'classes.py#Derived.__init__', 'classes.py#Other.__init__')).toBeFalsy();
    expect(graph.edges('calls').filter((e) => label(graph, e.from) === 'classes.py#Derived.__init__')).toHaveLength(0);
  });

  it('uses a function-local import only inside that function', async () => {
    const { graph } = await indexFiles({
      'a.py': 'class Alpha:\n    pass\n',
      'b.py': 'class Beta:\n    pass\n',
      'use.py': [
        'def one():',
        '    from a import Alpha as cls',
        '    return cls()',
        '',
        'def two():',
        '    from b import Beta as cls',
        '    return cls()',
        '',
        'def three():',
        '    from a import Alpha',
        '    return Alpha.make()',
      ].join('\n'),
    });
    // Both functions import a different class under the same local name; each call must follow its own import.
    expect(conf(graph, 'calls', 'use.py#one', 'a.py#Alpha')).toBe('resolved');
    expect(conf(graph, 'calls', 'use.py#two', 'b.py#Beta')).toBe('resolved');
    expect(edge(graph, 'calls', 'use.py#one', 'b.py#Beta')).toBeFalsy();
    expect(edge(graph, 'calls', 'use.py#two', 'a.py#Alpha')).toBeFalsy();
  });

  it('does not leak a function-local import to other functions', async () => {
    const { graph } = await indexFiles({
      'a.py': 'def helper():\n    pass\n',
      'use.py': ['def one():', '    from a import helper', '    helper()', '', 'def two():', '    helper()'].join('\n'),
    });
    expect(conf(graph, 'calls', 'use.py#one', 'a.py#helper')).toBe('resolved');
    expect(conf(graph, 'calls', 'use.py#two', 'a.py#helper')).not.toBe('resolved');
  });

  it('lets a function-local import shadow a function of the same name', async () => {
    const { graph } = await indexFiles({
      'impl.py': 'def probe():\n    pass\n',
      'use.py': ['def probe():', '    from impl import probe', '    return probe()'].join('\n'),
    });
    expect(conf(graph, 'calls', 'use.py#probe', 'impl.py#probe')).toBe('resolved');
    expect(edge(graph, 'calls', 'use.py#probe', 'use.py#probe')).toBeFalsy();
  });
});
