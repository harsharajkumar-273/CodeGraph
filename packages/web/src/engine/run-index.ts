import type { GraphJSON } from '@codegraph/core';
import { LoadError } from '../sources/types';
import type { WorkerMessage, WorkerRequest } from './index-worker';

export interface IndexOutcome {
  graph: GraphJSON;
  warnings: string[];
  parseErrors: number;
}

/** Indexes files in a Web Worker. Rejects with a LoadError('cancelled') when `signal` aborts. */
export function runIndex(
  input: { files: Map<string, string>; configs: Map<string, string>; root: string },
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<IndexOutcome> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./index-worker.ts', import.meta.url), { type: 'module' });
    const finish = (fn: () => void) => {
      opts.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(new LoadError('cancelled', 'Cancelled.')));
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total);
      else if (m.type === 'done') finish(() => resolve({ graph: m.graph, warnings: m.warnings, parseErrors: m.parseErrors }));
      else finish(() => reject(new Error(m.message)));
    };
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'The analysis worker crashed.')));
    const req: WorkerRequest = { files: [...input.files], configs: [...input.configs], root: input.root };
    worker.postMessage(req);
  });
}
