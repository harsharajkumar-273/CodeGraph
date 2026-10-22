// Which files of a repository are indexed. Shared by the Node walker (indexer.ts) and the browser loaders so a repo
// gives the same file set whether it is read from disk, from GitHub or from a dropped folder.
import ignore from 'ignore';
import { SUPPORTED_EXTENSIONS } from '@codegraph/parser';

export const DEFAULT_IGNORES = [
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.venv', 'venv', 'env', '__pycache__',
  'coverage', '.tox', 'target', 'vendor', '.cache', '.codegraph', '.turbo', '*.timestamp-*.mjs', '*.min.js', '*.d.ts', '*.map', '*.bundle.js',
];

/** Config files the resolver reads (workspace packages, tsconfig paths, Go module paths). */
export const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'go.mod']);

export interface FileFilter {
  /** True when a directory (repo-relative, no trailing slash) should not be entered. */
  ignoresDir(rel: string): boolean;
  /** True when a file (repo-relative) is ignored by the ignore rules. */
  ignoresFile(rel: string): boolean;
  isSource(name: string): boolean;
  isConfig(name: string): boolean;
}

export interface FilterOptions {
  /** Contents of the repo-root `.gitignore`. */
  gitignore?: string;
  /** Contents of the repo-root `.codegraphignore` (exclusions that should not affect git). */
  codegraphignore?: string;
  /** Extra gitignore-style patterns. */
  exclude?: string[];
}

export function createFilter(opts: FilterOptions = {}): FileFilter {
  const ig = ignore().add(DEFAULT_IGNORES).add(opts.exclude ?? []);
  if (opts.gitignore) ig.add(opts.gitignore);
  if (opts.codegraphignore) ig.add(opts.codegraphignore);
  return {
    ignoresDir: (rel) => ig.ignores(rel + '/'),
    ignoresFile: (rel) => ig.ignores(rel),
    isSource(name) {
      const dot = name.lastIndexOf('.');
      return dot >= 0 && SUPPORTED_EXTENSIONS.includes(name.slice(dot).toLowerCase());
    },
    isConfig: (name) => CONFIG_NAMES.has(name),
  };
}
