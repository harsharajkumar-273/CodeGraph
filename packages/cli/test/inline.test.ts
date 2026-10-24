import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseUnifiedDiff } from '@codegraph/analysis';
import { cmdImpact } from '../src/commands';
import { INLINE_MARKER, type InlineComment } from '../src/inline';

const dir = mkdtempSync(join(tmpdir(), 'cg-inline-'));
const outDir = mkdtempSync(join(tmpdir(), 'cg-inline-out-'));
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'pipe' }).toString();
const write = (name: string, text: string) => writeFileSync(join(dir, name), text);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

/** Runs the CLI for `main...HEAD` and returns the inline comments it wrote. */
async function inline(extra: Record<string, boolean> = {}): Promise<InlineComment[]> {
  const out = join(outDir, 'inline.json');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await cmdImpact([], { diff: true, range: 'main...HEAD', repo: dir, format: 'markdown', 'inline-out': out, ...extra });
    return JSON.parse(readFileSync(out, 'utf8')) as InlineComment[];
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

/** GitHub accepts an inline comment only on a line of the diff: new-side lines for RIGHT, deleted old-side lines for LEFT. */
function onTheDiff(c: InlineComment): boolean {
  const ch = parseUnifiedDiff(git('diff', '-U0', 'main...HEAD')).find((x) => x.file === c.path);
  const ranges = c.side === 'RIGHT' ? ch?.ranges : ch?.removed;
  return !!ranges?.some(([a, b]) => c.line >= a && c.line <= b);
}

describe('inline comments', () => {
  it('puts a removed-but-still-called function on the deleted definition, and a signature change on the new signature', async () => {
    git('init', '-q', '-b', 'main');
    write('lib.py', 'def connect(host, port):\n    return host\n\ndef parse(x):\n    return x\n\ndef keep():\n    return 1\n');
    write('app.py', 'from lib import connect, parse, keep\n\ndef run():\n    return connect("a", 1)\n\ndef other():\n    return parse(2)\n\ndef noop():\n    return keep()\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'change');
    write('lib.py', 'def connect(host, port, timeout):\n    return host\n\ndef keep():\n    return 1\n');
    git('commit', '-qam', 'change');
    const found = await inline();
    expect(found).toHaveLength(2);
    const removed = found.find((c) => c.side === 'LEFT')!;
    expect(removed.path).toBe('lib.py');
    expect(removed.line).toBe(4); // `def parse` was line 4 of the old file
    expect(removed.body).toContain('`parse` is removed here, but 1 caller still calls it');
    expect(removed.body).toContain('`app.py#other` (app.py:7)');
    const sig = found.find((c) => c.side === 'RIGHT')!;
    expect(sig.path).toBe('lib.py');
    expect(sig.line).toBe(1);
    expect(sig.body).toContain('`connect` now requires 1 more argument, but `app.py:4` passes 2');
    for (const c of found) {
      expect(onTheDiff(c)).toBe(true);
      expect(c.body).toContain(INLINE_MARKER);
    }
  });

  it('says nothing when the change breaks nothing', async () => {
    git('checkout', '-q', 'main');
    git('checkout', '-qb', 'clean');
    write('extra.py', 'def fresh(a):\n    return a\n');
    git('add', '-A');
    git('commit', '-qm', 'add');
    expect(await inline()).toEqual([]);
  });

  it('puts a public function that was removed with no caller left on its deleted lines', async () => {
    git('checkout', '-q', 'main');
    git('checkout', '-qb', 'unused');
    write('lib.py', 'def connect(host, port):\n    return host\n\ndef keep():\n    return 1\n');
    write('app.py', 'from lib import connect, keep\n\ndef run():\n    return connect("a", 1)\n\ndef noop():\n    return keep()\n');
    git('commit', '-qam', 'drop parse and its only caller');
    const found = await inline();
    // two public functions go: `parse`, and `other` in app.py that was its only caller
    expect(found.map((c) => c.body.match(/Public `(\w+)`/)?.[1]).sort()).toEqual(['other', 'parse']);
    const parse = found.find((c) => c.body.includes('`parse`'))!;
    expect(parse).toMatchObject({ path: 'lib.py', side: 'LEFT', line: 4 });
    for (const c of found) expect(onTheDiff(c)).toBe(true);
  });

  it('comments on a widely used edit only when asked to', async () => {
    git('checkout', '-q', 'main');
    git('checkout', '-qb', 'hot');
    write('hub.py', 'def shared(x):\n    return x\n');
    for (const n of ['a', 'b', 'c']) write(`use_${n}.py`, `from hub import shared\n\ndef f_${n}_1():\n    shared(1)\n\ndef f_${n}_2():\n    shared(2)\n`);
    git('add', '-A');
    git('commit', '-qm', 'a shared helper used from three files');
    git('checkout', '-qb', 'hot2');
    write('hub.py', 'def shared(x):\n    return x + 1\n');
    git('commit', '-qam', 'edit the shared helper');
    const last = git('rev-parse', 'hot').trim();
    const run = async (extra: Record<string, boolean>) => {
      const out = join(outDir, 'hot.json');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await cmdImpact([], { diff: true, range: `${last}...HEAD`, repo: dir, format: 'markdown', 'inline-out': out, ...extra });
        return JSON.parse(readFileSync(out, 'utf8')) as InlineComment[];
      } finally {
        log.mockRestore();
        err.mockRestore();
      }
    };
    expect(await run({})).toEqual([]);
    const found = await run({ 'inline-hotspots': true });
    expect(found).toHaveLength(1);
    expect(found[0].body).toContain('Edits `shared`, which 6 callers in 3 files depend on');
    expect(found[0]).toMatchObject({ path: 'hub.py', side: 'RIGHT' });
  });
});
