import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexFiles } from '@codegraph/extractors/browser';
import { indexRepo } from '@codegraph/extractors';
import { loadGithub, selectFiles, type TreeEntry } from '../src/sources/github';
import { entriesFromFileList, loadFolder } from '../src/sources/local';
import { parseRepoInput } from '../src/sources/parse-repo';
import { LIMITS, LoadError } from '../src/sources/types';

const fixture = (name: string) => resolve(fileURLToPath(new URL('../../../fixtures/' + name, import.meta.url)));

/** A fake GitHub: the tree API and raw.githubusercontent.com, served from an in-memory repo. */
function fakeGithub(repo: Map<string, string>, opts: { branch?: string; repoStatus?: number; treeHeaders?: Record<string, string>; treeStatus?: number } = {}) {
  const branch = opts.branch ?? 'main';
  const calls: string[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://api.github.com/repos/o/r') {
      return opts.repoStatus ? json({ message: 'x' }, opts.repoStatus, opts.treeHeaders) : json({ default_branch: branch });
    }
    if (url.startsWith(`https://api.github.com/repos/o/r/git/trees/`)) {
      if (opts.treeStatus) return json({ message: 'x' }, opts.treeStatus, opts.treeHeaders);
      const tree: TreeEntry[] = [...repo].map(([path, text]) => ({ path, type: 'blob', size: text.length }));
      return json({ tree, truncated: false });
    }
    const raw = `https://raw.githubusercontent.com/o/r/${branch}/`;
    if (url.startsWith(raw)) {
      const path = decodeURIComponent(url.slice(raw.length));
      return repo.has(path) ? new Response(repo.get(path)) : new Response('404: Not Found', { status: 404 });
    }
    return new Response('unexpected ' + url, { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function readDisk(root: string) {
  const out = new Map<string, string>();
  async function rec(rel: string) {
    for (const e of await fs.readdir(join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await rec(p);
      else out.set(p, await fs.readFile(join(root, p), 'utf8'));
    }
  }
  await rec('');
  return out;
}

describe('parseRepoInput', () => {
  const ok = (s: string) => parseRepoInput(s);
  it('reads the forms people paste', () => {
    expect(ok('pallets/flask')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('  pallets/flask  ')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('pallets/flask@2.3.x')).toEqual({ owner: 'pallets', repo: 'flask', ref: '2.3.x' });
    expect(ok('pallets/flask@feature/x')).toEqual({ owner: 'pallets', repo: 'flask', ref: 'feature/x' });
    expect(ok('https://github.com/pallets/flask')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('https://github.com/pallets/flask/')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('http://www.github.com/pallets/flask.git')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('github.com/pallets/flask')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('git@github.com:pallets/flask.git')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('https://github.com/pallets/flask?tab=readme#top')).toEqual({ owner: 'pallets', repo: 'flask' });
  });
  it('understands tree/blob/commit URLs, and pages that just mean the repo', () => {
    expect(ok('https://github.com/colinhacks/zod/tree/main/packages/zod')).toEqual({ owner: 'colinhacks', repo: 'zod', ref: 'main', subdir: 'packages/zod' });
    expect(ok('https://github.com/pallets/flask/tree/3.1.0')).toEqual({ owner: 'pallets', repo: 'flask', ref: '3.1.0' });
    expect(ok('https://github.com/pallets/flask/blob/main/README.md')).toEqual({ owner: 'pallets', repo: 'flask', ref: 'main' });
    expect(ok('https://github.com/pallets/flask/commit/abc1234')).toEqual({ owner: 'pallets', repo: 'flask', ref: 'abc1234' });
    expect(ok('https://github.com/pallets/flask/pull/5000')).toEqual({ owner: 'pallets', repo: 'flask' });
    expect(ok('https://github.com/pallets/flask/issues')).toEqual({ owner: 'pallets', repo: 'flask' });
  });
  it('rejects everything else', () => {
    for (const bad of ['', '   ', 'flask', 'pallets', 'https://gitlab.com/a/b', 'https://example.com/a/b', 'a/b/c/d', '-bad/repo', 'a/..', 'a/b c', 'https://github.com/a/b/whatever/x']) {
      expect(ok(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('selectFiles', () => {
  const blob = (path: string, size = 100): TreeEntry => ({ path, type: 'blob', size });
  it('keeps source and config files, and drops dependencies, build output, declarations, ignored and oversized files', () => {
    const sel = selectFiles(
      [blob('src/a.ts'), blob('src/b.py'), blob('node_modules/x/i.js'), blob('dist/a.js'), blob('types/a.d.ts'), blob('generated/g.ts'), blob('README.md'), blob('package.json'), blob('node_modules/x/package.json'), blob('big.js', LIMITS.maxFileBytes + 1), { path: 'src', type: 'tree' }],
      { gitignore: 'generated/\n' },
    );
    expect(sel.sources.map((s) => s.rel)).toEqual(['src/a.ts', 'src/b.py']);
    expect(sel.configs.map((s) => s.rel)).toEqual(['package.json']);
    expect(sel.tooLarge).toBe(1);
    expect(sel.trimmed).toBe(0);
  });
  it('restricts to a subfolder and makes paths relative to it', () => {
    const sel = selectFiles([blob('packages/a/src/x.ts'), blob('packages/a/package.json'), blob('packages/b/src/y.ts'), blob('root.ts')], { subdir: 'packages/a' });
    expect(sel.sources.map((s) => [s.rel, s.path])).toEqual([['src/x.ts', 'packages/a/src/x.ts']]);
    expect(sel.configs.map((s) => s.rel)).toEqual(['package.json']);
  });
  it('trims very large repositories, dropping tests and examples before application code', () => {
    const entries = [
      ...Array.from({ length: LIMITS.maxSourceFiles - 100 }, (_, i) => blob(`src/m${i}.ts`)),
      ...Array.from({ length: 300 }, (_, i) => blob(`test/t${i}.ts`)),
      ...Array.from({ length: 100 }, (_, i) => blob(`examples/e${i}.ts`)),
    ];
    const sel = selectFiles(entries);
    expect(sel.sources).toHaveLength(LIMITS.maxSourceFiles);
    expect(sel.trimmed).toBe(400 - 100);
    expect(sel.sources.filter((s) => s.rel.startsWith('src/'))).toHaveLength(LIMITS.maxSourceFiles - 100);
  });
});

describe('loadGithub', () => {
  const repo = new Map<string, string>([
    ['src/a.ts', "import { b } from './b'\nexport function a() { return b() }\n"],
    ['src/b.ts', 'export function b() { return 1 }\n'],
    ['package.json', '{"name":"demo"}'],
    ['.gitignore', 'generated/\n'],
    ['generated/g.ts', 'export const g = 1\n'],
    ['node_modules/x/index.js', 'module.exports = 1\n'],
    ['README.md', '# demo\n'],
  ]);

  it('downloads only the files worth analyzing, honouring the repo .gitignore', async () => {
    const gh = fakeGithub(repo);
    const progress: number[] = [];
    const src = await loadGithub({ owner: 'o', repo: 'r' }, { fetchImpl: gh.fetchImpl, onProgress: (p) => progress.push(p.done) });
    expect([...src.files.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...src.configs.keys()]).toEqual(['package.json']);
    expect(src.label).toBe('o/r');
    expect(src.detail).toBe('main');
    expect(src.origin).toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'main', subdir: undefined });
    expect(gh.calls.some((u) => u.includes('node_modules') || u.includes('generated') || u.includes('README'))).toBe(false);
    expect(progress.at(-1)).toBe(3);
  });

  it('uses one API call when the ref is given, and two when it must look up the default branch', async () => {
    const withRef = fakeGithub(repo, { branch: 'v1' });
    await loadGithub({ owner: 'o', repo: 'r', ref: 'v1' }, { fetchImpl: withRef.fetchImpl });
    expect(withRef.calls.filter((u) => u.startsWith('https://api.github.com')).length).toBe(1);
    const without = fakeGithub(repo);
    await loadGithub({ owner: 'o', repo: 'r' }, { fetchImpl: without.fetchImpl });
    expect(without.calls.filter((u) => u.startsWith('https://api.github.com')).length).toBe(2);
  });

  it('analyzes a subfolder with paths relative to it', async () => {
    const mono = new Map([['pkg/src/a.ts', 'export function a() {}\n'], ['pkg/package.json', '{}'], ['other/b.ts', 'export function b() {}\n']]);
    const src = await loadGithub({ owner: 'o', repo: 'r', subdir: 'pkg' }, { fetchImpl: fakeGithub(mono).fetchImpl });
    expect([...src.files.keys()]).toEqual(['src/a.ts']);
    expect(src.label).toBe('o/r/pkg');
  });

  it('turns GitHub failures into messages a person can act on', async () => {
    const fail = async (opts: Parameters<typeof fakeGithub>[1], ref = {}) => {
      try {
        await loadGithub({ owner: 'o', repo: 'r', ...ref }, { fetchImpl: fakeGithub(repo, opts).fetchImpl });
      } catch (e) {
        return e as LoadError;
      }
      throw new Error('expected a failure');
    };
    expect((await fail({ repoStatus: 404 })).code).toBe('not-found');
    expect((await fail({ treeStatus: 404 }, { ref: 'nope' })).message).toContain('"nope"');
    const limited = await fail({ repoStatus: 403, treeHeaders: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 25 * 60) } });
    expect(limited.code).toBe('rate-limit');
    expect(limited.hint).toMatch(/resets in about 2\d minutes/);
    expect((await fail({ repoStatus: 500 })).code).toBe('network');
    const empty = await loadGithub({ owner: 'o', repo: 'r' }, { fetchImpl: fakeGithub(new Map([['README.md', '#']])).fetchImpl }).catch((e) => e);
    expect(empty.code).toBe('empty');
    const offline = await loadGithub({ owner: 'o', repo: 'r' }, { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch }).catch((e) => e);
    expect(offline.code).toBe('network');
  });

  it('stops when cancelled', async () => {
    const ctl = new AbortController();
    const gh = fakeGithub(repo);
    const slow = (async (...a: Parameters<typeof fetch>) => {
      if (String(a[0]).startsWith('https://raw.')) ctl.abort();
      return gh.fetchImpl(...a);
    }) as typeof fetch;
    const err = await loadGithub({ owner: 'o', repo: 'r' }, { fetchImpl: slow, signal: ctl.signal }).catch((e) => e);
    expect(err.code).toBe('cancelled');
  });

  it('gives the same graph as indexing the same files from disk', async () => {
    for (const name of ['ts-basic', 'py-basic', 'express-proto']) {
      const root = fixture(name);
      const disk = await indexRepo(root);
      const src = await loadGithub({ owner: 'o', repo: 'r' }, { fetchImpl: fakeGithub(await readDisk(root)).fetchImpl });
      const mem = await indexFiles(src.files, src.configs, root);
      const strip = (g: typeof disk.graph) => ({ nodes: g.toJSON().nodes, edges: g.toJSON().edges });
      expect(strip(mem.graph), name).toEqual(strip(disk.graph));
    }
  });
});

describe('local folders', () => {
  const file = (rel: string, text: string) => {
    const f = new File([text], rel.slice(rel.lastIndexOf('/') + 1));
    Object.defineProperty(f, 'webkitRelativePath', { value: 'myproj/' + rel });
    return f;
  };
  const list = [
    file('src/a.ts', "import { b } from './b'\nexport function a() { return b() }\n"),
    file('src/b.ts', 'export function b() { return 1 }\n'),
    file('package.json', '{}'),
    file('.gitignore', 'secret/\n'),
    file('secret/s.ts', 'export const s = 1\n'),
    file('node_modules/x/i.js', 'x'),
    file('notes.md', '#'),
  ];

  it('strips the folder name and keeps the same files the GitHub loader would', async () => {
    const folder = entriesFromFileList(list);
    expect(folder.name).toBe('myproj');
    const src = await loadFolder(folder);
    expect([...src.files.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...src.configs.keys()]).toEqual(['package.json']);
    expect(src.label).toBe('myproj');
    expect(src.origin.kind).toBe('folder');
  });

  it('reports an empty folder', async () => {
    const err = await loadFolder(entriesFromFileList([file('README.md', '#')])).catch((e) => e);
    expect(err.code).toBe('empty');
  });
});
