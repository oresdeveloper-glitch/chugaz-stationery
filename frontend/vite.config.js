import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:7860', changeOrigin: true },
      '/uploads': { target: 'http://localhost:7860', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // React/router/scheduler go to their own long-lived chunk so an app
        // update does not re-download the framework (repeat visits start fast).
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});