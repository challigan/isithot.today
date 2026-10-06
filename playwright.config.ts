import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Use the sandbox's preinstalled Chromium when present; CI installs its own.
const local = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync(local) ? local : undefined);
const port = Number(process.env.E2E_PORT ?? 4322);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'node apps/web/scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${port}/version.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATA_SOURCE: 'synthetic', E2E_PORT: String(port) },
  },
});
