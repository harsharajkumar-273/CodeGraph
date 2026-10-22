import type { LoadedSource } from './sources/types';

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** A link to a file (and lines) on GitHub, when the repository came from there. */
export function githubUrl(origin: LoadedSource['origin'] | { kind: string }, path: string, start?: number, end?: number): string | undefined {
  if (origin.kind !== 'github') return undefined;
  const o = origin as Extract<LoadedSource['origin'], { kind: 'github' }>;
  const full = o.subdir ? `${o.subdir}/${path}` : path;
  const lines = start ? `#L${start}${end && end !== start ? `-L${end}` : ''}` : '';
  return `https://github.com/${o.owner}/${o.repo}/blob/${encodePath(o.ref)}/${encodePath(full)}${lines}`;
}
