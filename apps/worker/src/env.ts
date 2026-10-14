import { z } from 'zod';

/** Переменные окружения worker (раздел 2.3 SPEC). Секреты SMTP — только здесь (AG-10). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.url(),
  DATABASE_URL: z.url(),
  SMTP_URL: z.url(),
  MAIL_FROM: z.email(),
  PLATFORM_TZ: z.string().default('Asia/Almaty'),
  // CLAMD_HOST, OLEVBA_URL станут обязательными вместе с проверкой файлов (итерация 7).
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
