import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { type ConfigKey } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { DB, REDIS } from '../infra/tokens';

const CACHE_TTL_SECONDS = 60;
const cacheKey = (key: ConfigKey) => `app_config:${key}`;

/** Значение заглушки с флагом блокировки продуктива хранится как { value, prodBlocked } (раздел 11). */
function unwrap(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && 'prodBlocked' in value && 'value' in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

/**
 * Значения заглушек раздела 11 из app_config: `config.get('<key>')` (AG-02).
 * Кеш в Redis на 60 с; при недоступности Redis значение читается из БД.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async get<T = unknown>(key: ConfigKey): Promise<T> {
    const cached = await this.readCache(key);
    if (cached !== undefined) return cached as T;

    const [row] = await this.db
      .select({ value: schema.appConfig.value })
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, key));
    if (!row)
      throw new Error(`Config key "${key}" is missing in app_config — run \`pnpm db:seed --set=config\``);

    const value = unwrap(row.value);
    await this.writeCache(key, value);
    return value as T;
  }

  /** Сбросить кеш ключа после подтверждения значения владельцем. */
  async invalidate(key: ConfigKey): Promise<void> {
    try {
      await this.redis.del(cacheKey(key));
    } catch {
      // кеш истечёт сам через CACHE_TTL_SECONDS
    }
  }

  private async readCache(key: ConfigKey): Promise<unknown> {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const raw = await this.redis.get(cacheKey(key));
      return raw === null ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  private async writeCache(key: ConfigKey, value: unknown): Promise<void> {
    try {
      await this.redis.set(cacheKey(key), JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`config cache write failed: ${(err as Error).message}`);
    }
  }
}
