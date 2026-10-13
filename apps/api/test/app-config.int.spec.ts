import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { createDb, schema, type Database } from '@syntara/db';
import { migrateUp } from '@syntara/db/migrator';
import { runSeed } from '@syntara/db/seed';
import { AppConfigService } from '../src/config/app-config.service';
import { DB, REDIS } from '../src/infra/tokens';

/** Integration: config.get('<key>') читает app_config (раздел 11) и кеширует в Redis. */
describe('AppConfigService (integration)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let db: Database;
  let redis: Redis;
  let config: AppConfigService;

  beforeAll(async () => {
    [pg, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    db = createDb(pg.getConnectionUri(), { max: 2 });
    redis = new Redis(redisContainer.getConnectionUrl());
    await migrateUp(db);
    await runSeed(db, 'config');
    const moduleRef = await Test.createTestingModule({
      providers: [AppConfigService, { provide: DB, useValue: db }, { provide: REDIS, useValue: redis }],
    }).compile();
    config = moduleRef.get(AppConfigService);
  });

  afterAll(async () => {
    await redis?.quit();
    await db?.$client.end();
    await Promise.all([pg?.stop(), redisContainer?.stop()]);
  });

  it('AG-02 returns section 11 values by key', async () => {
    expect(await config.get('i18n.enabled_locales')).toEqual(['ru', 'kk', 'en']);
    expect(await config.get('class.code')).toEqual({
      length: 6,
      alphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
      ttl_days: 30,
    });
  });

  it('PH-09 unwraps prodBlocked values', async () => {
    expect(await config.get('support.email')).toBe('support@syntara-edu.me');
  });

  it('caches values in Redis and re-reads the database after invalidate()', async () => {
    await config.get('ai.mode');
    expect(await redis.get('app_config:ai.mode')).toBe('"mock"');
    await db.update(schema.appConfig).set({ value: 'disabled' }).where(eq(schema.appConfig.key, 'ai.mode'));
    expect(await config.get('ai.mode')).toBe('mock');
    await config.invalidate('ai.mode');
    expect(await config.get('ai.mode')).toBe('disabled');
  });
});
