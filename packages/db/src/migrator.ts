import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { type Database } from './index';

/**
 * Применение и откат миграций (AG-09, DoD 6).
 * Вперёд — стандартный мигратор drizzle (журнал migrations/meta/_journal.json, таблица drizzle.__drizzle_migrations).
 * Назад — файл migrations/down/<tag>.sql для каждой миграции: drizzle-kit откаты не генерирует.
 */
export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function journal(): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

export async function migrateUp(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/** Теги применённых миграций в порядке применения. */
export async function appliedMigrations(db: Database): Promise<string[]> {
  const exists = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!exists[0]?.exists) return [];
  const rows = await db.execute<{ created_at: string }>(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at`,
  );
  const byWhen = new Map(journal().map((e) => [String(e.when), e.tag]));
  return rows.map((r) => byWhen.get(String(r.created_at)) ?? `unknown:${r.created_at}`);
}

/** Откатывает `steps` последних миграций (по умолчанию одну). Возвращает теги откаченных. */
export async function rollback(db: Database, steps = 1): Promise<string[]> {
  const entries = journal();
  const rolledBack: string[] = [];
  for (let i = 0; i < steps; i++) {
    const applied = await appliedMigrations(db);
    const tag = applied.at(-1);
    if (!tag) break;
    const entry = entries.find((e) => e.tag === tag);
    if (!entry) throw new Error(`Migration ${tag} is not in the journal`);
    const downSql = readFileSync(join(MIGRATIONS_DIR, 'down', `${tag}.sql`), 'utf8');
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(downSql));
      await tx.execute(sql`delete from drizzle.__drizzle_migrations where created_at = ${entry.when}`);
    });
    rolledBack.push(tag);
  }
  return rolledBack;
}
