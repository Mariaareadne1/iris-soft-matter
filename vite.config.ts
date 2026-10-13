import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative base so the build works from any sub-path (GitHub Pages, portfolio folders)
  base: './',
  plugins: [react()],
  build: {
    // three.js changes far less often than the app: give it its own cached chunk
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: Number(process.env.PORT) || 5299,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
} as never);
