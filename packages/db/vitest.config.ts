import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Интеграционные тесты (импорт содержания, seed) в CI идут параллельно с тестами других пакетов — запас по времени.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
