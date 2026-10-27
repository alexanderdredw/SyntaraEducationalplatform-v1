import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { type LessonEventDto, type Locale, type TopicSnapshot } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { GamificationService } from '../gamification/gamification.service';
import {
  type CatalogDto,
  type GlossaryDto,
  type LessonDto,
  type PublicSubjectPageDto,
  type SectionDto,
  type StudentSubjectDto,
} from './content.dto';
import { LessonService } from './lesson.service';
import { VisibilityService } from './visibility.service';

const { catalogSections, catalogSectionTranslations: cst, subjects, subjectTranslations: st } = schema;
const { topics, topicVersions, learningEvents, topicMastery, quizAttempts, quizzes } = schema;
const { subjectChapters, subjectChapterTranslations } = schema;
const { glossarySections, glossarySectionTranslations, glossaryTerms, glossaryTermTranslations } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

type CatalogSubject = CatalogDto['subjects'][number];
/** Кто смотрит каталог: ID ученика или null — гость (BR-VIS-04, API-PUB-10..13). */
type Viewer = string | null;

/**
 * Контент ученика (8.4.2–8.4.3): каталог (API-S-04), раздел (API-S-05), страница предмета, тема (API-S-06),
 * открытие урока (API-S-17). Видимость — только через VisibilityService (BR-VIS-01): общий каталог или предмет
 * выдан действующему классу ученика; темы — только опубликованные, ученик видит снимок версии (REQ-TCH-PUB-05).
 * Невидимое → 404 (BR-VIS-02, API-GEN-08).
 */
@Injectable()
export class StudentContentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly visibility: VisibilityService,
    private readonly lessons: LessonService,
    private readonly gamification: GamificationService,
  ) {}

  /**
   * API-S-04 / API-PUB-10: разделы и предметы вне разделов. Пользовательские названия не переводятся
   * (REQ-ST-CAT-02). Гость (viewer = null) видит только базовые предметы (BR-VIS-04).
   */
  async catalog(viewer: Viewer, locale: Locale): Promise<CatalogDto> {
    const sections = await this.db.select().from(catalogSections).orderBy(asc(catalogSections.position));
    const sectionTr = sections.length
      ? await this.db
          .select()
          .from(cst)
          .where(
            inArray(
              cst.sectionId,
              sections.map((s) => s.id),
            ),
          )
      : [];
    return {
      sections: sections.map((s) => {
        const tr = pickTranslation(
          sectionTr.filter((t) => t.sectionId === s.id),
          locale,
        );
        return { id: s.id, title: tr?.title ?? '', description: tr?.description ?? null, status: 'section' };
      }),
      subjects: await this.visibleSubjects(viewer, isNull(subjects.sectionId), locale),
    };
  }

  /** API-S-05 / API-PUB-11: предметы раздела (REQ-ST-CAT-03). */
  async section(viewer: Viewer, sectionId: string, locale: Locale): Promise<SectionDto> {
    const [section] = await this.db.select().from(catalogSections).where(eq(catalogSections.id, sectionId));
    if (!section) throw notFound();
    const tr = pickTranslation(await this.db.select().from(cst).where(eq(cst.sectionId, sectionId)), locale);
    return {
      id: section.id,
      title: tr?.title ?? '',
      description: tr?.description ?? null,
      subjects: await this.visibleSubjects(viewer, eq(subjects.sectionId, sectionId), locale),
    };
  }

  /**
   * Страница предмета ученика (API-S-18, решения владельца 2026-10-14 и 2026-10-16): опубликованные темы по
   * position (PH-35 — без блокировки), названия — из опубликованного снимка, статус темы для ученика.
   */
  async subject(studentId: string, subjectId: string, locale: Locale): Promise<StudentSubjectDto> {
    if (!(await this.visibility.canStudentSeeSubject(studentId, subjectId))) throw notFound();
    const page = await this.subjectPage(subjectId, locale);
    const status = await this.topicStatuses(
      studentId,
      page.topics.map((t) => t.id),
    );
    return { ...page, topics: page.topics.map((t) => ({ ...t, status: status.get(t.id) ?? 'not_started' })) };
  }

  /** API-PUB-12: базовый предмет для гостя — без статусов (BR-VIS-04). */
  async guestSubject(subjectId: string, locale: Locale): Promise<PublicSubjectPageDto> {
    if (!(await this.visibility.canGuestSeeSubject(subjectId))) throw notFound();
    return this.subjectPage(subjectId, locale);
  }

  private async subjectPage(subjectId: string, locale: Locale): Promise<PublicSubjectPageDto> {
    const [translations, rows, [subject]] = await Promise.all([
      this.db.select().from(st).where(eq(st.subjectId, subjectId)),
      this.db
        .select({
          id: topics.id,
          position: topics.position,
          chapterId: topics.chapterId,
          elementNumber: topics.elementNumber,
          snapshot: topicVersions.snapshot,
        })
        .from(topics)
        .innerJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
        .where(
          and(eq(topics.subjectId, subjectId), eq(topics.status, 'published'), isNull(topics.archivedAt)),
        )
        .orderBy(asc(topics.position)),
      this.db.select({ blocks: subjects.blocks }).from(subjects).where(eq(subjects.id, subjectId)),
    ]);
    const tr = pickTranslation(translations, locale);
    const [chapters, [glossary]] = await Promise.all([
      this.chapters(
        subjectId,
        rows.map((r) => ({ id: r.id, chapterId: r.chapterId })),
        locale,
      ),
      this.db
        .select({ id: glossarySections.id })
        .from(glossarySections)
        .where(eq(glossarySections.subjectId, subjectId))
        .limit(1),
    ]);
    return {
      id: subjectId,
      title: tr?.title ?? '',
      description: tr?.description ?? null,
      topics: rows.map((r) => {
        const snapshot = r.snapshot as TopicSnapshot;
        const t = [locale, 'ru', 'en', 'kk'].map((l) => snapshot.translations[l as Locale]).find(Boolean);
        return { id: r.id, number: r.position, title: t?.title ?? '' };
      }),
      ...(chapters.length ? { chapters } : {}),
      ...(glossary ? { hasGlossary: true } : {}),
      // REQ-PTBL-01, REQ-PTBL-04: ячейки с уроками — только опубликованные темы с номером элемента.
      ...(subject?.blocks.includes('periodic-table')
        ? {
            periodicTable: {
              elements: rows.flatMap((r) =>
                r.elementNumber ? [{ number: r.elementNumber, topicId: r.id }] : [],
              ),
            },
          }
        : {}),
    };
  }

  /**
   * API-S-22 / API-PUB-14 (REQ-GLOS-01…04): глоссарий видимого предмета — разделы по порядку, термины по алфавиту
   * языка ответа; перевода нет — RU (как у уроков). Предмет не виден или без глоссария → 404 (BR-VIS-01/04).
   */
  async glossary(viewer: Viewer, subjectId: string, locale: Locale): Promise<GlossaryDto> {
    const visible =
      viewer === null
        ? await this.visibility.canGuestSeeSubject(subjectId)
        : await this.visibility.canStudentSeeSubject(viewer, subjectId);
    if (!visible) throw notFound();
    const sections = await this.db
      .select()
      .from(glossarySections)
      .where(eq(glossarySections.subjectId, subjectId))
      .orderBy(asc(glossarySections.position));
    if (sections.length === 0) throw notFound();
    const sectionIds = sections.map((s) => s.id);
    const [subjectTr, sectionTr, terms] = await Promise.all([
      this.db.select().from(st).where(eq(st.subjectId, subjectId)),
      this.db
        .select()
        .from(glossarySectionTranslations)
        .where(inArray(glossarySectionTranslations.sectionId, sectionIds)),
      this.db.select().from(glossaryTerms).where(inArray(glossaryTerms.sectionId, sectionIds)),
    ]);
    const termTr = terms.length
      ? await this.db
          .select()
          .from(glossaryTermTranslations)
          .where(
            inArray(
              glossaryTermTranslations.termId,
              terms.map((t) => t.id),
            ),
          )
      : [];
    const collator = new Intl.Collator(locale, { sensitivity: 'base' });
    let needsReview = false;
    const result = sections.map((s) => {
      const title = pickTranslation(
        sectionTr.filter((t) => t.sectionId === s.id),
        locale,
      );
      if (title?.needsReview) needsReview = true;
      return {
        id: s.id,
        title: title?.title ?? '',
        terms: terms
          .filter((t) => t.sectionId === s.id)
          .flatMap((t) => {
            const tr = pickTranslation(
              termTr.filter((x) => x.termId === t.id),
              locale,
            );
            if (!tr) return [];
            if (tr.needsReview) needsReview = true;
            return [{ id: t.id, term: tr.term, definition: tr.definition }];
          })
          .sort((a, b) => collator.compare(a.term, b.term)),
      };
    });
    return {
      subject: { id: subjectId, title: pickTranslation(subjectTr, locale)?.title ?? '' },
      sections: result,
      needsReview,
    };
  }

  /**
   * Главы базового предмета (BR-CHAP-01…03): по position, в каждой — опубликованные темы в порядке «Тема N».
   * Пустые главы не показываются; у предмета без глав — пустой список (поле в ответе не появляется, BR-CHAP-05).
   */
  private async chapters(
    subjectId: string,
    topicRows: Array<{ id: string; chapterId: string | null }>,
    locale: Locale,
  ): Promise<NonNullable<PublicSubjectPageDto['chapters']>> {
    const rows = await this.db
      .select()
      .from(subjectChapters)
      .where(eq(subjectChapters.subjectId, subjectId))
      .orderBy(asc(subjectChapters.position));
    if (rows.length === 0) return [];
    const translations = await this.db
      .select()
      .from(subjectChapterTranslations)
      .where(
        inArray(
          subjectChapterTranslations.chapterId,
          rows.map((c) => c.id),
        ),
      );
    return rows
      .map((c) => ({
        id: c.id,
        title:
          pickTranslation(
            translations.filter((t) => t.chapterId === c.id),
            locale,
          )?.title ?? '',
        topicIds: topicRows.filter((t) => t.chapterId === c.id).map((t) => t.id),
      }))
      .filter((c) => c.topicIds.length > 0);
  }

  /**
   * Статус темы для ученика (решение владельца 2026-10-16): «Освоена» — mastered_at задан (≥ порога PH-38);
   * «Начата» — тема открыта (lesson_opened) или есть попытка квиза; иначе «Не начата».
   */
  private async topicStatuses(
    studentId: string,
    topicIds: string[],
  ): Promise<Map<string, 'mastered' | 'started' | 'not_started'>> {
    const result = new Map<string, 'mastered' | 'started' | 'not_started'>();
    if (topicIds.length === 0) return result;
    const [mastery, opened, attempted] = await Promise.all([
      this.db
        .select({ topicId: topicMastery.topicId, masteredAt: topicMastery.masteredAt })
        .from(topicMastery)
        .where(and(eq(topicMastery.studentId, studentId), inArray(topicMastery.topicId, topicIds))),
      this.db
        .selectDistinct({ topicId: learningEvents.topicId })
        .from(learningEvents)
        .where(
          and(
            eq(learningEvents.studentId, studentId),
            eq(learningEvents.type, 'lesson_opened'),
            inArray(learningEvents.topicId, topicIds),
          ),
        ),
      this.db
        .selectDistinct({ topicId: quizzes.topicId })
        .from(quizAttempts)
        .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
        .where(and(eq(quizAttempts.studentId, studentId), inArray(quizzes.topicId, topicIds))),
    ]);
    for (const row of [...opened, ...attempted, ...mastery])
      if (row.topicId) result.set(row.topicId, 'started');
    for (const row of mastery) if (row.topicId && row.masteredAt) result.set(row.topicId, 'mastered');
    return result;
  }

  /** API-S-06 */
  async topic(studentId: string, topicId: string, locale: Locale): Promise<LessonDto> {
    if (!(await this.visibility.canStudentSeeTopic(studentId, topicId))) throw notFound();
    const snapshot = await this.lessons.publishedSnapshot(topicId);
    if (!snapshot) throw notFound();
    return this.lessons.render(topicId, snapshot, locale);
  }

  /** API-PUB-13: «Обзор» базового урока для гостя; квиз — только после входа (REQ-ST-LES-06). */
  async guestTopic(topicId: string, locale: Locale): Promise<LessonDto> {
    if (!(await this.visibility.canGuestSeeTopic(topicId))) throw notFound();
    const snapshot = await this.lessons.publishedSnapshot(topicId);
    if (!snapshot) throw notFound();
    return { ...(await this.lessons.render(topicId, snapshot, locale)), quizId: null };
  }

  /**
   * API-S-17 (REQ-ST-LES-04): событие lesson_opened с ключом `lesson:{topicId}:{date}` — повтор в тот же день
   * не создаёт второго события; первое открытие темы даёт XP (BR-XP-01), день активности — серию (BR-ST-02).
   */
  async lessonOpened(studentId: string, dto: LessonEventDto, locale: Locale): Promise<void> {
    if (!dto.idempotencyKey.startsWith(`lesson:${dto.topicId}:`))
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', {
        idempotencyKey: 'invalidKey',
      });
    if (!(await this.visibility.canStudentSeeTopic(studentId, dto.topicId))) throw notFound();
    const [topic] = await this.db
      .select({ subjectId: topics.subjectId })
      .from(topics)
      .where(eq(topics.id, dto.topicId));
    await this.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(learningEvents)
        .values({
          studentId,
          type: 'lesson_opened',
          subjectId: topic!.subjectId,
          topicId: dto.topicId,
          occurredAt: new Date(),
          idempotencyKey: dto.idempotencyKey,
        })
        .onConflictDoNothing({ target: [learningEvents.studentId, learningEvents.idempotencyKey] })
        .returning();
      if (!event) return;
      await this.gamification.process(
        tx,
        {
          id: event.id,
          studentId,
          type: 'lesson_opened',
          topicId: dto.topicId,
          idempotencyKey: event.idempotencyKey,
        },
        locale,
      );
    });
  }

  /**
   * Видимые предметы с фильтром по разделу: ученику — общий каталог или выданные его классу (BR-VIS-01), гостю —
   * базовые (BR-VIS-04). Предмет без опубликованных тем — «Скоро» (BR-CNT-08).
   */
  private async visibleSubjects(viewer: Viewer, where: SQL, locale: Locale): Promise<CatalogSubject[]> {
    const visible =
      viewer === null
        ? this.visibility.guestSubjectCondition()
        : and(
            isNull(subjects.archivedAt),
            or(eq(subjects.inPublicCatalog, true), this.visibility.viaClass(viewer, subjects.id)),
          );
    // Имена с таблицей заданы явно: в подзапросе Drizzle выводит столбцы без префикса таблицы.
    const hasTopics = sql<boolean>`EXISTS (SELECT 1 FROM topics t WHERE t.subject_id = "subjects"."id"
      AND t.status = 'published' AND t.archived_at IS NULL)`;
    const rows = await this.db
      .select({ id: subjects.id, hasTopics })
      .from(subjects)
      .where(and(where, visible))
      // Базовые предметы — в порядке content/ (subjects.position), предметы учителей — после них по дате создания.
      .orderBy(sql`${subjects.position} ASC NULLS LAST`, asc(subjects.createdAt), asc(subjects.id));
    if (rows.length === 0) return [];
    const translations = await this.db
      .select()
      .from(st)
      .where(
        inArray(
          st.subjectId,
          rows.map((s) => s.id),
        ),
      );
    return rows.map((s) => {
      const tr = pickTranslation(
        translations.filter((t) => t.subjectId === s.id),
        locale,
      );
      return {
        id: s.id,
        title: tr?.title ?? '',
        description: tr?.description ?? null,
        status: s.hasTopics ? 'available' : 'soon',
      };
    });
  }
}
