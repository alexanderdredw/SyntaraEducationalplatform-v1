import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { createDb, type Database } from '@syntara/db';
import { migrateUp } from '@syntara/db/migrator';
import { runSeed, type SeedSet } from '@syntara/db/seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/setup';

export interface TestStack {
  app: INestApplication;
  db: Database;
  stop: () => Promise<void>;
}

/** Integration: Postgres 16 + Redis 7 (Testcontainers), миграции, seed и полное приложение api. */
export async function startStack(
  seed: SeedSet = 'demo',
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
  /** Переопределение переменных окружения (например, S3 из контейнера MinIO). */
  env: Record<string, string> = {},
): Promise<TestStack> {
  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    SESSION_SECRET: 'x'.repeat(64),
    APP_BASE_URL: 'http://127.0.0.1:3000',
    AI_DRAFT_FIXTURE: 'false',
    ...env,
  });
  const db = createDb(pg.getConnectionUri(), { max: 2 });
  await migrateUp(db);
  await runSeed(db, seed);

  const moduleRef = await override(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();

  return {
    app,
    db,
    stop: async () => {
      await app.close();
      await db.$client.end();
      await Promise.all([pg.stop(), redis.stop()]);
    },
  };
}
