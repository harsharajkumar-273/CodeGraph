// Bundles the CLI into a single, dependency-free (aside from web-tree-sitter and
// tree-sitter-wasms, which load their .wasm files by path at runtime and so must
// stay real npm dependencies rather than being bundled) script, and copies the
// built web UI alongside it so `codegraph serve` works out of the box.
import { build } from 'esbuild';
import { chmodSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, 'dist/bin.js');

rmSync(resolve(here, 'dist'), { recursive: true, force: true });

await build({
  entryPoints: [resolve(here, 'src/bin.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: ['web-tree-sitter', 'tree-sitter-wasms'],
  logLevel: 'info',
});
chmodSync(outfile, 0o755);

const webDist = resolve(here, '../web/dist');
if (existsSync(webDist)) {
  // Node's fs.cpSync hits a permission quirk on some mounted/bridged filesystems
  // when creating a new directory tree in one call; a plain `cp -r` into an
  // already-created destination directory works reliably everywhere.
  const dest = resolve(here, 'dist/web');
  mkdirSync(dest, { recursive: true });
  execFileSync('cp', ['-r', webDist + '/.', dest + '/']);
  console.log('copied web UI build into dist/web');
} else {
  console.warn('packages/web/dist not found — run `npm run build:web` first if you want `codegraph serve` to work out of the box in the published package');
}
