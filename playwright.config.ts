import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { LONDON, atLocal } from './e2e/time';

// Use the sandbox's preinstalled Chromium when present; CI installs its own.
const local = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync(local) ? local : undefined);
const port = Number(process.env.E2E_PORT ?? 4322);

// Two switches check that the suite passes at any time of day (e2e/helpers.ts):
// E2E_IP_HOUR=HH puts the approximate (IP) place of home pages where it is HH o'clock now (the
// test workers read it), and E2E_CLOCK=HH:MM runs the suite as if it were that time in London
// today: the server's clock is moved (e2e/clock-shift.mjs) and the test pages' clocks with it.
// The shift is worked out once here; the test workers inherit it.
const clock = process.env.E2E_CLOCK;
if (clock && !process.env.E2E_CLOCK_SHIFT_MS) {
  process.env.E2E_CLOCK_SHIFT_MS = String(
    Math.round((atLocal(LONDON, clock) - Date.now()) / 1000) * 1000,
  );
}
const shift = process.env.E2E_CLOCK_SHIFT_MS ?? '';

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
    command: `node ${shift ? '--import ./e2e/clock-shift.mjs ' : ''}apps/web/scripts/e2e-server.mjs`,
    url: `http://127.0.0.1:${port}/version.json`,
    // A moved clock needs a server of its own.
    reuseExistingServer: !process.env.CI && !shift,
    timeout: 120_000,
    env: {
      DATA_SOURCE: 'synthetic',
      E2E_PORT: String(port),
      E2E: '1',
      E2E_CLOCK_SHIFT_MS: shift,
      // Google's sample publisher ID (its demo apps'), so /app-ads.txt has its line to check.
      PUBLIC_ADMOB_PUBLISHER_ID: 'pub-3940256099942544',
    },
  },
});
