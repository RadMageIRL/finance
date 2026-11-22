import { defineConfig, devices } from '@playwright/test';

// Browser checks run against the production build served by `astro preview`.
// Run `npm run build` first (tools/check.mjs does this). PW_PORT moves the preview server, so that
// several worktrees can run their browser tests at once; the default is 4329.
const PORT = Number(process.env.PW_PORT ?? 4329);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: PORT === 4329 ? 'npm run preview' : `npx astro preview --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/finance/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
