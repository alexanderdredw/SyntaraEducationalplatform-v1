import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { and, eq, sql } from 'drizzle-orm';
import { type Database } from '../src';
import { changesCount, defaultContentDir, IMPORT_USER, importContent, type MediaStore } from '../src/content';
import { migrateUp } from '../src/migrator';
import {
  auditLog,
  mediaFiles,
  questions,
  topicMastery,
  topics,
  topicTranslations,
  topicVersions,
  users,
} from '../src/schema';
import { baseIds, BASE_CODES, runSeed } from '../src/seed';
import { startPostgres } from './pg';

const ALL_TABLES = sql`select table_name as t from information_schema.tables where table_schema = 'public'`;
const CARDIO = 'biology/01-human-anatomy/01-cardiovascular-system';

/** Хранилище в памяти — вместо S3 в integration-тесте. */
function memoryStore(): MediaStore & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    async ensure(key) {
      if (keys.has(key)) return 'exists';
      keys.add(key);
      return 'uploaded';
    },
  };
}

/** Импорт базовой программы content/ (этап 8.6): BR-CNT-01..07, AC-CNT-04..07. */
describe('content import (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  let dir: string;
  let studentId: string;
  const store = memoryStore();

  const rowCounts = async () => {
    const tables = await db.execute<{ t: string }>(ALL_TABLES);
    const result: Record<string, number> = {};
    for (const { t } of tables) {
      const [row] = await db.execute<{ n: string }>(sql.raw(`select count(*) as n from "${t}"`));
      result[t] = Number(row?.n);
    }
    return result;
  };
  const edit = (file: string, from: string, to: string) => {
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain(from);
    writeFileSync(path, text.replace(from, to));
  };

  beforeAll(async () => {
    ({ container, db } = await startPostgres());
    await migrateUp(db);
    // Копия content/ — тесты меняют файлы, не трогая репозиторий.
    dir = mkdtempSync(join(tmpdir(), 'syntara-content-'));
    cpSync(defaultContentDir(), dir, { recursive: true });
    await runSeed(db, 'config');
    const first = await importContent(db, { dir, media: store });
    expect(first.errors).toEqual([]);
    [{ id: studentId } = { id: '' }] = await db
      .insert(users)
      .values({ displayName: 'Ученик', login: 'content-student', isChildSafe: true })
      .returning({ id: users.id });
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await db?.$client.end();
    await container?.stop();
  });

  it('BR-CNT-04, BR-CNT-06 first import: published topics with codes, illustrations in our storage (clean, owner NULL)', async () => {
    const B = await baseIds(db);
    const [cardio] = await db.select().from(topics).where(eq(topics.id, B.topicCardio));
    expect(cardio).toMatchObject({ status: 'published', code: BASE_CODES.topicCardio, position: 1 });
    expect(cardio!.coverMediaId).toBeTruthy();
    const media = await db.select().from(mediaFiles);
    expect(media).toHaveLength(6);
    expect(
      media.every((m) => m.kind === 'illustration' && m.ownerId === null && m.scanStatus === 'clean'),
    ).toBe(true);
    expect(store.keys.size).toBe(6);
    const [version] = await db
      .select()
      .from(topicVersions)
      .where(eq(topicVersions.id, cardio!.publishedVersionId!));
    const snapshot = version!.snapshot as {
      sections: Array<{ code: string; translations: Record<string, unknown> }>;
      translations: Record<string, { needsReview?: boolean }>;
    };
    // RU — 5 разделов аккордеона, EN — ещё «Microcirculation» (эталоны U04/U09).
    expect(snapshot.sections.filter((s) => s.translations.ru)).toHaveLength(5);
    expect(snapshot.sections.filter((s) => s.translations.en)).toHaveLength(6);
    expect(snapshot.translations.kk?.needsReview).toBe(true);
    expect(snapshot.translations.ru?.needsReview).toBeUndefined();
    // BR-CNT-07: автор — системный пользователь «Импорт» без пароля; запуск — в журнале аудита.
    const [author] = await db.select().from(users).where(eq(users.id, version!.createdBy));
    expect(author).toMatchObject({ email: IMPORT_USER.email, status: 'system', passwordHash: null });
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'content.import'));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(author!.id);
    const [kk] = await db
      .select()
      .from(topicTranslations)
      .where(and(eq(topicTranslations.topicId, cardio!.id), eq(topicTranslations.locale, 'kk')));
    expect(kk?.needsReview).toBe(true);
  });

  it('AC-CNT-04 re-running the import without changes changes nothing (rows, versions, audit)', async () => {
    const before = await rowCounts();
    const again = await importContent(db, { dir, media: store });
    expect(again.errors).toEqual([]);
    expect(changesCount(again.summary!)).toBe(0);
    expect(await rowCounts()).toEqual(before);
  });

  it('AC-CNT-05 a changed topic file creates a new published version; progress is kept', async () => {
    const B = await baseIds(db);
    await db
      .insert(topicMastery)
      .values({ studentId, topicId: B.topicCardio, bestPercent: '60', attemptsCount: 1 });
    edit(
      `${CARDIO}/ru.md`,
      'Сердце и сосуды, обеспечивающие кровообращение.',
      'Сердце и сосуды, по которым движется кровь.',
    );
    const result = await importContent(db, { dir, media: store });
    expect(result.errors).toEqual([]);
    expect(result.summary!.topics.versions).toBe(1);
    const [cardio] = await db.select().from(topics).where(eq(topics.id, B.topicCardio));
    const [version] = await db
      .select()
      .from(topicVersions)
      .where(eq(topicVersions.id, cardio!.publishedVersionId!));
    expect(version!.versionNo).toBe(2);
    expect(JSON.stringify(version!.snapshot)).toContain('Сердце и сосуды, по которым движется кровь.');
    expect(await db.select().from(topicMastery).where(eq(topicMastery.topicId, B.topicCardio))).toHaveLength(
      1,
    );
  });

  it('AC-CNT-06 any error in the files: nothing is written, every error is listed with its file', async () => {
    const before = await rowCounts();
    edit(
      `${CARDIO}/ru.md`,
      'Сердце и сосуды, по которым движется кровь.',
      'Новый текст, который не должен попасть в БД.',
    );
    edit(`${CARDIO}/quiz.yaml`, 'difficulty: hard', 'difficulty: impossible');
    const result = await importContent(db, { dir, media: store });
    expect(result.summary).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.stringContaining('quiz.yaml'),
          field: 'questions.4.difficulty',
        }),
      ]),
    );
    expect(await rowCounts()).toEqual(before);
    edit(`${CARDIO}/quiz.yaml`, 'difficulty: impossible', 'difficulty: hard');
    edit(
      `${CARDIO}/ru.md`,
      'Новый текст, который не должен попасть в БД.',
      'Сердце и сосуды, по которым движется кровь.',
    );
  });

  it('BR-CNT-04 a removed question is archived; dry run reports changes without writing', async () => {
    const quiz = readFileSync(join(dir, CARDIO, 'quiz.yaml'), 'utf8');
    writeFileSync(join(dir, CARDIO, 'quiz.yaml'), quiz.slice(0, quiz.indexOf('  - code: pulmonary')));
    const before = await rowCounts();
    const dry = await importContent(db, { dir, media: store, dryRun: true });
    expect(dry.summary!.questions.archived).toBe(1);
    expect(await rowCounts()).toEqual(before);
    await importContent(db, { dir, media: store });
    const [pulmonary] = await db
      .select()
      .from(questions)
      .where(eq(questions.code, `${BASE_CODES.topicCardio}/q/pulmonary`));
    expect(pulmonary!.archivedAt).toBeTruthy();
    writeFileSync(join(dir, CARDIO, 'quiz.yaml'), quiz);
    const restored = await importContent(db, { dir, media: store });
    expect(restored.summary!.questions.updated).toBe(1);
  });

  it('AC-CNT-07 a topic removed from the files is unpublished, not deleted; student progress stays', async () => {
    const B = await baseIds(db);
    await db
      .insert(topicMastery)
      .values({ studentId, topicId: B.topicDigestive, bestPercent: '90', attemptsCount: 1 });
    const digestive = join(dir, 'biology/01-human-anatomy/03-digestive-system');
    const backup = mkdtempSync(join(tmpdir(), 'syntara-topic-'));
    cpSync(digestive, backup, { recursive: true });
    rmSync(digestive, { recursive: true });
    const result = await importContent(db, { dir, media: store });
    expect(result.summary!.topics.unpublished).toBe(1);
    const [row] = await db.select().from(topics).where(eq(topics.id, B.topicDigestive));
    expect(row!.status).toBe('draft');
    expect(
      await db.select().from(topicMastery).where(eq(topicMastery.topicId, B.topicDigestive)),
    ).toHaveLength(1);
    // Тема вернулась в файлы без изменений — снова опубликована той же версией.
    cpSync(backup, digestive, { recursive: true });
    const back = await importContent(db, { dir, media: store });
    expect(back.summary!.topics.republished).toBe(1);
    expect(back.summary!.topics.versions).toBe(0);
    rmSync(backup, { recursive: true, force: true });
  });
});
