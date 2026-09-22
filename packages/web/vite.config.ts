import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `npm run dev:web` while `npm run cg -- serve <repo>` is running: /api is proxied to the CLI server.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4173' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
