import { defineConfig } from 'vitest/config';

// `base` must match the GitHub repository name for GitHub Pages.
export default defineConfig({
  base: '/ubatssim/',
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Three.js in its own file: cached by the browser across updates of the game.
        manualChunks(id: string) {
          return id.includes('node_modules/three') ? 'three' : undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Physics tests simulate minutes of sim time; CI runners are slower than dev machines.
    testTimeout: 60000,
  },
});
