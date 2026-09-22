import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexRepo } from '../src';
import { conf, edge, fixture, label } from './helpers';

let g: CodeGraph;
beforeAll(async () => {
  g = (await indexRepo(fixture('ts-basic'))).graph;
});

describe('TypeScript / JavaScript extraction', () => {
  it('finds files and symbols', () => {
    expect(g.nodes('file').map((n) => n.file)).toContain('src/app.ts');
    const names = g.nodes(['function', 'method', 'class']).map((n) => n.qualifiedName);
    expect(names).toEqual(expect.arrayContaining(['add', 'mul', 'UserService', 'UserService.run', 'Repo.get', 'legacy']));
  });

  it('builds the import graph, including barrels and CJS require', () => {
    expect(edge(g, 'imports', 'src/app.ts', 'src/service.ts')).toBeTruthy();
    expect(edge(g, 'imports', 'src/util/index.ts', 'src/util/strings.ts')).toBeTruthy(); // export *
    expect(edge(g, 'imports', 'src/util/index.ts', 'src/math.ts')).toBeTruthy(); // export { } from
    expect(edge(g, 'imports', 'lib/legacy.js', 'src/math.ts')).toBeTruthy(); // require()
    expect(edge(g, 'imports', 'test/app.test.ts', 'src/app.ts')).toBeTruthy();
  });

  it('resolves plain calls in the same file', () => {
    expect(conf(g, 'calls', 'src/math.ts#square', 'src/math.ts#mul')).toBe('resolved');
  });

  it('resolves namespace-import calls', () => {
    expect(conf(g, 'calls', 'src/app.ts#main', 'src/math.ts#square')).toBe('resolved');
  });

  it('follows named calls through barrel re-exports', () => {
    expect(conf(g, 'calls', 'src/app.ts#main', 'src/math.ts#add')).toBe('resolved');
    expect(conf(g, 'calls', 'src/service.ts#UserService.run', 'src/util/strings.ts#shout')).toBe('resolved');
  });

  it('resolves this.method() through inheritance', () => {
    expect(conf(g, 'calls', 'src/service.ts#UserService.run', 'src/service.ts#Base.greet')).toBe('resolved');
    expect(edge(g, 'extends', 'src/service.ts#UserService', 'src/service.ts#Base')).toBeTruthy();
  });

  it('uses declared types: constructor parameter properties and `new` assignments', () => {
    expect(conf(g, 'calls', 'src/service.ts#UserService.find', 'src/repo.ts#Repo.get')).toBe('resolved');
    expect(conf(g, 'calls', 'src/app.ts#main', 'src/service.ts#UserService.run')).toBe('resolved');
  });

  it('resolves constructor calls to the class', () => {
    expect(edge(g, 'calls', 'src/app.ts', 'src/service.ts#UserService')).toBeTruthy(); // module-level `new UserService()`
  });

  it('handles CommonJS exports and module-level calls', () => {
    expect(conf(g, 'calls', 'lib/legacy.js#legacy', 'src/math.ts#add')).toBe('resolved');
    expect(conf(g, 'calls', 'scripts/run.js', 'lib/legacy.js#legacy')).toBe('resolved');
  });

  it('understands prototype and object-method assignment (classic CommonJS style)', () => {
    expect(conf(g, 'calls', 'lib/proto.js#Greeter.hello', 'lib/proto.js#Greeter.name')).toBe('resolved');
    expect(conf(g, 'calls', 'lib/proto.js#app.handle', 'lib/proto.js#helper')).toBe('resolved');
  });

  it('does not invent edges to external libraries', () => {
    const bad = g.edges('calls').filter((e) => label(g, e.to).includes('toUpperCase'));
    expect(bad).toHaveLength(0);
  });
});
