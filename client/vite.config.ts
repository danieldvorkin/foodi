import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.FOODI_API_ORIGIN ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5100,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/mock-oauth': { target: API, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
