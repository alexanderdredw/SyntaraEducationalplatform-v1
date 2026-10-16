import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Компоненты в тестах рендерятся на сервере (renderToStaticMarkup) — нужен автоматический JSX-runtime.
  esbuild: { jsx: 'automatic' },
  test: { include: ['**/*.spec.ts'], exclude: ['node_modules', '.next', '.next-*'] },
});
