import { defineConfig } from 'vitest/config';

// `base` must match the GitHub repository name for GitHub Pages.
export default defineConfig({
  base: '/ubatssim/',
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Physics tests simulate minutes of sim time; CI runners are slower than dev machines.
    testTimeout: 60000,
  },
});
