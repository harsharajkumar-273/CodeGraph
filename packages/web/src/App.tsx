import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphJSON } from '@codegraph/core';
import { analyze, sessionFromGraph, type Session } from './session';
import { loadGithub } from './sources/github';
import { getToken } from './sources/token';
import { loadFolder, type Picked } from './sources/local';
import { parseRepoInput, repoLabel, type RepoRef } from './sources/parse-repo';
import { LoadError, type LoadProgress } from './sources/types';
import { Landing, type LandingError } from './views/Landing';
import { Loading } from './views/Loading';
import { Workspace } from './views/Workspace';

type Screen =
  | { kind: 'boot' }
  | { kind: 'landing'; error?: LandingError | null; prefill?: string }
  | { kind: 'loading'; title: string; progress: LoadProgress | null }
  | { kind: 'workspace'; session: Session; shareUrl?: string };

const TITLE = 'CodeGraph: see what breaks before you change it';

/** A link that reopens this analysis: `?repo=owner/repo`, with the branch and folder when they were given. */
function shareUrlFor(ref: RepoRef) {
  const spec = ref.subdir ? `${ref.owner}/${ref.repo}/tree/${ref.ref ?? 'HEAD'}/${ref.subdir}` : `${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ''}`;
  return `${location.origin}${location.pathname}?repo=${spec}`;
}

function describe(e: unknown): LandingError {
  if (e instanceof LoadError) return { message: e.message, hint: e.hint };
  return { message: 'Something went wrong while analyzing.', hint: (e as Error)?.message };
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'boot' });
  const abort = useRef<AbortController | null>(null);
  const booted = useRef(false);

  const run = useCallback(async (title: string, work: (signal: AbortSignal, progress: (p: LoadProgress) => void) => Promise<Session>, shareUrl?: string, prefill?: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setScreen({ kind: 'loading', title, progress: null });
    try {
      const session = await work(ctl.signal, (progress) => !ctl.signal.aborted && setScreen({ kind: 'loading', title, progress }));
      if (ctl.signal.aborted) return;
      document.title = `${session.label} · CodeGraph`;
      history.replaceState(null, '', shareUrl ? shareUrl.slice(location.origin.length) : location.pathname);
      setScreen({ kind: 'workspace', session, shareUrl });
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof LoadError && e.code === 'cancelled')) return setScreen({ kind: 'landing', prefill });
      if (!(e instanceof LoadError)) console.error(e); // LoadErrors are expected (typos, private repos, limits) and shown to the user
      setScreen({ kind: 'landing', error: describe(e), prefill });
    }
  }, []);

  const startRepo = useCallback(
    (input: string) => {
      const ref = parseRepoInput(input);
      if (!ref) {
        setScreen({ kind: 'landing', prefill: input, error: { message: "That doesn't look like a GitHub repository.", hint: 'Use owner/repo, a github.com link, or owner/repo@branch.' } });
        return;
      }
      void run(repoLabel(ref), async (signal, progress) => analyze(await loadGithub(ref, { signal, onProgress: progress, token: getToken() || undefined }), { signal, onProgress: progress }), shareUrlFor(ref), input);
    },
    [run],
  );

  const startPick = useCallback(
    (resolve: () => Promise<Picked>) => {
      void run('your files', async (signal, progress) => {
        progress({ phase: 'read', done: 0, total: 0, message: 'Looking through your files…' });
        const picked = await resolve();
        return analyze(await loadFolder(picked, { signal, onProgress: progress }), { signal, onProgress: progress });
      });
    },
    [run],
  );

  const openGraph = useCallback(
    async (file: File) => {
      try {
        const json = JSON.parse(await file.text()) as GraphJSON;
        if (!Array.isArray(json.nodes) || !Array.isArray(json.edges)) throw new Error('not a CodeGraph graph');
        const session = sessionFromGraph(json, 'graph', file.name.replace(/\.json$/i, ''));
        document.title = `${session.label} · CodeGraph`;
        setScreen({ kind: 'workspace', session });
      } catch (e) {
        setScreen({ kind: 'landing', error: { message: "Couldn't read that file as a CodeGraph graph.", hint: (e as Error).message } });
      }
    },
    [],
  );

  const home = useCallback(() => {
    abort.current?.abort();
    document.title = TITLE;
    history.replaceState(null, '', location.pathname);
    setScreen({ kind: 'landing' });
  }, []);

  // On load: a shared `?repo=` link opens that analysis; the CLI's `serve` command has a graph ready at /api/graph.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const repo = new URLSearchParams(location.search).get('repo');
    if (repo) return startRepo(repo);
    // Only a page served by `codegraph serve` (which marks it) or the dev server has a graph waiting; probing anywhere
    // else would just log a 404 for every visitor.
    if (!(window as { __CODEGRAPH_SERVED__?: boolean }).__CODEGRAPH_SERVED__ && !import.meta.env.DEV) return setScreen({ kind: 'landing' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    fetch('/api/graph', { signal: ctl.signal })
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? (r.json() as Promise<GraphJSON>) : Promise.reject(new Error('no graph served'))))
      .then((json) => {
        const session = sessionFromGraph(json, 'cli');
        document.title = `${session.label} · CodeGraph`;
        setScreen({ kind: 'workspace', session });
      })
      .catch(() => setScreen({ kind: 'landing' }))
      .finally(() => clearTimeout(timer));
  }, [startRepo]);

  switch (screen.kind) {
    case 'boot':
      return <div className="boot" />;
    case 'loading':
      return <Loading title={screen.title} progress={screen.progress} onCancel={home} />;
    case 'workspace':
      return <Workspace key={screen.session.label + (screen.session.ms ?? '')} session={screen.session} shareUrl={screen.shareUrl} onHome={home} />;
    default:
      return <Landing error={screen.error} initialValue={screen.prefill} onRepo={startRepo} onPick={startPick} onGraphFile={(f) => void openGraph(f)} />;
  }
}
