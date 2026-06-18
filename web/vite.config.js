import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the React app calls the API at /api and Vite proxies it to the
// Express server on :4000, so everything is same-origin (no CORS headaches).
export default defineConfig({
  plugins: [react()],
  // Split big vendors into separate chunks → lower peak memory during the
  // production build (helps constrained CI/host builders) and no size warning.
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          icons: ['lucide-react'],
        },
      },
    },
  },
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
