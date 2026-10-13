import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { CONFIG_KEYS } from '@syntara/shared';
import { type Database } from '../src';
import { migrateUp } from '../src/migrator';
import { answerOptions, appConfig, badgeTranslations, badges, levelTranslations, users } from '../src/schema';
import { loadConfigSeed, runSeed } from '../src/seed';
import { startPostgres } from './pg';

const ALL_TABLES = sql`select table_name as t from information_schema.tables where table_schema = 'public'`;

describe('seed (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;

  beforeAll(async () => {
    ({ container, db } = await startPostgres());
    await migrateUp(db);
  });

  afterAll(async () => {
    await db?.$client.end();
    await container?.stop();
  });

  const rowCounts = async () => {
    const tables = await db.execute<{ t: string }>(ALL_TABLES);
    const result: Record<string, number> = {};
    for (const { t } of tables) {
      const [row] = await db.execute<{ n: string }>(sql.raw(`select count(*) as n from "${t}"`));
      result[t] = Number(row?.n);
    }
    return result;
  };

  it('PH-01..PH-44 config.json holds exactly the section 11 keys with their PH-IDs', () => {
    const entries = loadConfigSeed();
    expect(entries.map((e) => e.key).sort()).toEqual(Object.keys(CONFIG_KEYS).sort());
    for (const e of entries) expect(e.note).toBe(CONFIG_KEYS[e.key as keyof typeof CONFIG_KEYS].ph);
    const enabled = entries.find((e) => e.key === 'i18n.enabled_locales');
    expect(enabled?.value).toEqual(['ru', 'kk', 'en']);
  });

  it('AG-02 seed config stores every placeholder with needs_confirmation = true', async () => {
    await runSeed(db, 'config');
    const rows = await db.select().from(appConfig);
    expect(rows).toHaveLength(Object.keys(CONFIG_KEYS).length);
    expect(rows.every((r) => r.needsConfirmation && r.note?.startsWith('PH-'))).toBe(true);
    const email = rows.find((r) => r.key === 'support.email');
    expect(email?.value).toEqual({ value: 'support@syntara-edu.me', prodBlocked: true });
  });

  it('AG-02 seed config does not overwrite a value already confirmed by the owner', async () => {
    await db
      .update(appConfig)
      .set({ value: 'confirmed@syntara-edu.me', needsConfirmation: false, confirmedBy: 'owner' })
      .where(eq(appConfig.key, 'support.email'));
    await runSeed(db, 'config');
    const [row] = await db.select().from(appConfig).where(eq(appConfig.key, 'support.email'));
    expect(row?.value).toBe('confirmed@syntara-edu.me');
  });

  it('BR-BDG-01, BR-XP-03 seed demo: 12 badges with RU titles from SPEC, level 1 «Новичок»', async () => {
    await runSeed(db, 'demo');
    expect(await db.select().from(badges)).toHaveLength(12);
    const ru = await db.select().from(badgeTranslations).where(eq(badgeTranslations.locale, 'ru'));
    expect(ru.map((b) => b.title)).toEqual(
      expect.arrayContaining(['Первый шаг', 'Тема освоена', 'Работа над ошибками', 'Легенда']),
    );
    const [level1] = await db
      .select()
      .from(levelTranslations)
      .where(sql`${levelTranslations.level} = 1 and ${levelTranslations.locale} = 'ru'`);
    expect(level1?.title).toBe('Новичок');
  });

  it('BR-QZ-09, PH-02 seed demo: one demo question with exactly one correct option', async () => {
    const options = await db.select().from(answerOptions);
    expect(options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  it('REQ-NFR-SEC-02 dev accounts store Argon2id hashes, not passwords', async () => {
    const rows = await db.select({ hash: users.passwordHash }).from(users);
    expect(rows.every((r) => r.hash === null || r.hash.startsWith('$argon2id$'))).toBe(true);
  });

  it('seed sets are idempotent: re-running visual changes no row counts', async () => {
    await runSeed(db, 'visual');
    const first = await rowCounts();
    await runSeed(db, 'visual');
    expect(await rowCounts()).toEqual(first);
    expect(first.users).toBeGreaterThan(0);
  });

  it('AG-08 seed demo/visual refuse to run in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(runSeed(db, 'demo')).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
