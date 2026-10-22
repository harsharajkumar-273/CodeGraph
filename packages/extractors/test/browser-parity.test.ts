import { promises as fs } from 'node:fs';
import { posix as nodePosix, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexRepo } from '../src';
import { createFilter, indexFiles } from '../src/browser';
import * as posix from '../src/posix';
import { fixture } from './helpers';

/** What a browser loader does: apply the shared filter to a listing and read the surviving files into memory. */
async function loadLikeABrowser(root: string) {
  const read = (rel: string) => fs.readFile(join(root, rel), 'utf8').catch(() => undefined);
  const filter = createFilter({ gitignore: await read('.gitignore'), codegraphignore: await read('.codegraphignore') });
  const files = new Map<string, string>();
  const configs = new Map<string, string>();
  async function rec(rel: string) {
    for (const e of await fs.readdir(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!filter.ignoresDir(path)) await rec(path);
      } else if (!filter.ignoresFile(path)) {
        if (filter.isConfig(e.name)) configs.set(path, (await read(path))!);
        if (filter.isSource(e.name)) files.set(path, (await read(path))!);
      }
    }
  }
  await rec('');
  return { files, configs };
}

const strip = (g: { toJSON(): { nodes: unknown[]; edges: unknown[] } }) => {
  const { nodes, edges } = g.toJSON();
  return { nodes, edges };
};

describe('browser path parity', () => {
  it('posix helpers behave like node:path.posix', () => {
    const inputs = ['', '.', '..', '../', 'a', 'a/', 'a/b', 'a//b', './a', 'a/./b', 'a/../b', 'a/../..', '../a/b/..', '/', '//', '/a', '/a/b/', '/..', '/a/../..', 'a/b/c/../../..', '../../x', 'src/index.ts', 'src/', '...', 'a/.../b'];
    for (const a of inputs) {
      expect(posix.normalize(a), `normalize(${JSON.stringify(a)})`).toBe(nodePosix.normalize(a));
      expect(posix.dirname(a), `dirname(${JSON.stringify(a)})`).toBe(nodePosix.dirname(a));
      expect(posix.basename(a), `basename(${JSON.stringify(a)})`).toBe(nodePosix.basename(a));
      for (const b of inputs) expect(posix.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`).toBe(nodePosix.join(a, b));
    }
  });

  it('the shared filter skips dependencies, build output and declaration files, and honours .gitignore', () => {
    const f = createFilter({ gitignore: 'generated/\n*.snap\n' });
    expect(f.ignoresDir('node_modules')).toBe(true);
    expect(f.ignoresDir('packages/a/dist')).toBe(true);
    expect(f.ignoresDir('generated')).toBe(true);
    expect(f.ignoresDir('src')).toBe(false);
    expect(f.ignoresFile('types/index.d.ts')).toBe(true);
    expect(f.ignoresFile('vendor.min.js')).toBe(true);
    expect(f.ignoresFile('src/a.ts')).toBe(false);
    expect(f.isSource('a.ts') && f.isSource('a.py') && f.isSource('A.JSX')).toBe(true);
    expect(f.isSource('README.md') || f.isSource('Makefile')).toBe(false);
    expect(f.isConfig('tsconfig.json') && f.isConfig('package.json') && !f.isConfig('data.json')).toBe(true);
  });

  for (const name of ['ts-basic', 'py-basic', 'py-affinity', 'express-proto', 'zod-versions', 'ts-grammar', 'ts-returns']) {
    it(`indexing in-memory files gives the same graph as indexing the disk: ${name}`, async () => {
      const root = fixture(name);
      const disk = await indexRepo(root);
      const { files, configs } = await loadLikeABrowser(root);
      const mem = await indexFiles(files, configs, root);
      expect(files.size).toBeGreaterThan(0);
      expect(strip(mem.graph)).toEqual(strip(disk.graph));
    });
  }
});
