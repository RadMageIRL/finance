import { defineConfig, devices } from '@playwright/test';

// Browser checks run against the production build served by `astro preview`.
// Run `npm run build` first (tools/check.mjs does this).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4329',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4329/finance/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
