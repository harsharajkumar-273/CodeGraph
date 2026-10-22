import { describe, expect, it } from 'vitest';
import { indexRepo, type CallTrace } from '../src';
import { fixture } from './helpers';

/** Index a fixture and expose the per-call-site verdicts (the graph dedups edges per caller/callee). */
async function sites(name: string) {
  const traces: CallTrace[] = [];
  const { graph } = await indexRepo(fixture(name), { trace: (t) => traces.push(t) });
  const at = (file: string, callee: string, line?: number) =>
    traces.filter((t) => t.file === file && t.call.callee === callee && (line === undefined || t.call.line === line));
  const targets = (file: string, callee: string, line?: number) =>
    at(file, callee, line).flatMap((t) => t.targets.map((x) => `${x.file}#${x.qname}`));
  return { graph, traces, at, targets };
}

describe('Express-style prototype receivers (fixtures/express-proto)', () => {
  it('app.get(...) on a local named `app` is not wired to the unrelated res.get (app.get is defined dynamically)', async () => {
    const { targets, at } = await sites('express-proto');
    expect(at('lib/response.js', 'get', 15)[0].call.receiver).toBe('app');
    expect(targets('lib/response.js', 'get', 15)).toEqual([]);
  });

  it('app.set(...) goes to the application\'s app.set via the receiver name', async () => {
    const { targets } = await sites('express-proto');
    expect(targets('lib/response.js', 'set', 16)).toEqual(['lib/application.js#app.set']);
  });

  it('this.get(...) inside res.json still resolves to res.get (no regression)', async () => {
    const { at } = await sites('express-proto');
    const t = at('lib/response.js', 'get', 17)[0];
    expect(t.targets).toEqual([{ file: 'lib/response.js', qname: 'res.get', confidence: 'resolved' }]);
  });

  it('route.all(...) goes to Route.all, not to the unrelated User.all example', async () => {
    const { targets } = await sites('express-proto');
    expect(targets('lib/layer.js', 'all')).toEqual(['lib/route.js#Route.all']);
    expect(targets('lib/router.js', 'all')).toEqual(['lib/route.js#Route.all']);
  });

  it('a caller with no resolvable imports keeps its lone cross-tree guess (the filter needs evidence of its own tree)', async () => {
    const { at } = await sites('express-proto');
    expect(at('examples/standalone.js', 'handle')[0].targets).toEqual([
      { file: 'lib/application.js', qname: 'app.handle', confidence: 'ambiguous' },
    ]);
  });

  it("require('..') from a subdirectory resolves to the package root's index.js", async () => {
    const { graph } = await sites('express-proto');
    const e = graph.edges('imports').find((x) => x.from === 'file:test/uses-root.js' && x.to === 'file:index.js');
    expect(e).toBeTruthy();
  });

  it("a default export forwarded with `module.exports = require('./x')` resolves to the real function", async () => {
    const { targets } = await sites('express-proto');
    expect(targets('test/uses-fwd.js', 'create')).toEqual(['lib/api.js#createApi']);
  });

  it('the merged graph edge reports the call site that earned its confidence', async () => {
    const { graph } = await sites('express-proto');
    const e = graph.edges('calls').find((x) => x.from.endsWith('res.json') && x.to.endsWith('#res.get'))!;
    expect(e.confidence).toBe('resolved');
    expect(e.line).toBe(17); // this.get(...), not the app.get(...) site on line 15
  });
});

describe('cross-version collisions (fixtures/zod-versions)', () => {
  it('v4 calls whose method is not extractable do not fall through to the v3 implementation', async () => {
    const { targets } = await sites('zod-versions');
    const f = 'src/v4/classic/tests/string.test.ts';
    expect(targets(f, 'parse')).toEqual([]);
    expect(targets(f, 'optional')).toEqual([]);
  });

  it('v4 classic calls resolve to the classic implementation', async () => {
    const { targets } = await sites('zod-versions');
    const f = 'src/v4/classic/tests/string.test.ts';
    expect(targets(f, 'safeParse')).toEqual(['src/v4/classic/schemas.ts#ZodType.safeParse']);
    expect(targets(f, 'trim')).toEqual(['src/v4/classic/schemas.ts#ZodType.trim']);
  });

  it('v4 mini calls resolve only to mini', async () => {
    const { targets } = await sites('zod-versions');
    expect(targets('src/v4/mini/tests/string.test.ts', 'safeParse')).toEqual(['src/v4/mini/schemas.ts#ZodMiniType.safeParse']);
  });

  it('v3 calls still resolve to v3 (no recall lost on the version that really is imported)', async () => {
    const { targets } = await sites('zod-versions');
    expect(targets('src/v3/tests/string.test.ts', 'parse')).toEqual(['src/v3/types.ts#ZodType.parse']);
  });

  it('a test-local monkeypatch (`schema.parse = ...` in a callback) is only visible inside its own file', async () => {
    const { targets } = await sites('zod-versions');
    expect(targets('src/v4/classic/tests/other.test.ts', 'parse')).toEqual([]);
    expect(targets('src/v4/classic/tests/footprint.test.ts', 'parse')).toEqual(['src/v4/classic/tests/footprint.test.ts#schema.parse']);
  });

  it('methods defined on an initializer callback\'s own parameter (`inst.shout = ...`) stay resolvable', async () => {
    const { targets } = await sites('zod-versions');
    expect(targets('src/v4/classic/tests/string.test.ts', 'shout')).toEqual(['src/v4/classic/schemas.ts#inst.shout']);
  });
});

describe('receiver-name affinity must not fire on imported modules (fixtures/py-affinity)', () => {
  it('`shop.make_response()` after `import shop.views` is the module function, never the class Shop\'s method', async () => {
    const { targets } = await sites('py-affinity');
    expect(targets('tests/test_views.py', 'make_response')).toEqual([]);
  });
});

describe('TypeScript grammar (fixtures/ts-grammar)', () => {
  it('a file with unseparated generic call signatures still yields its class and class-field arrow methods', async () => {
    const { graph, targets } = await sites('ts-grammar');
    const names = graph.nodes().filter((n) => n.file === 'context.ts').map((n) => n.qualifiedName);
    expect(names).toEqual(expect.arrayContaining(['Context', 'Context.text', 'Context.render']));
    expect(targets('app.ts', 'text')).toEqual(['context.ts#Context.text']);
    expect(new Set(targets('context.ts', 'render'))).toEqual(new Set(['context.ts#Context.render']));
  });
});

describe('Built-in receivers (fixtures/ts-natives)', () => {
  it('calls on JS globals and on Map/Set-typed receivers are not name-matched to repo methods', async () => {
    const { targets } = await sites('ts-natives');
    expect(targets('app.ts', 'get', 5)).toEqual([]);
    expect(targets('app.ts', 'has', 7)).toEqual([]);
    expect(targets('app.ts', 'parse', 8)).toEqual([]);
    expect(targets('app.ts', 'resolve', 9)).toEqual([]);
    expect(targets('app.ts', 'get', 11)).toEqual(['store.ts#Store.get']);
  });

  it('a global name shadowed by a local variable, and a repo class named like a built-in, still resolve', async () => {
    const { targets } = await sites('ts-natives');
    expect(targets('app.ts', 'parse', 16)).toEqual(['store.ts#Store.parse']);
    expect(targets('web.ts', 'text')).toEqual(['web.ts#Response.text']);
  });

  it('a union type is not read as its last member', async () => {
    const { targets } = await sites('ts-natives');
    expect(targets('app.ts', 'text', 20)).toContain('store.ts#Store.text');
  });
});

describe('Declared return types (fixtures/ts-returns, fixtures/py-returns)', () => {
  it('a variable initialised from a call takes the callee\'s declared (awaited) return type', async () => {
    const { at, targets } = await sites('ts-returns');
    expect(at('app.ts', 'fetchPage')[0].targets).toEqual([{ file: 'client.ts', qname: 'Client.fetchPage', confidence: 'resolved' }]);
    expect(at('app.ts', 'text', 6)[0].targets).toEqual([{ file: 'client.ts', qname: 'Page.text', confidence: 'resolved' }]);
    expect(targets('app.ts', 'text', 8)).toEqual([]); // `Response | Promise<Response>` awaited: a built-in
  });

  it('works for Python `-> T` annotations, including built-ins and string annotations', async () => {
    const { at, targets } = await sites('py-returns');
    expect(at('app.py', 'get', 6)[0].targets).toEqual([{ file: 'client.py', qname: 'Client.get', confidence: 'resolved' }]);
    expect(at('app.py', 'text', 7)[0].targets).toEqual([{ file: 'client.py', qname: 'Page.text', confidence: 'resolved' }]);
    expect(targets('app.py', 'upper', 9)).toEqual([]);
  });

  it('a variable that also has another definition (a parameter reassigned in one branch) is not typed by the call', async () => {
    const { at } = await sites('py-returns');
    expect(at('app.py', 'get', 15)[0].targets.every((t) => t.confidence !== 'resolved')).toBe(true);
  });
});
