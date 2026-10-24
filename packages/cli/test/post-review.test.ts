import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const post = createRequire(import.meta.url)('../../../action/post-review.cjs') as (e: unknown) => Promise<{ posted: number; kept: number; removed: number }>;
const MARK = '<!-- codegraph-inline -->';

const wanted = [
  { path: 'a.ts', line: 3, side: 'RIGHT', body: `first\n${MARK}` },
  { path: 'b.py', line: 1, side: 'LEFT', body: `second\n${MARK}` },
];

type Call = (arg?: unknown) => Promise<unknown>;
function fake(existing: object[] = [], opts: { review?: Call; single?: (c: { path: string }) => Promise<unknown>; list?: () => Promise<object[]> } = {}) {
  const pulls = {
    listReviewComments: () => {},
    deleteReviewComment: vi.fn<Call>(async () => ({})),
    createReview: vi.fn<Call>(opts.review ?? (async () => ({}))),
    createReviewComment: vi.fn<Call>((opts.single ?? (async () => ({}))) as Call),
  };
  const github = { paginate: vi.fn(opts.list ?? (async () => existing)), rest: { pulls } };
  const core = { warning: vi.fn(), info: vi.fn() };
  const fs = { readFileSync: () => JSON.stringify(wanted) };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 7, head: { sha: 'abc' } } } };
  return { github, core, fs, context, pulls };
}
const run = (f: ReturnType<typeof fake>) => post({ github: f.github, context: f.context, core: f.core, fs: f.fs, file: 'x.json' });

describe('posting inline comments', () => {
  it('leaves one review with every comment, pinned to the pull request head', async () => {
    const f = fake();
    expect(await run(f)).toEqual({ posted: 2, kept: 0, removed: 0 });
    expect(f.pulls.createReview).toHaveBeenCalledTimes(1);
    const arg = f.pulls.createReview.mock.calls[0][0] as { commit_id: string; event: string; comments: { path: string; side: string }[] };
    expect(arg.commit_id).toBe('abc');
    expect(arg.event).toBe('COMMENT');
    expect(arg.comments.map((c) => `${c.path}:${c.side}`)).toEqual(['a.ts:RIGHT', 'b.py:LEFT']);
  });

  it('keeps a comment that already says the same thing, replaces a stale one, and posts only what is new', async () => {
    const f = fake([
      { id: 1, path: 'a.ts', line: 3, side: 'RIGHT', body: wanted[0].body },
      { id: 2, path: 'old.ts', line: 9, side: 'RIGHT', body: `gone\n${MARK}` },
      { id: 3, path: 'a.ts', line: 1, side: 'RIGHT', body: 'a human wrote this, no marker' },
    ]);
    expect(await run(f)).toEqual({ posted: 1, kept: 1, removed: 1 });
    expect(f.pulls.deleteReviewComment.mock.calls.map((c) => (c[0] as { comment_id: number }).comment_id)).toEqual([2]);
    const comments = (f.pulls.createReview.mock.calls[0][0] as { comments: { path: string }[] }).comments;
    expect(comments.map((c) => c.path)).toEqual(['b.py']);
  });

  it('never deletes a comment someone replied to', async () => {
    const f = fake([
      { id: 5, path: 'old.ts', line: 9, side: 'RIGHT', body: `stale\n${MARK}` },
      { id: 6, in_reply_to_id: 5, path: 'old.ts', line: 9, side: 'RIGHT', body: 'we are fixing this' },
    ]);
    const r = await run(f);
    expect(r.removed).toBe(0);
    expect(f.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('falls back to one comment at a time when GitHub refuses the review, skipping the ones it refuses', async () => {
    const f = fake([], {
      review: async () => { throw new Error('Unprocessable: line not in diff'); },
      single: async (c) => { if (c.path === 'b.py') throw new Error('line not in diff'); return {}; },
    });
    expect(await run(f)).toEqual({ posted: 1, kept: 0, removed: 0 });
    expect(f.pulls.createReviewComment).toHaveBeenCalledTimes(2);
    expect(f.core.warning).toHaveBeenCalledWith(expect.stringContaining('Skipped an inline comment on b.py:1'));
  });

  it('does nothing, without failing, when the token is read-only (a pull request from a fork)', async () => {
    const f = fake([], { list: async () => { throw new Error('Resource not accessible by integration'); } });
    expect(await run(f)).toEqual({ posted: 0, kept: 0, removed: 0 });
    expect(f.pulls.createReview).not.toHaveBeenCalled();
    expect(f.core.warning).toHaveBeenCalled();
  });
});
