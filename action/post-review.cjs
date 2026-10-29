// Posts CodeGraph's inline review comments on a pull request, replacing the ones it posted on an earlier push.
// Kept out of action.yml so it can be tested with a stand-in for the GitHub API.
const MARKER = '<!-- codegraph-inline -->';

/**
 * @param {{ github: any, context: any, core: any, fs: any, file: string }} env
 */
module.exports = async function postInline({ github, context, core, fs, file }) {
  const { owner, repo } = context.repo;
  const pr = context.payload.pull_request;
  const pull_number = pr.number;
  const wanted = JSON.parse(fs.readFileSync(file, 'utf8'));

  let existing;
  try {
    existing = await github.paginate(github.rest.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 });
  } catch (e) {
    // A pull request from a fork gets a read-only token; the summary comment already carries the findings.
    core.warning(`Could not read review comments (${e.message}); skipping inline comments.`);
    return { posted: 0, kept: 0, removed: 0 };
  }
  const mine = existing.filter((c) => c.body && c.body.includes(MARKER));
  const replied = new Set(existing.map((c) => c.in_reply_to_id).filter(Boolean));

  // A comment that already says the same thing on the same line stays, so people's replies and resolutions are not lost.
  const keep = new Set();
  const fresh = wanted.filter((w) => {
    const same = mine.find((o) => !keep.has(o.id) && o.path === w.path && (o.line ?? o.original_line) === w.line && o.side === w.side && o.body.trim() === w.body.trim());
    if (same) keep.add(same.id);
    return !same;
  });
  let removed = 0;
  for (const o of mine) {
    if (keep.has(o.id) || replied.has(o.id)) continue; // never delete a thread someone answered
    try {
      await github.rest.pulls.deleteReviewComment({ owner, repo, comment_id: o.id });
      removed++;
    } catch (e) {
      core.warning(`Could not remove an old inline comment (${e.message}).`);
    }
  }
  if (!fresh.length) return { posted: 0, kept: keep.size, removed };

  const commit_id = pr.head.sha;
  const comments = fresh.map(({ path, line, side, body }) => ({ path, line, side, body }));
  try {
    await github.rest.pulls.createReview({ owner, repo, pull_number, commit_id, event: 'COMMENT', comments });
    return { posted: comments.length, kept: keep.size, removed };
  } catch (e) {
    // GitHub rejects the whole review if one anchor is not on the diff; try them one at a time and skip the refused ones.
    core.warning(`Posting the review failed (${e.message}); trying the comments one by one.`);
  }
  let posted = 0;
  for (const c of comments) {
    try {
      await github.rest.pulls.createReviewComment({ owner, repo, pull_number, commit_id, ...c });
      posted++;
    } catch (e) {
      core.warning(`Skipped an inline comment on ${c.path}:${c.line} (${e.message}).`);
    }
  }
  return { posted, kept: keep.size, removed };
};

module.exports.MARKER = MARKER;
