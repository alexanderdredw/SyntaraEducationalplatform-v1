import { z } from 'zod';

/** Переменные окружения worker (раздел 2.3 SPEC). Секреты SMTP — только здесь (AG-10). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.url(),
  DATABASE_URL: z.url(),
  SMTP_URL: z.url(),
  MAIL_FROM: z.email(),
  APP_BASE_URL: z.url(),
  PLATFORM_TZ: z.string().default('Asia/Almaty'),
  // Проверка файлов (BR-FILE-03): хранилище, ClamAV (host:port) и сервис olevba.
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  CLAMD_HOST: z.string().regex(/^[^:\s]+:\d+$/),
  OLEVBA_URL: z.url(),
});
export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Только имена переменных, без значений (REQ-NFR-SEC-07).
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return parsed.data;
}
