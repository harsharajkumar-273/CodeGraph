/** A repository that has been read into memory and is ready to index. */
export interface LoadedSource {
  /** Short name for the header: `pallets/flask`, or the folder's name. */
  label: string;
  /** Second line for the header: `main`, `3 folders deep`, ... */
  detail?: string;
  origin: { kind: 'github'; owner: string; repo: string; ref: string; subdir?: string } | { kind: 'folder' };
  files: Map<string, string>;
  configs: Map<string, string>;
  /** Things the user should know about the analysis: trimmed repos, files that could not be read. */
  notes: string[];
}

export type Phase = 'list' | 'download' | 'read' | 'index';

export interface LoadProgress {
  phase: Phase;
  done: number;
  total: number;
  message: string;
}

export type LoadErrorCode = 'invalid-input' | 'not-found' | 'rate-limit' | 'auth' | 'network' | 'empty' | 'cancelled';

/** An expected failure with a message that can be shown to the user as is. */
export class LoadError extends Error {
  constructor(
    readonly code: LoadErrorCode,
    message: string,
    /** What to do about it. */
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'LoadError';
  }
}

/** Limits that keep a browser tab usable. */
export const LIMITS = {
  maxFileBytes: 1_000_000,
  maxSourceFiles: 3000,
  maxTotalBytes: 40_000_000,
  concurrency: 12,
};
