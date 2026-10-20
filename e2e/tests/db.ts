import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';

/** Переменные окружения api: в CI — из окружения job, локально — из корневого .env. */
function env(name: 'DATABASE_URL' | 'SESSION_SECRET'): string {
  if (!process.env[name]) {
    try {
      process.loadEnvFile(join(__dirname, '..', '..', '.env'));
    } catch {
      // .env нет — значение должно прийти из окружения.
    }
  }
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for e2e database helpers`);
  return value;
}

/**
 * Имитация старого кода класса (выпущенного до BR-CODE-03), который выглядит как код Battle (`LLLDDD`):
 * новые коды такого вида не выпускаются, поэтому строка вставляется напрямую — хеш как в ClassCodesService.
 */
export async function insertLegacyClassCode(classId: string, code: string): Promise<void> {
  const sql = postgres(env('DATABASE_URL'), { max: 1 });
  try {
    const hash = createHmac('sha256', env('SESSION_SECRET')).update(`class-code:${code}`).digest();
    await sql`
      INSERT INTO class_invite_codes (id, class_id, code_hash, expires_at, created_by)
      SELECT gen_random_uuid(), id, ${hash}, now() + interval '1 day', teacher_id FROM classes WHERE id = ${classId}`;
  } finally {
    await sql.end();
  }
}
