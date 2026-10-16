import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { type CatalogDto, type LessonDto } from './content.dto';
import { LessonService } from './lesson.service';
import { VisibilityService } from './visibility.service';

const { catalogSections, catalogSectionTranslations: cst, subjects, subjectTranslations: st } = schema;
const { classSubjectAccess: csa, classMemberships: m } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

/**
 * Ранний ученический API итерации 7 (только сервер; интерфейс — итерация 8): каталог (API-S-04) и тема
 * (API-S-06). Видимость — только через VisibilityService.canStudentSeeTopic (BR-VIS-01); черновик и чужое → 404
 * (BR-VIS-02, API-GEN-08). Ученик видит снимок опубликованной версии (REQ-TCH-PUB-05).
 */
@Injectable()
export class StudentContentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly visibility: VisibilityService,
    private readonly lessons: LessonService,
  ) {}

  /**
   * API-S-04: разделы каталога и доступные предметы вне разделов — из общего каталога или выданные классу,
   * где ученик состоит (BR-VIS-01). Пользовательские названия не переводятся (REQ-ST-CAT-02).
   */
  async catalog(studentId: string, locale: Locale): Promise<CatalogDto> {
    const viaClass = sql`EXISTS (
      SELECT 1 FROM ${csa} JOIN ${m} ON ${m.classId} = ${csa.classId}
      WHERE ${csa.subjectId} = ${subjects.id} AND ${csa.revokedAt} IS NULL
        AND ${m.studentId} = ${studentId} AND ${m.status} = 'active')`;
    const [sections, subjectRows] = await Promise.all([
      this.db.select().from(catalogSections).orderBy(asc(catalogSections.position)),
      this.db
        .select({ id: subjects.id })
        .from(subjects)
        .where(
          and(
            isNull(subjects.archivedAt),
            isNull(subjects.sectionId),
            or(eq(subjects.inPublicCatalog, true), viaClass),
          ),
        )
        .orderBy(asc(subjects.createdAt), asc(subjects.id)),
    ]);
    const [sectionTr, subjectTr] = await Promise.all([
      sections.length
        ? this.db
            .select()
            .from(cst)
            .where(
              inArray(
                cst.sectionId,
                sections.map((s) => s.id),
              ),
            )
        : [],
      subjectRows.length
        ? this.db
            .select()
            .from(st)
            .where(
              inArray(
                st.subjectId,
                subjectRows.map((s) => s.id),
              ),
            )
        : [],
    ]);
    return {
      sections: sections.map((s) => {
        const tr = pickTranslation(
          sectionTr.filter((t) => t.sectionId === s.id),
          locale,
        );
        return { id: s.id, title: tr?.title ?? '', description: tr?.description ?? null, status: 'section' };
      }),
      subjects: subjectRows.map((s) => {
        const tr = pickTranslation(
          subjectTr.filter((t) => t.subjectId === s.id),
          locale,
        );
        return {
          id: s.id,
          title: tr?.title ?? '',
          description: tr?.description ?? null,
          status: 'available',
        };
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
}
