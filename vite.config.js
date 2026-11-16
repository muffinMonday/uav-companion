import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { htmlComponents } from './scripts/html-components.js';

// Relative base so the build works from any static host path (e.g. GitHub Pages project sites).
// Two pages: the app, and the motor diagnostics lab (read-only; its code is only active when VITE_PREFLIGHT_DIAGNOSTICS=1).
export default defineConfig({
  base: './',
  plugins: [htmlComponents()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        preflightLab: resolve(import.meta.dirname, 'tools/preflight-spike/index.html'),
      },
    },
  },
});
