import { z } from 'zod';

/**
 * Переменные окружения api (раздел 2.3 SPEC). Секреты — только здесь (AG-10): модуль не импортируется в web.
 * Приложение не стартует, если обязательная переменная отсутствует или некорректна.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    S3_ENDPOINT: z.url(),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    /**
     * Адрес хранилища для браузера (подписанные ссылки на загрузку и чтение, 7.8). По умолчанию — S3_ENDPOINT.
     * TODO(OWNER): публичный адрес S3 в продуктиве (Q-27) — S3_ENDPOINT внутри сети браузеру недоступен.
     */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    SESSION_SECRET: z.string().min(64, 'SESSION_SECRET must be at least 64 characters'),
    APP_BASE_URL: z.url(),
    LLM_PROVIDER: z.enum(['mock', 'openai-compatible', 'anthropic']).default('mock'),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().optional(),
    SUPPORT_EMAIL: z.email().optional(),
    PLATFORM_TZ: z.string().default('Asia/Almaty'),
    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    /**
     * Только для e2e: отключает лимиты API-GEN-06, чтобы сценарии с одного IP не упирались в 5 отправок в минуту.
     * В продуктиве запрещено (проверка ниже); сами лимиты покрыты integration-тестами.
     */
    RATE_LIMITS_DISABLED: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    /**
     * Только для тестов (решение Q-13): API-T-11 возвращает детерминированный черновик вместо «недоступен»,
     * чтобы проверить AC-TCH-04 без настоящего поставщика ИИ. В продуктиве запрещено (проверка ниже).
     */
    AI_DRAFT_FIXTURE: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.AI_DRAFT_FIXTURE), {
    path: ['AI_DRAFT_FIXTURE'],
    message: 'must not be set in production',
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.RATE_LIMITS_DISABLED), {
    path: ['RATE_LIMITS_DISABLED'],
    message: 'must not be set in production',
  });

export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  // Пустые строки из .env считаем отсутствующими значениями.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Печатаем только имена переменных, не значения (REQ-NFR-SEC-07).
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return parsed.data;
}
