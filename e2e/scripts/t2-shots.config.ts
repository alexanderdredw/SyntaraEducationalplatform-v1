import { defineConfig, devices } from '@playwright/test';

/**
 * Снимки T2 (docs/TESTS_TZ.md): каждый тип вопроса квиза «Проверь знания» и режимы, 1440 и 390 px →
 * docs/media/tests/t2-*.webp. Нужны запущенные web и api (сид demo с content/). Запуск из папки e2e:
 * npx playwright test -c scripts/t2-shots.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /tests-t2-shots\.ts$/,
  timeout: 600_000,
  workers: 1,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reducedMotion: 'reduce',
  },
});
