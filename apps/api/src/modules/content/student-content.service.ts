import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { type LessonEventDto, type Locale, type TopicSnapshot } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { GamificationService } from '../gamification/gamification.service';
import { type CatalogDto, type LessonDto, type SectionDto, type StudentSubjectDto } from './content.dto';
import { LessonService } from './lesson.service';
import { VisibilityService } from './visibility.service';

const { catalogSections, catalogSectionTranslations: cst, subjects, subjectTranslations: st } = schema;
const { topics, topicVersions, learningEvents } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

type CatalogSubject = CatalogDto['subjects'][number];

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

  /** API-S-04: разделы и доступные предметы вне разделов. Пользовательские названия не переводятся (REQ-ST-CAT-02). */
  async catalog(studentId: string, locale: Locale): Promise<CatalogDto> {
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
      subjects: await this.visibleSubjects(studentId, isNull(subjects.sectionId), locale),
    };
  }

  /** API-S-05: предметы раздела (REQ-ST-CAT-03). */
  async section(studentId: string, sectionId: string, locale: Locale): Promise<SectionDto> {
    const [section] = await this.db.select().from(catalogSections).where(eq(catalogSections.id, sectionId));
    if (!section) throw notFound();
    const tr = pickTranslation(await this.db.select().from(cst).where(eq(cst.sectionId, sectionId)), locale);
    return {
      id: section.id,
      title: tr?.title ?? '',
      description: tr?.description ?? null,
      subjects: await this.visibleSubjects(studentId, eq(subjects.sectionId, sectionId), locale),
    };
  }

  /**
   * Страница предмета ученика (решение владельца 2026-10-14, «Перейти к предмету»): опубликованные темы по
   * position (PH-35 — без блокировки), названия — из опубликованного снимка.
   * TODO(OWNER): маршрут /learn/subjects/:id и этот ответ в разделах 4 и 6.5 SPEC не описаны.
   */
  async subject(studentId: string, subjectId: string, locale: Locale): Promise<StudentSubjectDto> {
    if (!(await this.visibility.canStudentSeeSubject(studentId, subjectId))) throw notFound();
    const [translations, rows] = await Promise.all([
      this.db.select().from(st).where(eq(st.subjectId, subjectId)),
      this.db
        .select({ id: topics.id, position: topics.position, snapshot: topicVersions.snapshot })
        .from(topics)
        .innerJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
        .where(
          and(eq(topics.subjectId, subjectId), eq(topics.status, 'published'), isNull(topics.archivedAt)),
        )
        .orderBy(asc(topics.position)),
    ]);
    const tr = pickTranslation(translations, locale);
    return {
      id: subjectId,
      title: tr?.title ?? '',
      description: tr?.description ?? null,
      topics: rows.map((r) => {
        const snapshot = r.snapshot as TopicSnapshot;
        const t = [locale, 'ru', 'en', 'kk'].map((l) => snapshot.translations[l as Locale]).find(Boolean);
        return { id: r.id, number: r.position, title: t?.title ?? '' };
      }),
    };
  }

  /** API-S-06 */
  async topic(studentId: string, topicId: string, locale: Locale): Promise<LessonDto> {
    if (!(await this.visibility.canStudentSeeTopic(studentId, topicId))) throw notFound();
    const snapshot = await this.lessons.publishedSnapshot(topicId);
    if (!snapshot) throw notFound();
    return this.lessons.render(topicId, snapshot, locale);
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

  /** Видимые предметы (общий каталог или выданные классу ученика) — с фильтром по разделу. */
  private async visibleSubjects(studentId: string, where: SQL, locale: Locale): Promise<CatalogSubject[]> {
    const rows = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(
        and(
          isNull(subjects.archivedAt),
          where,
          or(eq(subjects.inPublicCatalog, true), this.visibility.viaClass(studentId, subjects.id)),
        ),
      )
      .orderBy(asc(subjects.createdAt), asc(subjects.id));
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
      return { id: s.id, title: tr?.title ?? '', description: tr?.description ?? null, status: 'available' };
    });
  }
}
