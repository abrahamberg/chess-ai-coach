import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev-only: the SPA calls same-origin `/api/...` paths (see api/client.ts), so
// the Vite dev server needs to forward them to the real API instead of
// falling back to index.html. VITE_API_PROXY_TARGET lets docker-compose point
// this at the `api` service by container name; defaults to localhost for
// running `npm run dev` directly on the host.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: false
  }
});
