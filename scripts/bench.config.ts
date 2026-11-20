import { defineConfig } from 'vitest/config';

// `npm run bench`: physics timing (not part of `npm test`).
export default defineConfig({
  test: { include: ['scripts/bench.ts'], environment: 'node', testTimeout: 600000 },
});
