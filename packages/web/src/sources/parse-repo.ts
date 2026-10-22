export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit; the default branch when absent. */
  ref?: string;
  /** Analyze only this folder (a package of a monorepo). */
  subdir?: string;
}

/** GitHub pages of a repo that mean "this repo" when pasted (an issue, a pull request, the releases tab). */
const PAGES = new Set(['issues', 'pull', 'pulls', 'commits', 'releases', 'tags', 'branches', 'actions', 'wiki', 'discussions', 'compare', 'graphs', 'network', 'stargazers', 'forks']);
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts what people paste: `owner/repo`, `owner/repo@branch`, `https://github.com/owner/repo`,
 * `github.com/owner/repo/tree/branch/sub/dir`, `git@github.com:owner/repo.git`. Returns null when it is not a repo.
 * A branch name containing `/` is only understood in the `owner/repo@feature/x` form (in a `/tree/` URL it would be
 * ambiguous with the folder path).
 */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, 'github.com/').replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null; // some other host
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');

  let ref: string | undefined;
  let subdir: string | undefined;
  const at = s.indexOf('@');
  if (at >= 0) {
    ref = s.slice(at + 1) || undefined;
    s = s.slice(0, at);
  }
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;
  if (kind !== undefined) {
    const arg = rest[0] === undefined ? undefined : decodeURIComponent(rest[0]);
    if (kind === 'tree' || kind === 'blob') {
      ref ??= arg;
      if (kind === 'tree' && rest.length > 1) subdir = rest.slice(1).map(decodeURIComponent).join('/');
    } else if (kind === 'commit') {
      ref ??= arg;
    } else if (!PAGES.has(kind)) {
      return null; // `owner/repo/something/else` is not a repo reference
    }
  }
  return { owner, repo, ...(ref ? { ref } : {}), ...(subdir ? { subdir } : {}) };
}

export const repoLabel = (r: RepoRef) => `${r.owner}/${r.repo}`;
