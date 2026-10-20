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
import { AppConfigService } from '../config/app-config.service';
import { REDIS } from '../infra/tokens';
import { ApiException } from './api-exception';

/**
 * Лимиты API-GEN-06 (Redis): формы — 5 в минуту на IP; вход — 10 за 15 минут на IP+email;
 * проверка кода класса — 10 за 15 минут на IP; ИИ — PH-20 `ai.limits` (per_minute и per_day): публичный помощник —
 * на IP, учебный ИИ — на ученика (класс в школе часто выходит в интернет с одного IP).
 */
export const RATE_LIMITS = {
  forms: { limit: 5, ttl: 60_000 },
  login: { limit: 10, ttl: 15 * 60_000 },
  join: { limit: 10, ttl: 15 * 60_000 },
  // BR-BTL-01: ввод кода Battle — 10 за 10 минут на ученика и 30 на IP.
  battleJoinStudent: { limit: 10, ttl: 10 * 60_000 },
  battleJoinIp: { limit: 30, ttl: 10 * 60_000 },
} as const;

/** Группа лимитов маршрута → имена счётчиков (у ИИ — два окна). */
export const RATE_LIMIT_GROUPS = {
  forms: ['forms'],
  login: ['login'],
  join: ['join'],
  ai: ['ai_minute', 'ai_day'],
  aiStudent: ['ai_student_minute', 'ai_student_day'],
  battleJoin: ['battle_join_student', 'battle_join_ip'],
} as const;
export type RateLimitName = keyof typeof RATE_LIMIT_GROUPS;
const ALL_THROTTLERS = Object.values(RATE_LIMIT_GROUPS).flat();

interface AiLimits {
  per_minute: number;
  per_day: number;
}

const ip = (req: Record<string, unknown>) => String(req.ip ?? 'unknown');
/** Ученик сессии (SessionGuard выполняется раньше); без сессии маршрут всё равно отдаст 401. */
const student = (req: Record<string, unknown>) => (req.user as { id?: string } | undefined)?.id ?? ip(req);
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

export function throttlerOptions(
  env: Env,
  storage: ThrottlerStorage,
  config: AppConfigService,
): ThrottlerModuleOptions {
  const ai = () => config.get<AiLimits>('ai.limits');
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
      { name: 'join', ...RATE_LIMITS.join, getTracker: ip, generateKey: sharedKey },
      {
        name: 'battle_join_student',
        ...RATE_LIMITS.battleJoinStudent,
        getTracker: student,
        generateKey: sharedKey,
      },
      { name: 'battle_join_ip', ...RATE_LIMITS.battleJoinIp, getTracker: ip, generateKey: sharedKey },
      {
        name: 'ai_minute',
        ttl: 60_000,
        limit: async () => (await ai()).per_minute,
        getTracker: ip,
        generateKey: sharedKey,
      },
      {
        name: 'ai_day',
        ttl: 24 * 60 * 60_000,
        limit: async () => (await ai()).per_day,
        getTracker: ip,
        generateKey: sharedKey,
      },
      {
        name: 'ai_student_minute',
        ttl: 60_000,
        limit: async () => (await ai()).per_minute,
        getTracker: student,
        generateKey: sharedKey,
      },
      {
        name: 'ai_student_day',
        ttl: 24 * 60 * 60_000,
        limit: async () => (await ai()).per_day,
        getTracker: student,
        generateKey: sharedKey,
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

/** Применяет к маршруту только счётчики указанной группы. */
export function RateLimit(name: RateLimitName) {
  const own: readonly string[] = RATE_LIMIT_GROUPS[name];
  const others = Object.fromEntries(ALL_THROTTLERS.filter((n) => !own.includes(n)).map((n) => [n, true]));
  return applyDecorators(
    SkipThrottle(others),
    UseGuards(RateLimitGuard),
    ApiTooManyRequestsResponse({ description: 'Превышен лимит; retryAfterSeconds в теле' }),
  );
}
