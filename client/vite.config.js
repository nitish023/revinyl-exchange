import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite is only our dev server and bundler; the UI is plain JavaScript modules and
// one CSS file (no front-end framework, per the course rules).
// In development Vite serves the UI on :5173 and forwards /api to the Node server
// on :3000, so the browser sees one origin and the session cookie just works.
// In production, `npm run build` writes client/dist and Express serves it.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
