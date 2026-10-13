// `pnpm db:migrate`: применяет миграции из packages/db/migrations (AG-09).
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { join } from 'node:path';
import { createDb } from './index';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: join(__dirname, '..', 'migrations') });
    console.warn('[db] migrations applied');
  } finally {
    await db.$client.end();
  }
}

main().catch((err: unknown) => {
  console.error('[db] migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
