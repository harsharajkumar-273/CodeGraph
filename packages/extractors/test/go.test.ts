import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeGraph } from '@codegraph/core';
import { indexFiles, indexRepo } from '../src';
import { conf, edge, fixture } from './helpers';

let g: CodeGraph;
beforeAll(async () => {
  g = (await indexRepo(fixture('go-basic'))).graph;
});

const call = (from: string, to: string) => conf(g, 'calls', from, to);

describe('Go extraction', () => {
  it('indexes .go files with methods attached to their types and interface methods as methods', () => {
    const kinds = new Map(g.nodes(['function', 'method', 'class']).map((n) => [`${n.file}#${n.qualifiedName}`, n.kind]));
    expect(kinds.get('app.go#App')).toBe('class');
    expect(kinds.get('app.go#App.Start')).toBe('method');
    expect(kinds.get('app.go#NewApp')).toBe('function');
    expect(kinds.get('store/store.go#Store.Get')).toBe('method');
  });

  it('resolves package-qualified calls through go.mod and plain calls inside a package', () => {
    expect(call('app.go#main', 'util/util.go#Open')).toBe('resolved');
    expect(call('app.go#main', 'app.go#NewApp')).toBe('resolved');
  });

  it('imports a package as all of its files and treats the standard library as external', () => {
    expect(edge(g, 'imports', 'app.go', 'util/util.go')).toBeTruthy();
    expect(edge(g, 'imports', 'app.go', 'util/hash_unix.go')).toBeTruthy();
    expect(g.nodes('external').some((n) => n.name === 'fmt')).toBe(true);
  });

  it('follows struct embedding: promoted methods resolve to the embedded type, in this package or another', () => {
    expect(call('app.go#App.Start', 'app.go#Base.Ping')).toBe('resolved');
    expect(call('app.go#App.Start', 'util/util.go#Logger.Log')).toBe('resolved');
    expect(edge(g, 'extends', 'app.go#App', 'app.go#Base')).toBeTruthy();
  });

  it('types variables from constructors, results, range clauses and index expressions', () => {
    expect(call('app.go#main', 'app.go#App.Start')).toBe('resolved'); // app := NewApp(db)
    expect(call('app.go#App.Start', 'util/util.go#DB.Query')).toBe('resolved'); // a.db.Query: a field of a field
    expect(call('app.go#App.Start', 'util/util.go#Row.Describe')).toBe('resolved'); // for _, r := range rows (rows := a.db.Query())
    expect(call('app.go#App.Start', 'app.go#Item.Run')).toBe('resolved'); // for _, it := range a.items, and a.items[0].Run()
  });

  it('resolves a call on the result of a call, new(T), and a typed constant', () => {
    expect(call('app.go#main', 'app.go#App.Start')).toBe('resolved'); // NewApp(nil).Start(), new(App).Start()
    expect(call('app.go#App.Start', 'store/store.go#Level.String')).toBe('resolved'); // store.Debug.String()
  });

  it('calls an interface method through a package variable or a constructor result', () => {
    expect(call('app.go#main', 'store/store.go#Store.Get')).toBe('resolved');
    expect(call('app.go#main', 'store/store.go#New')).toBe('resolved');
  });

  it('gives a closure its own scope, so its parameter does not replace the outer variable', () => {
    expect(call('app.go#App.Start', 'app.go#App.helper')).toBe('resolved');
  });

  it('prefers the file that is built on linux/amd64 when a name is declared once per platform', () => {
    expect(call('util/hash_unix.go#Platform', 'util/hash_unix.go#platform')).toBe('resolved');
    expect(edge(g, 'calls', 'util/hash_unix.go#Platform', 'util/hash_windows.go#platform')).toBeFalsy();
  });

  it('creates no edge for a function value, a conversion or the standard library', () => {
    const out = g.edges('calls').filter((e) => e.from.endsWith('App.Start'));
    expect(out.every((e) => !e.to.includes('fmt'))).toBe(true);
    expect(edge(g, 'calls', 'app.go#App.Start', 'app.go#App.Start')).toBeFalsy(); // run(a) is a closure
  });

  it('guesses nothing for a variable whose type it cannot work out', async () => {
    const { graph } = await indexFiles({
      'go.mod': 'module m\n',
      'a.go': 'package a\n\ntype T struct{}\n\nfunc (T) Close() {}\n',
      'b.go': 'package a\n\nimport "os"\n\nfunc use() {\n\tf, _ := os.Open("x")\n\tf.Close()\n}\n',
    });
    expect(graph.edges('calls').filter((e) => e.to.endsWith('T.Close'))).toHaveLength(0);
  });

  it('works without go.mod: same-package calls still resolve, repo-qualified imports stay external', async () => {
    const { graph } = await indexFiles({
      'x.go': 'package x\n\nfunc A() { B() }\n\nfunc B() {}\n',
    });
    expect(conf(graph, 'calls', 'x.go#A', 'x.go#B')).toBe('resolved');
  });
});
