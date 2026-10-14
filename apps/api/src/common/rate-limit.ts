import {
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import {
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import Redis from 'ioredis';
import { type Env } from '../config/env';
import { REDIS } from '../infra/tokens';
import { ApiException } from './api-exception';

/**
 * Лимиты API-GEN-06 (Redis): формы — 5 в минуту на IP; вход — 10 за 15 минут на IP+email.
 * Проверка кода класса и ИИ добавятся в итерациях 5 и 6.
 */
export const RATE_LIMITS = {
  forms: { limit: 5, ttl: 60_000 },
  login: { limit: 10, ttl: 15 * 60_000 },
} as const;
export type RateLimitName = keyof typeof RATE_LIMITS;

const ip = (req: Record<string, unknown>) => String(req.ip ?? 'unknown');
/** Счётчик общий для всех маршрутов лимита (например, обе публичные формы — 5 в минуту на IP вместе). */
const sharedKey = (_context: ExecutionContext, tracker: string, name: string) => `${name}:${tracker}`;

/** Фиксированное окно в Redis: счётчик с TTL окна; после превышения — блок до конца окна. */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {hits, ttl, 1, blocked} end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const [hits, ttlMs, blocked, blockMs] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `rl:${name}:${key}`,
        `rl:${name}:${key}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.max(1, Math.ceil(ttlMs / 1000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.max(1, Math.ceil(blockMs / 1000)),
      };
    } catch (err) {
      // Недоступность Redis не должна ломать формы и вход: пропускаем запрос и пишем предупреждение.
      this.logger.warn(`rate limit storage unavailable: ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}

export function throttlerOptions(env: Env, storage: ThrottlerStorage): ThrottlerModuleOptions {
  return {
    storage,
    skipIf: () => env.RATE_LIMITS_DISABLED,
    throttlers: [
      { name: 'forms', ...RATE_LIMITS.forms, getTracker: ip, generateKey: sharedKey },
      {
        name: 'login',
        ...RATE_LIMITS.login,
        generateKey: sharedKey,
        getTracker: (req) => {
          const body = req.body as { email?: unknown } | undefined;
          const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
          return `${ip(req)}|${email}`;
        },
      },
    ],
  };
}

/** Ответ 429 в формате API-GEN-04 с retryAfterSeconds (API-GEN-06). */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ApiException(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Too many requests',
      undefined,
      detail.timeToBlockExpire,
    );
  }
}

/** Применяет к маршруту только указанный лимит. */
export function RateLimit(name: RateLimitName) {
  const others = Object.fromEntries(
    (Object.keys(RATE_LIMITS) as RateLimitName[]).filter((n) => n !== name).map((n) => [n, true]),
  );
  return applyDecorators(
    SkipThrottle(others),
    UseGuards(RateLimitGuard),
    ApiTooManyRequestsResponse({ description: 'Превышен лимит; retryAfterSeconds в теле' }),
  );
}
