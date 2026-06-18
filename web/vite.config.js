import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the React app calls the API at /api and Vite proxies it to the
// Express server on :4000, so everything is same-origin (no CORS headaches).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
