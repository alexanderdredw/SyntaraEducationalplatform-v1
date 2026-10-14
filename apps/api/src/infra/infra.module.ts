import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { createDb, type Database } from '@syntara/db';
import { AppConfigService } from '../config/app-config.service';
import { ENV, type Env, loadEnv } from '../config/env';
import { FeatureFlagsService } from '../config/feature-flags.service';
import { IdempotencyService } from '../common/idempotency';
import { RedisThrottlerStorage } from '../common/rate-limit';
import { DB, REDIS } from './tokens';

export { DB, REDIS };

/** Подключения к PostgreSQL и Redis; создаются лениво, закрываются при остановке. */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv(process.env) },
    { provide: DB, inject: [ENV], useFactory: (env: Env) => createDb(env.DATABASE_URL) },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        const client = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
        // Недоступность Redis видна в /api/health; без слушателя ioredis пишет «Unhandled error event».
        let lastWarnAt = 0;
        client.on('error', (err: Error) => {
          if (Date.now() - lastWarnAt < 30_000) return;
          lastWarnAt = Date.now();
          new Logger('Redis').warn(`Redis connection error: ${err.message}`);
        });
        return client;
      },
    },
    AppConfigService,
    FeatureFlagsService,
    IdempotencyService,
    RedisThrottlerStorage,
  ],
  exports: [ENV, DB, REDIS, AppConfigService, FeatureFlagsService, IdempotencyService, RedisThrottlerStorage],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.db.$client.end({ timeout: 5 }), this.redis.quit()]);
  }
}
