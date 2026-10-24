import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 2048,
  },
  server: { host: true },
});
