import { defineConfig, devices } from '@playwright/test';

const siteTestPort = Number(process.env.SITE_TEST_PORT || 4173);
const siteTestURL = `http://127.0.0.1:${siteTestPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'line',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: siteTestURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-site.mjs',
    url: `${siteTestURL}/`,
    env: { PORT: String(siteTestPort) },
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
