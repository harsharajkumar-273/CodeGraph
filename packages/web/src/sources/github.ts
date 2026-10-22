// Reads a GitHub repository straight from the browser: one call to the tree API lists every file, then the source
// files are fetched from raw.githubusercontent.com. Both hosts send `access-control-allow-origin: *`, so no server is
// involved and nothing is uploaded anywhere. With a token (private repositories, or a higher rate limit) the files come
// from the contents API instead, because that is the endpoint that accepts an Authorization header from a browser.
import { createFilter } from '@codegraph/extractors/browser';
import { repoLabel, type RepoRef } from './parse-repo';
import { LIMITS, LoadError, type LoadProgress, type LoadedSource } from './types';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface GithubOptions {
  signal?: AbortSignal;
  onProgress?: (p: LoadProgress) => void;
  /** A personal access token. Sent only to api.github.com. */
  token?: string;
  /** For tests. */
  fetchImpl?: typeof fetch;
}

const TESTISH = /(^|\/)(tests?|__tests__|spec|e2e|integration|fixtures?|examples?|docs?|benchmarks?|bench)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.py$|_test\.go$/;
const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export interface Selection {
  /** Repo-relative path (after removing `subdir`) and the path to request. */
  sources: { rel: string; path: string; size: number }[];
  configs: { rel: string; path: string; size: number }[];
  /** Source files left out to stay within the limits. */
  trimmed: number;
  /** Source files left out for being larger than the per-file limit. */
  tooLarge: number;
}

/** Which files of a repository listing to analyze. Pure: no network. */
export function selectFiles(entries: TreeEntry[], opts: { subdir?: string; gitignore?: string; codegraphignore?: string } = {}): Selection {
  const prefix = opts.subdir ? opts.subdir.replace(/^\/+|\/+$/g, '') + '/' : '';
  const filter = createFilter({ gitignore: opts.gitignore, codegraphignore: opts.codegraphignore });
  const sources: Selection['sources'] = [];
  const configs: Selection['configs'] = [];
  let tooLarge = 0;
  for (const e of entries) {
    if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (filter.ignoresFile(rel)) continue;
    const size = e.size ?? 0;
    if (filter.isConfig(name) && size <= LIMITS.maxFileBytes) configs.push({ rel, path: e.path, size });
    if (!filter.isSource(name)) continue;
    if (size > LIMITS.maxFileBytes) tooLarge++;
    else sources.push({ rel, path: e.path, size });
  }
  let trimmed = 0;
  if (sources.length > LIMITS.maxSourceFiles || sources.reduce((n, s) => n + s.size, 0) > LIMITS.maxTotalBytes) {
    // Keep the application code: tests and examples go first, then the deepest paths.
    const rank = (s: { rel: string }) => (TESTISH.test(s.rel) ? 1000 : 0) + s.rel.split('/').length;
    const ordered = [...sources].sort((a, b) => rank(a) - rank(b) || (a.rel < b.rel ? -1 : 1));
    const kept: typeof sources = [];
    let bytes = 0;
    for (const s of ordered) {
      if (kept.length >= LIMITS.maxSourceFiles || bytes + s.size > LIMITS.maxTotalBytes) continue;
      kept.push(s);
      bytes += s.size;
    }
    trimmed = sources.length - kept.length;
    sources.length = 0;
    sources.push(...kept);
  }
  sources.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return { sources, configs, trimmed, tooLarge };
}

/** Runs `worker` over `items` with a bounded number in flight; stops early when `signal` aborts. */
export async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      await worker(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

export async function loadGithub(repoRef: RepoRef, opts: GithubOptions = {}): Promise<LoadedSource> {
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const label = repoLabel(repoRef);
  const progress = (p: LoadProgress) => opts.onProgress?.(p);
  const cancelled = () => new LoadError('cancelled', 'Cancelled.');

  const get = async (url: string, accept?: string): Promise<Response> => {
    try {
      const headers: Record<string, string> = {};
      if (accept) headers.Accept = accept;
      if (opts.token && url.startsWith(API)) headers.Authorization = `Bearer ${opts.token}`; // never to any other host
      return await f(url, { signal: opts.signal, headers: Object.keys(headers).length ? headers : undefined });
    } catch (e) {
      if (opts.signal?.aborted || (e as Error).name === 'AbortError') throw cancelled();
      throw new LoadError('network', "Couldn't reach GitHub.", 'Check your connection and try again.');
    }
  };

  const api = async <T>(path: string, what: string): Promise<T> => {
    const res = await get(API + path, 'application/vnd.github+json');
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) {
      throw new LoadError(
        'not-found',
        `Couldn't find ${what}.`,
        opts.token
          ? 'Check the spelling, and that your token can read this repository (a fine-grained token needs "Contents: read" on it).'
          : 'Check the spelling. For a private repository, add a GitHub token below, or drop a clone of it onto this page.',
      );
    }
    // 403/429 from the anonymous API is almost always its rate limit. The remaining-requests header says so for sure,
    // but a browser can only read it when the server exposes it, so a missing header counts as "probably".
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (res.status === 401) throw new LoadError('auth', 'GitHub did not accept that token.', 'It may be mistyped, expired or revoked. Remove it, or paste a new one.');
    if (res.status === 429 || (res.status === 403 && (remaining === '0' || remaining === null))) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : undefined;
      throw new LoadError(
        'rate-limit',
        remaining === '0'
          ? `GitHub's limit for ${opts.token ? 'this token' : 'anonymous requests'} has been reached.`
          : `GitHub refused the request, most likely because its limit for ${opts.token ? 'this token' : 'anonymous requests'} has been reached.`,
        `${mins ? `It resets in about ${mins} minute${mins === 1 ? '' : 's'}. ` : 'Wait a few minutes and try again. '}${opts.token ? '' : 'A GitHub token raises the limit to 5,000 an hour. '}Meanwhile you can analyze a local folder, which doesn't use GitHub.`,
      );
    }
    throw new LoadError('network', `GitHub answered ${res.status} for ${what}.`, 'Try again in a moment.');
  };

  progress({ phase: 'list', done: 0, total: 0, message: `Looking up ${label}…` });
  let branch = repoRef.ref;
  if (!branch) {
    const info = await api<{ default_branch: string }>(`/repos/${repoRef.owner}/${repoRef.repo}`, `the repository ${label}`);
    branch = info.default_branch;
  }
  const tree = await api<{ tree: TreeEntry[]; truncated?: boolean }>(
    `/repos/${repoRef.owner}/${repoRef.repo}/git/trees/${encodePath(branch)}?recursive=1`,
    repoRef.ref ? `${label} at "${branch}"` : `the file list of ${label}`,
  );
  if (opts.signal?.aborted) throw cancelled();

  const rawUrl = (path: string) => `${RAW}/${repoRef.owner}/${repoRef.repo}/${encodePath(branch!)}/${encodePath(path)}`;
  const contentsUrl = (path: string) => `${API}/repos/${repoRef.owner}/${repoRef.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch!)}`;
  const fetchText = async (path: string): Promise<string | undefined> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = opts.token ? await get(contentsUrl(path), 'application/vnd.github.raw+json') : await get(rawUrl(path));
        if (res.ok) return await res.text();
        if (res.status === 404) return undefined;
      } catch (e) {
        if ((e as LoadError).code === 'cancelled') throw e;
      }
    }
    return undefined;
  };

  // The ignore files decide which of the listed files to download, so they come first.
  const prefix = repoRef.subdir ? repoRef.subdir.replace(/^\/+|\/+$/g, '') + '/' : '';
  const has = (name: string) => tree.tree.some((e) => e.type === 'blob' && e.path === prefix + name);
  const [gitignore, codegraphignore] = await Promise.all([
    has('.gitignore') ? fetchText(prefix + '.gitignore') : undefined,
    has('.codegraphignore') ? fetchText(prefix + '.codegraphignore') : undefined,
  ]);
  const sel = selectFiles(tree.tree, { subdir: repoRef.subdir, gitignore, codegraphignore });
  if (!sel.sources.length) {
    throw new LoadError(
      'empty',
      `${label} has no TypeScript, JavaScript or Python files to analyze${repoRef.subdir ? ` in ${repoRef.subdir}` : ''}.`,
      'CodeGraph reads .ts, .tsx, .js, .jsx, .mjs, .cjs, .py and .go files.',
    );
  }

  const files = new Map<string, string>();
  const configs = new Map<string, string>();
  const jobs = [...sel.sources.map((s) => ({ ...s, config: false })), ...sel.configs.map((s) => ({ ...s, config: true }))];
  let done = 0;
  let failed = 0;
  progress({ phase: 'download', done, total: jobs.length, message: 'Downloading files…' });
  await pool(
    jobs,
    LIMITS.concurrency,
    async (j) => {
      const text = await fetchText(j.path);
      if (text === undefined) failed++;
      else (j.config ? configs : files).set(j.rel, text);
      progress({ phase: 'download', done: ++done, total: jobs.length, message: 'Downloading files…' });
    },
    opts.signal,
  );
  if (opts.signal?.aborted) throw cancelled();
  if (failed > jobs.length / 2) throw new LoadError('network', 'Most files could not be downloaded.', 'Check your connection and try again.');

  const notes: string[] = [];
  if (sel.trimmed) notes.push(`Large repository: analyzed ${files.size.toLocaleString()} of ${(files.size + sel.trimmed).toLocaleString()} source files, keeping application code over tests and examples.`);
  if (sel.tooLarge) notes.push(`${sel.tooLarge} file${sel.tooLarge === 1 ? ' was' : 's were'} skipped for being over 1 MB.`);
  if (failed) notes.push(`${failed} file${failed === 1 ? '' : 's'} could not be downloaded and ${failed === 1 ? 'was' : 'were'} skipped.`);
  if (tree.truncated) notes.push("GitHub truncated the file list because the repository is very large, so some files may be missing.");

  return {
    label: label + (repoRef.subdir ? `/${repoRef.subdir}` : ''),
    detail: branch,
    origin: { kind: 'github', owner: repoRef.owner, repo: repoRef.repo, ref: branch, subdir: repoRef.subdir },
    files,
    configs,
    notes,
  };
}
