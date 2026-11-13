import { defineConfig } from 'vite';
import { htmlComponents } from './scripts/html-components.js';

// Relative base so the build works from any static host path (e.g. GitHub Pages project sites).
export default defineConfig({ base: './', plugins: [htmlComponents()] });
