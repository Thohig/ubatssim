import { defineConfig, devices } from '@playwright/test';

/**
 * Tests in a real browser (tests/e2e): the menus, the layout and the 3D view
 * against the production build (`vite preview`). The unit tests use happy-dom,
 * which has no layout and no WebGL. `npm run test:e2e`.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  // The 3D view is drawn in software (SwiftShader) at ~10 frames per second, and
  // every page takes a whole CPU core or more: few workers, long time limits.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/ubatssim/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/ubatssim/`,
    reuseExistingServer: !process.env.CI,
  },
});
