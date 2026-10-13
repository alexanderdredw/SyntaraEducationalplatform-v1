import { defineConfig } from 'drizzle-kit';

// Схема БД меняется только миграциями (AG-09). Таблицы раздела 5 — итерация 2.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
});
