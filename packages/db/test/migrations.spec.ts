import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { type Database } from '../src';
import { appliedMigrations, migrateUp, rollback } from '../src/migrator';
import { startPostgres } from './pg';

const count = async (db: Database, query: ReturnType<typeof sql>) =>
  Number((await db.execute<{ n: string }>(query))[0]?.n ?? 0);

/** DoD 6 / AG-09: миграции применяются и откатываются на чистой базе. */
describe('migrations (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;

  beforeAll(async () => {
    ({ container, db } = await startPostgres());
  });

  afterAll(async () => {
    await db?.$client.end();
    await container?.stop();
  });

  const tables = () =>
    count(db, sql`select count(*) as n from information_schema.tables where table_schema = 'public'`);
  const enums = () =>
    count(
      db,
      sql`select count(*) as n from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typtype = 'e'`,
    );

  it('AG-09 applies all migrations on a clean database (section 5: 70 tables, 18 enums)', async () => {
    await migrateUp(db);
    expect(await appliedMigrations(db)).toEqual([
      '0000_extensions_roles',
      '0001_schema',
      '0002_constraints_triggers_rls',
      '0003_app_maintenance_role',
      '0004_self_registration',
      '0005_base_content',
      '0006_subject_position',
      '0007_battle',
      '0008_battle_class_optional',
      '0009_nav_seen',
      '0010_profiles',
      '0011_profile_v2',
      '0012_opt_indexes',
      '0013_subject_chapters',
      '0014_glossary',
      '0015_periodic_table',
    ]);
    expect(await tables()).toBe(70);
    expect(await enums()).toBe(18);
  });

  it('AG-09 rolls back every migration to an empty schema', async () => {
    expect(await rollback(db, Number.MAX_SAFE_INTEGER)).toEqual([
      '0015_periodic_table',
      '0014_glossary',
      '0013_subject_chapters',
      '0012_opt_indexes',
      '0011_profile_v2',
      '0010_profiles',
      '0009_nav_seen',
      '0008_battle_class_optional',
      '0007_battle',
      '0006_subject_position',
      '0005_base_content',
      '0004_self_registration',
      '0003_app_maintenance_role',
      '0002_constraints_triggers_rls',
      '0001_schema',
      '0000_extensions_roles',
    ]);
    expect(await tables()).toBe(0);
    expect(await enums()).toBe(0);
    expect(
      await count(
        db,
        sql`select count(*) as n from pg_roles where rolname in ('app_user', 'app_maintenance')`,
      ),
    ).toBe(0);
    expect(await count(db, sql`select count(*) as n from pg_extension where extname = 'citext'`)).toBe(0);
  });

  it('AG-09 re-applies after a full rollback and supports step-by-step rollback', async () => {
    await migrateUp(db);
    expect(await tables()).toBe(70);
    // 0015 (REQ-PTBL-01, REQ-PTBL-04): столбцы subjects.blocks и topics.element_number; откат убирает только их.
    const columns = () =>
      count(
        db,
        sql`select count(*) as n from information_schema.columns where (table_name, column_name) in (('subjects', 'blocks'), ('topics', 'element_number'))`,
      );
    expect(await columns()).toBe(2);
    expect(await rollback(db, 1)).toEqual(['0015_periodic_table']);
    expect(await columns()).toBe(0);
    // 0014 (REQ-GLOS-01): четыре таблицы глоссария; откат удаляет только их.
    expect(await rollback(db, 1)).toEqual(['0014_glossary']);
    expect(await tables()).toBe(66);
    // 0013 (BR-CHAP-01, AC-CHEM-07): главы — две таблицы и topics.chapter_id; откат убирает их, темы остаются.
    const chapterColumn = () =>
      count(
        db,
        sql`select count(*) as n from information_schema.columns where table_name = 'topics' and column_name = 'chapter_id'`,
      );
    expect(await chapterColumn()).toBe(1);
    expect(await rollback(db, 1)).toEqual(['0013_subject_chapters']);
    expect(await chapterColumn()).toBe(0);
    expect(await tables()).toBe(64);
    // 0011: known_devices (BR-PRF-20) и раздел nav_seen 'profile_completeness'; откат возвращает прежнюю проверку.
    expect(
      await count(
        db,
        sql`select count(*) as n from pg_policies where tablename = 'known_devices' and policyname = 'known_devices_own'`,
      ),
    ).toBe(1);
    // 0012 (OPT-05, О4-6): только индексы — откат удаляет их, таблицы и данные не меняются.
    const optIndexes = () =>
      count(
        db,
        sql`select count(*) as n from pg_indexes where indexname in ('ix_outbox_pending', 'ix_auth_sessions_user',
          'ix_classes_teacher', 'ix_topic_sections_topic', 'ix_assignments_topic', 'ix_questions_quiz',
          'ix_submissions_student', 'ix_notifications_user')`,
      );
    expect(await optIndexes()).toBe(8);
    expect(await rollback(db, 1)).toEqual(['0012_opt_indexes']);
    expect(await optIndexes()).toBe(0);
    expect(await tables()).toBe(64);
    expect(await rollback(db, 1)).toEqual(['0011_profile_v2']);
    expect(await tables()).toBe(63);
    // 0010: профили (5.11) — откат удаляет таблицу и значение 'avatar' перечисления media_kind.
    const avatarKind = () =>
      count(
        db,
        sql`select count(*) as n from pg_enum e join pg_type t on t.oid = e.enumtypid
                     where t.typname = 'media_kind' and e.enumlabel = 'avatar'`,
      );
    expect(await avatarKind()).toBe(1);
    expect(await rollback(db, 1)).toEqual(['0010_profiles']);
    expect(await tables()).toBe(62);
    expect(await avatarKind()).toBe(0);
    // 0009: nav_seen (REQ-NAV-14) с RLS «только свои»; откат удаляет только её.
    expect(
      await count(
        db,
        sql`select count(*) as n from pg_policies where tablename = 'nav_seen' and policyname = 'nav_seen_own'`,
      ),
    ).toBe(1);
    expect(await rollback(db, 1)).toEqual(['0009_nav_seen']);
    expect(await tables()).toBe(61);
    // 0008: класс сессии Battle необязателен (Q-BTL-01); откат возвращает NOT NULL.
    const classNullable = () =>
      count(
        db,
        sql`select count(*) as n from information_schema.columns where table_name = 'battle_sessions' and column_name = 'class_id' and is_nullable = 'YES'`,
      );
    expect(await classNullable()).toBe(1);
    expect(await rollback(db, 1)).toEqual(['0008_battle_class_optional']);
    expect(await classNullable()).toBe(0);
    // 0007: таблицы, функции RLS и перечисления Battle (5.9).
    expect(await rollback(db, 1)).toEqual(['0007_battle']);
    expect(await tables()).toBe(55);
    expect(await enums()).toBe(16);
    expect(
      await count(
        db,
        sql`select count(*) as n from pg_proc where proname in ('battle_session_visible', 'app_user_context')`,
      ),
    ).toBe(0);
    expect(await rollback(db, 1)).toEqual(['0006_subject_position']);
    expect(
      await count(
        db,
        sql`select count(*) as n from information_schema.columns where table_name = 'subjects' and column_name = 'position'`,
      ),
    ).toBe(0);
    expect(await rollback(db, 1)).toEqual(['0005_base_content']);
    expect(
      await count(
        db,
        sql`select count(*) as n from information_schema.columns where column_name = 'code' and table_name in ('subjects', 'topics', 'topic_sections', 'questions')`,
      ),
    ).toBe(0);
    expect(await rollback(db, 1)).toEqual(['0004_self_registration']);
    expect(
      await count(
        db,
        sql`select count(*) as n from information_schema.columns where table_name = 'users' and column_name in ('email_verified_at', 'must_change_password')`,
      ),
    ).toBe(0);
    expect(await rollback(db, 2)).toEqual(['0003_app_maintenance_role', '0002_constraints_triggers_rls']);
    expect(
      await count(db, sql`select count(*) as n from pg_trigger where tgname = 'trg_assignments_topic'`),
    ).toBe(0);
    await migrateUp(db);
    expect(await appliedMigrations(db)).toHaveLength(16);
  });

  it('AC-PRF-01 0010 moves every existing name into the profile and keeps display_name; rollback keeps names', async () => {
    // Откат по 0010 включительно; более поздние миграции — первыми.
    const steps = async () => (await appliedMigrations(db)).length - 10;
    expect((await rollback(db, await steps())).slice(-3)).toEqual([
      '0012_opt_indexes',
      '0011_profile_v2',
      '0010_profiles',
    ]);
    const names = [
      'Асель',
      'Ерлан Сапарович Нурланов',
      '  Айгерім   Қасымова ',
      "O'Brien Mary-Jane",
      'Ж'.repeat(45) + ' Б',
    ];
    for (const [i, name] of names.entries()) {
      await db.execute(
        sql`insert into users (id, email, display_name) values (gen_random_uuid(), ${`prf${i}@example.com`}, ${name})`,
      );
    }
    await migrateUp(db);
    const rows = await db.execute<{
      display_name: string;
      first_name: string;
      last_name: string | null;
      avatar_kind: string;
      avatar_color: string;
    }>(
      sql`select u.display_name, p.first_name, p.last_name, p.avatar_kind, p.avatar_color
          from users u join user_profiles p on p.user_id = u.id where u.email like 'prf%' order by u.email`,
    );
    expect(rows.map((r) => [r.display_name, r.first_name, r.last_name])).toEqual([
      ['Асель', 'Асель', null],
      ['Ерлан Сапарович Нурланов', 'Ерлан', 'Сапарович Нурланов'],
      ['  Айгерім   Қасымова ', 'Айгерім', 'Қасымова'],
      ["O'Brien Mary-Jane", "O'Brien", 'Mary-Jane'],
      ['Ж'.repeat(45) + ' Б', 'Ж'.repeat(40), 'Б'],
    ]);
    expect(rows.every((r) => r.avatar_kind === 'initials' && r.avatar_color.length > 0)).toBe(true);
    expect(
      await count(
        db,
        sql`select count(*) as n from users u left join user_profiles p on p.user_id = u.id where p.user_id is null`,
      ),
    ).toBe(0);
    await rollback(db, await steps());
    expect(await count(db, sql`select count(*) as n from users where email like 'prf%'`)).toBe(names.length);
    await migrateUp(db);
  });
});
