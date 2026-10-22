import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The extractors import '@codegraph/parser'. In the browser that has to be the entry that finds the .wasm files by
// URL (browser.ts), not the Node one that resolves them from node_modules.
const parserForBrowser = fileURLToPath(new URL('../parser/src/browser.ts', import.meta.url));

// `npm run dev:web` while `npm run cg -- serve <repo>` is running: /api is proxied to the CLI server.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@codegraph/parser': parserForBrowser } },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://localhost:4173' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
