import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/curling',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
