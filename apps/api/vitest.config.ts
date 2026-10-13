import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// SWC нужен для emitDecoratorMetadata (DI NestJS) — esbuild его не поддерживает.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
