// Builds the static, read-only demo site: the web UI plus one pre-built graph, no server.
// Used by Vercel (vercel.json) and runnable locally:
//
//   npm run build:demo                                     # Flask 3.1.0 by default
//   DEMO_REPO=https://github.com/honojs/hono DEMO_REF=v4.6.0 npm run build:demo
//
// Output: packages/web/dist, with the graph at /graph.json (vercel.json rewrites the UI's /api/graph to it).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = process.env.DEMO_REPO ?? 'https://github.com/pallets/flask';
const ref = process.env.DEMO_REF ?? '3.1.0';
const dir = mkdtempSync(join(tmpdir(), 'codegraph-demo-'));
const src = join(dir, repo.split('/').pop().replace(/\.git$/, ''));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
try {
  run('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, repo, src]);
  run('npx', ['tsx', 'packages/cli/src/bin.ts', 'index', src, '-o', 'packages/web/dist/graph.json']);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
