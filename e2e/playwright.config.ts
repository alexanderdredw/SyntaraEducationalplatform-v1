import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * Playwright (раздел 2.1). Набор браузеров REQ-NFR-COMP-01 и визуальные эталоны — итерация 11;
 * сейчас — Chromium на ширинах 1440 и 320 (REQ-GEN-SHELL-07).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-320', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 640 } } },
  ],
  webServer: {
    command: 'pnpm --filter @syntara/web start',
    url: `${baseURL}/ru`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
