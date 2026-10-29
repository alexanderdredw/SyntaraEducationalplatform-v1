import { defineConfig, devices } from '@playwright/test';

/**
 * Снимки S1b (docs/SCIENTISTS_TZ.md): окно учёного с данными, 1440 и 390 px →
 * docs/media/scientists/s1b-*.webp. Нужны запущенные web и api (сид demo с content/). Запуск из папки e2e:
 * npx playwright test -c scripts/s1b-shots.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /s1b-shots\.ts$/,
  timeout: 300_000,
  workers: 1,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reducedMotion: 'reduce',
  },
});
