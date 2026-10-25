import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };
export { sql } from 'drizzle-orm';
export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

/** Подключение к PostgreSQL. `prepare: false` — совместимость с PgBouncer в режиме transaction. */
export function createDb(url: string, options: { max?: number } = {}): Database {
  const client = postgres(url, { max: options.max ?? 10, prepare: false });
  return drizzle(client, { schema });
}
export { battleAvatarOf, profileFor, stableAvatarColor } from './profiles';
