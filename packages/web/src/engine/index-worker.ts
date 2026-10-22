// Runs the indexer off the main thread so the page stays responsive while a large repository is parsed.
import { indexFiles } from '@codegraph/extractors/browser';
import type { GraphJSON } from '@codegraph/core';

export interface WorkerRequest {
  files: [string, string][];
  configs: [string, string][];
  root: string;
}

export type WorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; graph: GraphJSON; warnings: string[]; parseErrors: number }
  | { type: 'error'; message: string };

const post = (m: WorkerMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { files, configs, root } = e.data;
  let last = 0;
  try {
    const res = await indexFiles(new Map(files), new Map(configs), root, {
      onProgress(done, total) {
        const now = performance.now();
        if (done === total || now - last > 60) {
          last = now;
          post({ type: 'progress', done, total });
        }
      },
    });
    post({ type: 'done', graph: res.graph.toJSON(res.stats as unknown as Record<string, number>), warnings: res.warnings.slice(0, 20), parseErrors: res.stats.parseErrors });
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message ?? String(err) });
  }
};
