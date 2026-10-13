import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Database } from '../src';

/** Чистый PostgreSQL 16 в контейнере (Testcontainers) — как в docker-compose. */
export async function startPostgres(): Promise<{ container: StartedPostgreSqlContainer; db: Database }> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  return { container, db: createDb(container.getConnectionUri(), { max: 2 }) };
}

/** SQLSTATE ошибки PostgreSQL из исключения drizzle/postgres.js. */
export async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
}
