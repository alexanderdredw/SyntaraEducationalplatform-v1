import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, notInArray, sql } from 'drizzle-orm';
import { getMessage, type Locale, type Messages, type TopicSnapshot } from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Database } from '../index';
import {
  answerOptions,
  answerOptionTranslations,
  attemptAnswers,
  auditLog,
  catalogSections,
  catalogSectionTranslations,
  glossarySections,
  glossarySectionTranslations,
  glossaryTerms,
  glossaryTermTranslations,
  mediaFiles,
  questions,
  questionTranslations,
  quizzes,
  subjectChapters,
  subjectChapterTranslations,
  subjects,
  subjectTranslations,
  topics,
  topicSections,
  topicSectionTranslations,
  topicTranslations,
  topicVersions,
  users,
} from '../schema';
import { type ContentCatalog, CONTENT_LOCALES, type QuestionModel, type TopicModel } from './format';
import { type MediaStore } from './images';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** BR-CNT-07: системный пользователь «Импорт» — автор версий базовых уроков; без пароля и ролей, войти нельзя. */
export const IMPORT_USER = {
  email: 'content-import@syntara.invalid',
  displayName: 'Импорт',
  status: 'system',
};

export interface ImportSummary {
  sections: { created: number; updated: number };
  subjects: { created: number; updated: number; archived: number };
  chapters: { created: number; updated: number; removed: number };
  /** Разделы и термины глоссария (REQ-GLOS-01). */
  glossary: { created: number; updated: number; removed: number };
  topics: { created: number; updated: number; versions: number; unpublished: number; republished: number };
  questions: { created: number; updated: number; archived: number };
  media: { uploaded: number; reused: number; skipped: number };
}

export const emptySummary = (): ImportSummary => ({
  sections: { created: 0, updated: 0 },
  subjects: { created: 0, updated: 0, archived: 0 },
  chapters: { created: 0, updated: 0, removed: 0 },
  glossary: { created: 0, updated: 0, removed: 0 },
  topics: { created: 0, updated: 0, versions: 0, unpublished: 0, republished: 0 },
  questions: { created: 0, updated: 0, archived: 0 },
  media: { uploaded: 0, reused: 0, skipped: 0 },
});

export function changesCount(s: ImportSummary): number {
  return (
    s.sections.created +
    s.sections.updated +
    s.subjects.created +
    s.subjects.updated +
    s.subjects.archived +
    s.chapters.created +
    s.chapters.updated +
    s.chapters.removed +
    s.glossary.created +
    s.glossary.updated +
    s.glossary.removed +
    s.topics.created +
    s.topics.updated +
    s.topics.versions +
    s.topics.unpublished +
    s.topics.republished +
    s.questions.created +
    s.questions.updated +
    s.questions.archived +
    s.media.uploaded
  );
}

/** JSON с упорядоченными ключами — для сравнения содержимого и хеша версии. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };
/** BR-QZ-02, PH-28: «Верно» / «Неверно» — те же тексты, что у вопросов учителя. */
const TRUE_FALSE = (['optionTrue', 'optionFalse'] as const).map((key) =>
  Object.fromEntries(CONTENT_LOCALES.map((l) => [l, getMessage(BUNDLES[l], `teacher.quiz.${key}`) ?? ''])),
) as Array<Record<Locale, string>>;

/** Содержимое вопроса в виде для сравнения (из файла). Тексты «Верно/Неверно» задаёт платформа. */
function questionContent(q: QuestionModel) {
  return {
    type: q.type,
    difficulty: q.difficulty,
    isDemo: q.isDemo,
    textAnswer: q.textAnswer,
    translations: q.translations,
    options: q.options.map((o, i) => ({
      isCorrect: o.isCorrect,
      translations:
        q.type === 'true_false'
          ? Object.fromEntries(Object.keys(q.translations).map((l) => [l, TRUE_FALSE[i]![l as Locale]]))
          : o.translations,
    })),
  };
}

/**
 * Запись каталога в БД в одной транзакции (BR-CNT-03..07). Сопоставление — по кодам; неизменённые строки
 * не трогаются (повторный запуск ничего не меняет). Возвращает сводку изменений.
 */
export async function applyCatalog(
  tx: Tx,
  catalog: ContentCatalog,
  opts: { media: MediaStore | null; dryRun: boolean },
): Promise<ImportSummary> {
  const summary = emptySummary();
  // Один импорт за раз.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('syntara.content_import'))`);

  /* ---- Разделы каталога ---- */
  const sectionIds = new Map<string, string>();
  for (const s of catalog.sections) {
    const [row] = await tx.select().from(catalogSections).where(eq(catalogSections.code, s.code));
    let id = row?.id;
    if (!row) {
      [{ id } = { id: '' }] = await tx
        .insert(catalogSections)
        .values({ code: s.code, position: s.position })
        .returning({ id: catalogSections.id });
      summary.sections.created++;
    } else if (row.position !== s.position) {
      await tx.update(catalogSections).set({ position: s.position }).where(eq(catalogSections.id, row.id));
      summary.sections.updated++;
    }
    sectionIds.set(s.code, id!);
    const changed = await syncTranslations(
      tx,
      catalogSectionTranslations,
      'sectionId',
      id!,
      Object.fromEntries(
        Object.entries(s.translations).map(([l, t]) => [
          l,
          { title: t.title, description: t.description ?? null },
        ]),
      ),
    );
    if (row && changed) summary.sections.updated++;
  }

  /* ---- Предметы ---- */
  const subjectIds = new Map<string, string>();
  for (const s of catalog.subjects) {
    const [row] = await tx.select().from(subjects).where(eq(subjects.code, s.code));
    const sectionId = sectionIds.get(s.sectionCode) ?? null;
    let id = row?.id;
    if (!row) {
      [{ id } = { id: '' }] = await tx
        .insert(subjects)
        .values({
          code: s.code,
          sectionId,
          position: s.position,
          isOfficial: true,
          inPublicCatalog: true,
          blocks: s.blocks,
          module: s.module ?? null,
        })
        .returning({ id: subjects.id });
      summary.subjects.created++;
    } else if (
      row.sectionId !== sectionId ||
      row.position !== s.position ||
      row.archivedAt ||
      !row.inPublicCatalog ||
      !row.isOfficial ||
      row.blocks.join() !== s.blocks.join() ||
      row.module !== (s.module ?? null)
    ) {
      await tx
        .update(subjects)
        .set({
          sectionId,
          position: s.position,
          archivedAt: null,
          inPublicCatalog: true,
          isOfficial: true,
          blocks: s.blocks,
          module: s.module ?? null,
        })
        .where(eq(subjects.id, row.id));
      summary.subjects.updated++;
    }
    subjectIds.set(s.code, id!);
    const changed = await syncTranslations(
      tx,
      subjectTranslations,
      'subjectId',
      id!,
      Object.fromEntries(
        Object.entries(s.translations).map(([l, t]) => [
          l,
          { title: t.title, description: t.description ?? null },
        ]),
      ),
    );
    if (row && changed && !(row.sectionId !== sectionId || row.position !== s.position || row.archivedAt))
      summary.subjects.updated++;
  }
  // Предмет, удалённый из файлов, — в архив; его темы снимаются с публикации ниже.
  const goneSubjects = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(
        isNotNull(subjects.code),
        isNull(subjects.archivedAt),
        catalog.subjects.length
          ? notInArray(
              subjects.code,
              catalog.subjects.map((s) => s.code),
            )
          : undefined,
      ),
    );
  for (const g of goneSubjects) {
    await tx.update(subjects).set({ archivedAt: new Date() }).where(eq(subjects.id, g.id));
    summary.subjects.archived++;
  }

  /* ---- Главы (BR-CHAP-01): по коду внутри предмета; глава, удалённая из subject.yaml, удаляется ---- */
  const chapterIds = new Map<string, string>();
  for (const s of catalog.subjects) {
    const subjectId = subjectIds.get(s.code)!;
    const existing = await tx.select().from(subjectChapters).where(eq(subjectChapters.subjectId, subjectId));
    for (const c of s.chapters) {
      const found = existing.find((e) => e.code === c.code);
      let id = found?.id;
      if (!found) {
        [{ id } = { id: '' }] = await tx
          .insert(subjectChapters)
          .values({ subjectId, code: c.code, position: c.position })
          .returning({ id: subjectChapters.id });
        summary.chapters.created++;
      } else if (found.position !== c.position) {
        await tx
          .update(subjectChapters)
          .set({ position: c.position })
          .where(eq(subjectChapters.id, found.id));
        summary.chapters.updated++;
      }
      chapterIds.set(`${s.code}#${c.code}`, id!);
      const changed = await syncTranslations(
        tx,
        subjectChapterTranslations,
        'chapterId',
        id!,
        c.translations,
      );
      if (found && changed && found.position === c.position) summary.chapters.updated++;
    }
    const stale = existing.filter((e) => !s.chapters.some((c) => c.code === e.code)).map((e) => e.id);
    if (stale.length) {
      await tx.update(topics).set({ chapterId: null }).where(inArray(topics.chapterId, stale));
      await tx.delete(subjectChapterTranslations).where(inArray(subjectChapterTranslations.chapterId, stale));
      await tx.delete(subjectChapters).where(inArray(subjectChapters.id, stale));
      summary.chapters.removed += stale.length;
    }
  }

  /* ---- Глоссарии (REQ-GLOS-01): разделы по коду в предмете, термины — по коду в разделе ---- */
  for (const s of catalog.subjects) await syncGlossary(tx, subjectIds.get(s.code)!, s.glossary, summary);

  /* ---- Картинки (BR-CNT-06) ---- */
  const mediaIds = new Map<string, string | null>();
  const importUserId = await importUser(tx);
  for (const topic of catalog.topics) {
    for (const m of Object.values(topic.media)) {
      if (mediaIds.has(m.sha256)) continue;
      if (!opts.media) {
        mediaIds.set(m.sha256, null);
        summary.media.skipped++;
        continue;
      }
      const key = `content/${m.sha256}${m.mime === 'image/png' ? '.png' : m.mime === 'image/webp' ? '.webp' : '.jpg'}`;
      const [row] = await tx
        .select({ id: mediaFiles.id })
        .from(mediaFiles)
        .where(eq(mediaFiles.storageKey, key));
      if (!opts.dryRun) {
        const result = await opts.media.ensure(key, m.bytes, m.mime);
        if (result === 'uploaded') summary.media.uploaded++;
      }
      if (row) {
        mediaIds.set(m.sha256, row.id);
        summary.media.reused++;
        continue;
      }
      const [inserted] = await tx
        .insert(mediaFiles)
        .values({
          ownerId: null,
          kind: 'illustration',
          originalName: m.file.slice('media/'.length),
          mime: m.mime,
          sizeBytes: m.bytes.length,
          sha256: Buffer.from(m.sha256, 'hex'),
          storageKey: key,
          scanStatus: 'clean',
        })
        .returning({ id: mediaFiles.id });
      mediaIds.set(m.sha256, inserted!.id);
    }
  }
  const mediaId = (topic: TopicModel, file?: string) =>
    file ? (mediaIds.get(topic.media[file]!.sha256) ?? null) : null;

  /* ---- Темы ---- */
  const fileTopicCodes = catalog.topics.map((t) => t.code);
  // Тема, удалённая из файлов (или из архивного предмета), — снята с публикации; строки и прогресс сохраняются.
  const goneTopics = await tx
    .select({ id: topics.id, subjectId: topics.subjectId, status: topics.status })
    .from(topics)
    .where(
      and(
        isNotNull(topics.code),
        fileTopicCodes.length ? notInArray(topics.code, fileTopicCodes) : undefined,
      ),
    );
  for (const g of goneTopics) {
    if (g.status === 'published') {
      await tx.update(topics).set({ status: 'draft' }).where(eq(topics.id, g.id));
      summary.topics.unpublished++;
    }
  }
  // Позиции снятых тем не мешают позициям тем из файлов (UNIQUE (subject_id, position)).
  for (const subjectCode of new Set(catalog.topics.map((t) => t.subjectCode))) {
    const subjectId = subjectIds.get(subjectCode)!;
    const taken = new Set(catalog.topics.filter((t) => t.subjectCode === subjectCode).map((t) => t.position));
    const [top] = await tx
      .select({ p: max(topics.position) })
      .from(topics)
      .where(eq(topics.subjectId, subjectId));
    let next = Math.max(top?.p ?? 0, ...taken) + 1;
    for (const g of goneTopics.filter((t) => t.subjectId === subjectId)) {
      const [row] = await tx.select({ position: topics.position }).from(topics).where(eq(topics.id, g.id));
      if (row && taken.has(row.position)) {
        await tx.update(topics).set({ position: next++ }).where(eq(topics.id, g.id));
        summary.topics.updated++;
      }
    }
  }

  for (const t of catalog.topics) {
    const subjectId = subjectIds.get(t.subjectCode)!;
    let [row] = await tx.select().from(topics).where(eq(topics.code, t.code));
    const coverMediaId = mediaId(t, t.illustration);
    const chapterId = t.chapterCode ? (chapterIds.get(`${t.subjectCode}#${t.chapterCode}`) ?? null) : null;
    const elementNumber = t.elementNumber ?? null;
    if (!row) {
      [row] = await tx
        .insert(topics)
        .values({ code: t.code, subjectId, position: t.position, coverMediaId, chapterId, elementNumber })
        .returning();
      summary.topics.created++;
    } else if (
      row.subjectId !== subjectId ||
      row.position !== t.position ||
      row.coverMediaId !== coverMediaId ||
      row.chapterId !== chapterId ||
      row.elementNumber !== elementNumber ||
      row.archivedAt ||
      row.coverUrl
    ) {
      await tx
        .update(topics)
        .set({
          subjectId,
          position: t.position,
          coverMediaId,
          chapterId,
          elementNumber,
          coverUrl: null,
          archivedAt: null,
        })
        .where(eq(topics.id, row.id));
      summary.topics.updated++;
    }
    const topicId = row!.id;
    await syncTranslations(
      tx,
      topicTranslations,
      'topicId',
      topicId,
      Object.fromEntries(
        Object.entries(t.translations).map(([l, x]) => [
          l,
          {
            title: x.title,
            description: x.description ?? null,
            funFact: x.funFact ?? null,
            bodyMd: x.bodyMd ?? null,
            summary: null,
            needsReview: x.needsReview,
          },
        ]),
      ),
    );

    // Разделы аккордеона — по коду.
    const existingSections = await tx.select().from(topicSections).where(eq(topicSections.topicId, topicId));
    const sectionIdByCode = new Map<string, string>();
    for (const s of t.sections) {
      const illustrationMediaId = mediaId(t, s.illustration);
      const found = existingSections.find((e) => e.code === s.code);
      let id = found?.id;
      if (!found) {
        [{ id } = { id: '' }] = await tx
          .insert(topicSections)
          .values({ topicId, code: s.code, position: s.position, illustrationMediaId })
          .returning({ id: topicSections.id });
      } else if (found.position !== s.position || found.illustrationMediaId !== illustrationMediaId) {
        await tx
          .update(topicSections)
          .set({ position: s.position, illustrationMediaId })
          .where(eq(topicSections.id, found.id));
      }
      sectionIdByCode.set(s.code, id!);
      await syncTranslations(
        tx,
        topicSectionTranslations,
        'sectionId',
        id!,
        Object.fromEntries(
          Object.entries(s.translations).map(([l, x]) => [l, { title: x.title, body: x.body ?? null }]),
        ),
      );
    }
    const staleSections = existingSections.filter((e) => !t.sections.some((s) => s.code === e.code));
    if (staleSections.length) {
      const ids = staleSections.map((s) => s.id);
      await tx.delete(topicSectionTranslations).where(inArray(topicSectionTranslations.sectionId, ids));
      await tx.delete(topicSections).where(inArray(topicSections.id, ids));
    }

    // Квиз.
    await tx.insert(quizzes).values({ topicId }).onConflictDoNothing({ target: quizzes.topicId });
    const [quiz] = await tx.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.topicId, topicId));
    await syncQuestions(tx, quiz!.id, t.questions, summary);

    // Снимок версии (REQ-TCH-PUB-05): ученик видит снимок опубликованной версии.
    const snapshot: TopicSnapshot = {
      code: t.code,
      translations: Object.fromEntries(
        Object.entries(t.translations).map(([l, x]) => [
          l,
          {
            title: x.title,
            ...(x.description ? { description: x.description } : {}),
            ...(x.funFact ? { funFact: x.funFact } : {}),
            ...(x.bodyMd ? { bodyMd: x.bodyMd } : {}),
            ...(x.illustrationAlt ? { illustrationAlt: x.illustrationAlt } : {}),
            ...(x.needsReview ? { needsReview: true } : {}),
          },
        ]),
      ),
      sections: t.sections.map((s) => ({
        id: sectionIdByCode.get(s.code)!,
        code: s.code,
        position: s.position,
        illustrationMediaId: mediaId(t, s.illustration),
        translations: Object.fromEntries(
          Object.entries(s.translations).map(([l, x]) => [
            l,
            {
              title: x.title,
              ...(x.body ? { body: x.body } : {}),
              ...(x.illustrationAlt ? { illustrationAlt: x.illustrationAlt } : {}),
            },
          ]),
        ),
      })),
      coverMediaId,
      coverUrl: null,
      materialIds: [],
      ...(t.elementColor ? { element: { color: t.elementColor } } : {}),
      ...(t.timeline ? { timeline: t.timeline } : {}),
      ...(t.scientists ? { scientists: t.scientists } : {}),
    };
    // Хеш содержимого: снимок, квиз и картинки — изменённый файл любой из частей даёт новую версию (BR-CNT-04).
    snapshot.contentHash = createHash('sha256')
      .update(
        stable({
          snapshot,
          quiz: t.questions.map((q) => ({ code: q.code, ...questionContent(q) })),
          media: Object.values(t.media).map((m) => [m.file, m.sha256]),
        }),
      )
      .digest('hex');

    const [latest] = await tx
      .select()
      .from(topicVersions)
      .where(eq(topicVersions.topicId, topicId))
      .orderBy(desc(topicVersions.versionNo))
      .limit(1);
    const latestHash = (latest?.snapshot as TopicSnapshot | undefined)?.contentHash;
    if (latest && latestHash === snapshot.contentHash) {
      if (row!.status !== 'published' || row!.publishedVersionId !== latest.id) {
        await tx
          .update(topics)
          .set({ status: 'published', publishedVersionId: latest.id, publishedAt: new Date() })
          .where(eq(topics.id, topicId));
        summary.topics.republished++;
      }
      continue;
    }
    const [version] = await tx
      .insert(topicVersions)
      .values({
        topicId,
        versionNo: (latest?.versionNo ?? 0) + 1,
        snapshot,
        changeNote: 'Импорт content/',
        createdBy: importUserId,
      })
      .returning({ id: topicVersions.id });
    await tx
      .update(topics)
      .set({ status: 'published', publishedVersionId: version!.id, publishedAt: new Date() })
      .where(eq(topics.id, topicId));
    summary.topics.versions++;
  }

  // Журнал аудита — только если что-то изменилось (BR-CNT-07).
  if (changesCount(summary) > 0) {
    await tx.insert(auditLog).values({
      actorId: importUserId,
      entityType: 'content_import',
      action: 'content.import',
      after: summary,
    });
  }
  return summary;
}

/**
 * Глоссарий предмета (REQ-GLOS-01): разделы и термины сопоставляются по кодам; неизменённое не трогается; удалённые
 * из файла раздел или термин удаляются (на них ничего не ссылается). Нет glossary.yaml — глоссария у предмета нет.
 */
async function syncGlossary(
  tx: Tx,
  subjectId: string,
  glossary: ContentCatalog['subjects'][number]['glossary'],
  summary: ImportSummary,
) {
  const existing = await tx.select().from(glossarySections).where(eq(glossarySections.subjectId, subjectId));
  const wanted = glossary?.sections ?? [];
  for (const section of wanted) {
    const found = existing.find((e) => e.code === section.code);
    let id = found?.id;
    if (!found) {
      [{ id } = { id: '' }] = await tx
        .insert(glossarySections)
        .values({ subjectId, code: section.code, position: section.position })
        .returning({ id: glossarySections.id });
      summary.glossary.created++;
    } else if (found.position !== section.position) {
      await tx
        .update(glossarySections)
        .set({ position: section.position })
        .where(eq(glossarySections.id, found.id));
      summary.glossary.updated++;
    }
    const titleChanged = await syncTranslations(
      tx,
      glossarySectionTranslations,
      'sectionId',
      id!,
      section.translations,
    );
    if (found && titleChanged) summary.glossary.updated++;
    const terms = await tx.select().from(glossaryTerms).where(eq(glossaryTerms.sectionId, id!));
    for (const term of section.terms) {
      const t = terms.find((e) => e.code === term.code);
      let termId = t?.id;
      if (!t) {
        [{ id: termId } = { id: '' }] = await tx
          .insert(glossaryTerms)
          .values({ sectionId: id!, code: term.code, position: term.position })
          .returning({ id: glossaryTerms.id });
        summary.glossary.created++;
      } else if (t.position !== term.position) {
        await tx.update(glossaryTerms).set({ position: term.position }).where(eq(glossaryTerms.id, t.id));
        summary.glossary.updated++;
      }
      const changed = await syncTranslations(
        tx,
        glossaryTermTranslations,
        'termId',
        termId!,
        term.translations,
      );
      if (t && changed) summary.glossary.updated++;
    }
    const staleTerms = terms.filter((e) => !section.terms.some((t) => t.code === e.code)).map((e) => e.id);
    if (staleTerms.length) {
      await tx.delete(glossaryTermTranslations).where(inArray(glossaryTermTranslations.termId, staleTerms));
      await tx.delete(glossaryTerms).where(inArray(glossaryTerms.id, staleTerms));
      summary.glossary.removed += staleTerms.length;
    }
  }
  const staleSections = existing.filter((e) => !wanted.some((s) => s.code === e.code)).map((e) => e.id);
  if (staleSections.length) {
    const terms = (
      await tx
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .where(inArray(glossaryTerms.sectionId, staleSections))
    ).map((t) => t.id);
    if (terms.length) {
      await tx.delete(glossaryTermTranslations).where(inArray(glossaryTermTranslations.termId, terms));
      await tx.delete(glossaryTerms).where(inArray(glossaryTerms.id, terms));
    }
    await tx
      .delete(glossarySectionTranslations)
      .where(inArray(glossarySectionTranslations.sectionId, staleSections));
    await tx.delete(glossarySections).where(inArray(glossarySections.id, staleSections));
    summary.glossary.removed += staleSections.length + terms.length;
  }
}

async function importUser(tx: Tx): Promise<string> {
  const [found] = await tx.select({ id: users.id }).from(users).where(eq(users.email, IMPORT_USER.email));
  if (found) return found.id;
  const [row] = await tx.insert(users).values(IMPORT_USER).returning({ id: users.id });
  return row!.id;
}

/**
 * Переводы `*_translations` (PK (id, locale)): вставка, изменение только отличающихся строк, удаление языков,
 * которых больше нет в файлах. Возвращает true, если что-то изменилось.
 */
async function syncTranslations<T extends Record<string, unknown>>(
  tx: Tx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- общая обработка таблиц *_translations
  table: any,
  idKey: string,
  id: string,
  wanted: Record<string, T>,
): Promise<boolean> {
  const idColumn = table[idKey];
  const existing = (await tx.select().from(table).where(eq(idColumn, id))) as Array<Record<string, unknown>>;
  let changed = false;
  for (const [locale, values] of Object.entries(wanted)) {
    const row = existing.find((e) => e.locale === locale);
    if (!row) {
      await tx.insert(table).values({ [idKey]: id, locale, ...values });
      changed = true;
    } else if (Object.entries(values).some(([k, v]) => (row[k] ?? null) !== (v ?? null))) {
      await tx
        .update(table)
        .set(values)
        .where(and(eq(idColumn, id), eq(table.locale, locale)));
      changed = true;
    }
  }
  for (const row of existing) {
    if (!(String(row.locale) in wanted)) {
      await tx.delete(table).where(and(eq(idColumn, id), eq(table.locale, row.locale)));
      changed = true;
    }
  }
  return changed;
}

/**
 * Вопросы квиза по коду (BR-CNT-04). Неизменённый вопрос не трогается. Изменённый: если на него уже отвечали —
 * старый архивируется (код переходит к новому, история попыток не меняется), иначе — замена на месте
 * (как API-T-21). Вопрос, удалённый из quiz.yaml, — в архив.
 */
async function syncQuestions(tx: Tx, quizId: string, wanted: QuestionModel[], summary: ImportSummary) {
  const existing = await tx
    .select()
    .from(questions)
    .where(and(eq(questions.quizId, quizId), isNotNull(questions.code)));
  for (const [i, q] of wanted.entries()) {
    const position = i + 1;
    const row = existing.find((e) => e.code === q.code);
    if (!row) {
      await insertQuestion(tx, quizId, position, q);
      summary.questions.created++;
      continue;
    }
    const same = stable(await dbQuestionContent(tx, row)) === stable(questionContent(q));
    if (same) {
      if (row.position !== position || row.archivedAt) {
        await tx.update(questions).set({ position, archivedAt: null }).where(eq(questions.id, row.id));
        summary.questions.updated++;
      }
      continue;
    }
    const [answers] = await tx
      .select({ n: count() })
      .from(attemptAnswers)
      .where(eq(attemptAnswers.questionId, row.id));
    if (Number(answers?.n ?? 0) > 0) {
      await tx
        .update(questions)
        .set({ archivedAt: row.archivedAt ?? new Date(), code: null })
        .where(eq(questions.id, row.id));
      await insertQuestion(tx, quizId, position, q);
    } else {
      await deleteQuestionContent(tx, row.id);
      await tx
        .update(questions)
        .set({
          type: q.type,
          difficulty: q.difficulty,
          isDemo: q.isDemo,
          textAnswer: q.textAnswer,
          position,
          archivedAt: null,
        })
        .where(eq(questions.id, row.id));
      await insertQuestionContent(tx, row.id, q);
    }
    summary.questions.updated++;
  }
  for (const row of existing) {
    if (!row.archivedAt && !wanted.some((q) => q.code === row.code)) {
      await tx.update(questions).set({ archivedAt: new Date() }).where(eq(questions.id, row.id));
      summary.questions.archived++;
    }
  }
}

async function insertQuestion(tx: Tx, quizId: string, position: number, q: QuestionModel) {
  const [row] = await tx
    .insert(questions)
    .values({
      quizId,
      code: q.code,
      type: q.type,
      difficulty: q.difficulty,
      isDemo: q.isDemo,
      textAnswer: q.textAnswer,
      position,
    })
    .returning({ id: questions.id });
  await insertQuestionContent(tx, row!.id, q);
}

async function insertQuestionContent(tx: Tx, questionId: string, q: QuestionModel) {
  const content = questionContent(q);
  await tx.insert(questionTranslations).values(
    Object.entries(content.translations).map(([locale, t]) => ({
      questionId,
      locale: locale as Locale,
      text: t.text,
      explanation: t.explanation ?? null,
    })),
  );
  for (const [i, option] of content.options.entries()) {
    const [row] = await tx
      .insert(answerOptions)
      .values({ questionId, position: i + 1, isCorrect: option.isCorrect })
      .returning({ id: answerOptions.id });
    const texts = Object.entries(option.translations).map(([locale, text]) => ({
      optionId: row!.id,
      locale: locale as Locale,
      text,
    }));
    if (texts.length) await tx.insert(answerOptionTranslations).values(texts);
  }
}

async function deleteQuestionContent(tx: Tx, questionId: string) {
  const options = await tx
    .select({ id: answerOptions.id })
    .from(answerOptions)
    .where(eq(answerOptions.questionId, questionId));
  if (options.length) {
    await tx.delete(answerOptionTranslations).where(
      inArray(
        answerOptionTranslations.optionId,
        options.map((o) => o.id),
      ),
    );
    await tx.delete(answerOptions).where(eq(answerOptions.questionId, questionId));
  }
  await tx.delete(questionTranslations).where(eq(questionTranslations.questionId, questionId));
}

/** Содержимое вопроса из БД в том же виде, что questionContent(). */
async function dbQuestionContent(tx: Tx, row: typeof questions.$inferSelect) {
  const [tr, options] = await Promise.all([
    tx.select().from(questionTranslations).where(eq(questionTranslations.questionId, row.id)),
    tx
      .select()
      .from(answerOptions)
      .where(eq(answerOptions.questionId, row.id))
      .orderBy(asc(answerOptions.position)),
  ]);
  const optionTr = options.length
    ? await tx
        .select()
        .from(answerOptionTranslations)
        .where(
          inArray(
            answerOptionTranslations.optionId,
            options.map((o) => o.id),
          ),
        )
    : [];
  return {
    type: row.type,
    difficulty: row.difficulty,
    isDemo: row.isDemo,
    textAnswer: row.textAnswer,
    translations: Object.fromEntries(
      tr.map((t) => [t.locale!, { text: t.text, ...(t.explanation ? { explanation: t.explanation } : {}) }]),
    ),
    options: options.map((o) => ({
      isCorrect: o.isCorrect,
      translations: Object.fromEntries(
        optionTr.filter((t) => t.optionId === o.id).map((t) => [t.locale!, t.text]),
      ),
    })),
  };
}
