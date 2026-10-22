import { describe, expect, it } from 'vitest';
import { fileId } from '@codegraph/core';
import { indexFiles } from '@codegraph/extractors/browser';
import { buildView, type CgNodeData, type Params } from '../src/model';

const base: Params = { view: 'symbols', mode: 'impact', folderDepth: 2, scope: '', focus: null, minConf: 'ambiguous', radius: 2, showTests: false };

async function graphOf(files: Record<string, string>) {
  return (await indexFiles(files)).graph;
}
const symbol = (g: Awaited<ReturnType<typeof graphOf>>, file: string, q: string) => g.nodes(['function', 'method']).find((n) => n.file === file && n.qualifiedName === q)!.id;
const data = (n: { data: unknown }) => n.data as CgNodeData;

describe('blast radius view', () => {
  const files = {
    'src/core.ts': 'export function core() { return 1 }\n',
    'src/api.ts': "import { core } from './core'\nexport function api() { return core() }\n",
    'test/core.test.ts': "import { core } from '../src/core'\nexport function testA() { core() }\nexport function testB() { core() }\nexport function testC() { core() }\n",
  };

  it('folds test functions into one node per test file, and shows them when asked', async () => {
    const g = await graphOf(files);
    const focus = symbol(g, 'src/core.ts', 'core');
    const folded = buildView(g, { ...base, focus });
    const group = folded.nodes.find((n) => n.id === 'tests:test/core.test.ts')!;
    expect(data(group).title).toBe('core.test.ts');
    expect(data(group).sub).toBe('3 test functions');
    expect(data(group).selectId).toBe(fileId('test/core.test.ts'));
    expect(folded.nodes.some((n) => data(n).title === 'testA()')).toBe(false);
    // three calls into core collapse to one edge from the group
    expect(folded.edges.filter((e) => e.source === 'tests:test/core.test.ts' && e.target === focus)).toHaveLength(1);

    const expanded = buildView(g, { ...base, focus, showTests: true });
    expect(expanded.nodes.map((n) => data(n).title)).toEqual(expect.arrayContaining(['testA()', 'testB()', 'testC()', 'api()']));
    expect(expanded.nodes.some((n) => n.id.startsWith('tests:'))).toBe(false);
  });

  it('puts the changed code first and fans the impact out to the right', async () => {
    const g = await graphOf(files);
    const focus = symbol(g, 'src/core.ts', 'core');
    const vm = buildView(g, { ...base, focus });
    const seed = vm.nodes.find((n) => n.id === focus)!;
    expect(data(seed).tone).toBe('seed');
    expect(data(seed).focused).toBe(true);
    for (const n of vm.nodes.filter((x) => x.id !== focus)) expect(n.position.x).toBeGreaterThan(seed.position.x);
    expect(vm.nodes.every((n) => data(n).rtl)).toBe(true); // handles flip so edges leave the seed's side
  });

  it('folds a very large blast radius into one node per file and says so', async () => {
    const many: Record<string, string> = { 'src/core.ts': 'export function core() { return 1 }\n' };
    for (let i = 0; i < 60; i++) many[`src/user${i}.ts`] = `import { core } from './core'\nexport function use${i}() { return core() }\nexport function also${i}() { return core() }\n`;
    const g = await graphOf(many);
    const vm = buildView(g, { ...base, focus: symbol(g, 'src/core.ts', 'core') });
    expect(vm.nodes.length).toBe(61); // the seed plus one node per calling file, not 120 functions
    expect(vm.nodes.filter((n) => n.id.startsWith('group:'))).toHaveLength(60);
    expect(data(vm.nodes.find((n) => n.id === 'group:src/user7.ts')!).sub).toBe('2 symbols');
    expect(vm.note).toMatch(/folded into one node per file/);
  });

  it('honours the minimum-confidence filter', async () => {
    // two classes define `reconcile`, so the untyped call `x.reconcile()` is only an ambiguous name match
    const g = await graphOf({
      'a.ts': 'export class A { reconcile() {} }\n',
      'b.ts': 'export class B { reconcile() {} }\n',
      'c.ts': 'export function c(x: any) { x.reconcile() }\n',
    });
    const focus = symbol(g, 'a.ts', 'A.reconcile');
    expect(buildView(g, { ...base, focus, minConf: 'ambiguous' }).nodes.length).toBeGreaterThan(1);
    expect(buildView(g, { ...base, focus, minConf: 'probable' }).nodes.length).toBe(1);
  });
});

describe('files view', () => {
  const files: Record<string, string> = {
    'src/hub.ts': 'export const hub = 1\n',
    'src/a.ts': "import { hub } from './hub'\nexport const a = hub\n",
    'src/b.ts': "import { hub } from './hub'\nexport const b = hub\n",
    'src/c.ts': "import { a } from './a'\nimport { b } from './b'\nexport const c = a + b\n",
    'src/out.ts': 'export const out = 1\n',
  };
  files['src/hub.ts'] += "import { out } from './out'\nexport const x = out\n";

  it('shows the whole folder with nothing selected', async () => {
    const g = await graphOf(files);
    const vm = buildView(g, { ...base, view: 'files', scope: 'src' });
    expect(vm.nodes).toHaveLength(5);
    expect(vm.edges.length).toBe(5);
  });

  it('shows only the selected file and its direct neighbours, importers left and imports right, with only its own edges', async () => {
    const g = await graphOf(files);
    const hub = fileId('src/hub.ts');
    const vm = buildView(g, { ...base, view: 'files', scope: 'src', focus: hub });
    const ids = vm.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([fileId('src/a.ts'), fileId('src/b.ts'), hub, fileId('src/out.ts')].sort()); // c.ts only reaches hub through a and b
    const x = (id: string) => vm.nodes.find((n) => n.id === id)!.position.x;
    expect(x(fileId('src/a.ts'))).toBeLessThan(x(hub));
    expect(x(fileId('src/b.ts'))).toBeLessThan(x(hub));
    expect(x(fileId('src/out.ts'))).toBeGreaterThan(x(hub));
    expect(vm.edges.every((e) => e.source === hub || e.target === hub)).toBe(true);
    expect(vm.note).toMatch(/3 files that import it or that it imports/);
  });

  it('ignores external packages when counting neighbours', async () => {
    const g = await graphOf({ 'src/only.ts': "import React from 'react'\nexport const x = React\n", 'src/other.ts': 'export const y = 1\n' });
    const vm = buildView(g, { ...base, view: 'files', scope: 'src', focus: fileId('src/only.ts') });
    expect(vm.nodes).toHaveLength(2); // nothing to narrow to: the whole folder stays
    expect(vm.note).toBeUndefined();
  });
});

describe('folders view', () => {
  it('draws one node per folder with the number of imports between them', async () => {
    const g = await graphOf({
      'app/main.ts': "import { lib } from '../lib/lib'\nimport { util } from '../lib/util'\nexport const m = lib + util\n",
      'lib/lib.ts': 'export const lib = 1\n',
      'lib/util.ts': 'export const util = 1\n',
    });
    const vm = buildView(g, { ...base, view: 'folders', folderDepth: 1 });
    expect(vm.nodes.map((n) => n.id).sort()).toEqual(['folder:app', 'folder:lib']);
    expect(vm.edges).toHaveLength(1);
    expect(vm.edges[0].label).toBe('2');
  });
});
