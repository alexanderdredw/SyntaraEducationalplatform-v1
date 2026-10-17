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

  it('AG-09 applies all migrations on a clean database (section 5: 55 tables, 16 enums)', async () => {
    await migrateUp(db);
    expect(await appliedMigrations(db)).toEqual([
      '0000_extensions_roles',
      '0001_schema',
      '0002_constraints_triggers_rls',
      '0003_app_maintenance_role',
      '0004_self_registration',
      '0005_base_content',
      '0006_subject_position',
    ]);
    expect(await tables()).toBe(55);
    expect(await enums()).toBe(16);
  });

  it('AG-09 rolls back every migration to an empty schema', async () => {
    expect(await rollback(db, Number.MAX_SAFE_INTEGER)).toEqual([
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
    expect(await tables()).toBe(55);
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
    expect(await appliedMigrations(db)).toHaveLength(7);
  });
});
