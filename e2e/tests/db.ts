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

/** Имитация сессии Battle, запущенной до решения Q-BTL-01 (тогда класс выбирался при запуске). */
export async function setBattleSessionClass(sessionId: string, classId: string): Promise<void> {
  const sql = postgres(env('DATABASE_URL'), { max: 1 });
  try {
    await sql`UPDATE battle_sessions SET class_id = ${classId} WHERE id = ${sessionId}`;
  } finally {
    await sql.end();
  }
}

/** Файлы учителя (media_files): имя для пользователя и ключ объекта в хранилище (7.8, BR-FILE-07). */
export async function mediaFilesOf(
  ownerEmail: string,
): Promise<{ originalName: string; storageKey: string; kind: string; scanStatus: string }[]> {
  const sql = postgres(env('DATABASE_URL'), { max: 1 });
  try {
    return await sql`
      SELECT m.original_name AS "originalName", m.storage_key AS "storageKey", m.kind, m.scan_status AS "scanStatus"
      FROM media_files m JOIN users u ON u.id = m.owner_id
      WHERE u.email = ${ownerEmail} ORDER BY m.created_at`;
  } finally {
    await sql.end();
  }
}

/**
 * Картинка-аватар учителя (BR-PRF-03) без загрузки и проверки worker — для сценария сброса поддержкой
 * (API-SUP-09): запись media_files (kind = 'avatar', clean) и профиль с avatar_kind = 'photo'.
 */
export async function givePhotoAvatar(userId: string): Promise<void> {
  // prepare: false — как в api: локально DATABASE_URL ведёт через PgBouncer (режим transaction).
  const sql = postgres(env('DATABASE_URL'), { max: 1, prepare: false });
  try {
    await sql`
      WITH m AS (
        INSERT INTO media_files (id, owner_id, kind, original_name, mime, size_bytes, storage_key, scan_status)
        VALUES (gen_random_uuid(), ${userId}, 'avatar', 'e2e.webp', 'image/webp', 100,
                ${`avatar/e2e-${userId}-${Date.now()}`}, 'clean')
        RETURNING id
      )
      UPDATE user_profiles SET avatar_kind = 'photo', avatar_media_id = (SELECT id FROM m) WHERE user_id = ${userId}`;
  } finally {
    await sql.end();
  }
}

/** События обучения ученика за день `daysAgo` назад (полдень Алматы) — календарь активности (REQ-PRF-21). */
export async function addLearningEvents(
  studentId: string,
  type: 'lesson_opened' | 'quiz_finished',
  daysAgo: number,
  count: number,
): Promise<void> {
  const sql = postgres(env('DATABASE_URL'), { max: 1, prepare: false });
  try {
    // День считается по Алматы (UTC+5): с 19:00 до 24:00 UTC там уже следующие сутки.
    const at = new Date(Date.now() + 5 * 3_600_000 - daysAgo * 86_400_000);
    at.setUTCHours(7, 0, 0, 0);
    for (let i = 0; i < count; i++) {
      await sql`
        INSERT INTO learning_events (id, student_id, type, occurred_at, idempotency_key)
        VALUES (gen_random_uuid(), ${studentId}, ${type}, ${at}, ${crypto.randomUUID()})`;
    }
  } finally {
    await sql.end();
  }
}

/**
 * Таблица, загруженная до запрета BR-FILE-09 (clean), прикреплённая к теме учителя последней — без загрузки:
 * новые таблицы сайт не принимает.
 */
export async function attachLegacySpreadsheet(topicId: string, ownerEmail: string): Promise<void> {
  const sql = postgres(env('DATABASE_URL'), { max: 1, prepare: false });
  try {
    await sql`
      WITH m AS (
        INSERT INTO media_files (id, owner_id, kind, original_name, mime, size_bytes, storage_key, scan_status)
        SELECT gen_random_uuid(), u.id, 'material', 'Оценки.xlsx',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100,
               ${`material/e2e-legacy-${Date.now()}`}, 'clean'
        FROM users u WHERE u.email = ${ownerEmail}
        RETURNING id
      )
      INSERT INTO topic_materials (topic_id, media_id, position)
      SELECT ${topicId}, m.id, COALESCE((SELECT max(position) FROM topic_materials WHERE topic_id = ${topicId}), 0) + 1
      FROM m`;
  } finally {
    await sql.end();
  }
}
