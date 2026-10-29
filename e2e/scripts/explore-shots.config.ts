import { defineConfig, devices } from '@playwright/test';

/**
 * Снимки И1 (docs/EXPLORE_TZ.md): «Исследовать» и окно элемента, 1440 и 390 px →
 * docs/media/explore/*.webp. Нужны запущенные web и api (сид demo с content/). Запуск из папки e2e:
 * npx playwright test -c scripts/explore-shots.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /explore-shots\.ts$/,
  timeout: 300_000,
  workers: 1,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reducedMotion: 'reduce',
  },
});
