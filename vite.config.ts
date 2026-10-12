import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative base so the build works from any sub-path (GitHub Pages, portfolio folders)
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5299,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
} as never);
