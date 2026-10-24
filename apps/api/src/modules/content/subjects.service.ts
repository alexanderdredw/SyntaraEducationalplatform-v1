import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { filledTranslations, type Locale, type SubjectDto } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { TopicDeletionService } from './topic-deletion.service';
import {
  type SubjectDetailDto,
  type SubjectLangDto,
  type SubjectSummaryDto,
  type TopicListItemDto,
  type Translations,
} from './content.dto';

const { subjects, subjectTranslations: st, topics, topicTranslations: tt, classes, quizzes } = schema;
const { classSubjectAccess: csa } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

/**
 * Предметы учителя (8.3.1–8.3.2): владение проверяет OwnershipGuard (BR-ACL-01). Флаг каталога, выдача классу
 * и публикация тем — три независимых признака (BR-VIS-03). Выдача и отзыв пишутся в audit_log (REQ-NFR-SEC-05).
 */
@Injectable()
export class SubjectsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly deletion: TopicDeletionService,
  ) {}

  /** API-T-01 */
  async list(teacherId: string, locale: Locale): Promise<SubjectSummaryDto[]> {
    const rows = await this.db
      .select({ id: subjects.id, inPublicCatalog: subjects.inPublicCatalog })
      .from(subjects)
      .where(and(eq(subjects.ownerId, teacherId), isNull(subjects.archivedAt)))
      .orderBy(asc(subjects.createdAt), asc(subjects.id));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [translations, counts] = await Promise.all([
      this.db.select().from(st).where(inArray(st.subjectId, ids)),
      this.db
        .select({ subjectId: topics.subjectId, n: count(topics.id) })
        .from(topics)
        .where(and(inArray(topics.subjectId, ids), isNull(topics.archivedAt)))
        .groupBy(topics.subjectId),
    ]);
    return rows.map((r) => {
      const tr = pickTranslation(
        translations.filter((t) => t.subjectId === r.id),
        locale,
      );
      return {
        id: r.id,
        title: tr?.title ?? '',
        description: tr?.description ?? null,
        locale: tr?.locale ?? locale,
        inPublicCatalog: r.inPublicCatalog,
        topicsCount: Number(counts.find((c) => c.subjectId === r.id)?.n ?? 0),
      };
    });
  }

  /** API-T-02 */
  async create(teacherId: string, dto: SubjectDto): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(subjects)
        .values({ ownerId: teacherId, inPublicCatalog: dto.inPublicCatalog })
        .returning({ id: subjects.id });
      const id = row!.id;
      await tx.insert(st).values(this.translationRows(id, dto));
      await this.audit.record(
        {
          actorId: teacherId,
          entityType: 'subject',
          entityId: id,
          action: 'create',
          after: { inPublicCatalog: dto.inPublicCatalog },
        },
        tx,
      );
      return { id };
    });
  }

  /** API-T-03 GET */
  async get(teacherId: string, id: string, locale: Locale): Promise<SubjectDetailDto> {
    const [subject] = await this.db
      .select({ id: subjects.id, inPublicCatalog: subjects.inPublicCatalog })
      .from(subjects)
      .where(eq(subjects.id, id));
    if (!subject) throw notFound();
    const [translations, access, topicRows] = await Promise.all([
      this.db.select().from(st).where(eq(st.subjectId, id)),
      this.db
        .select({ classId: csa.classId })
        .from(csa)
        .innerJoin(classes, eq(classes.id, csa.classId))
        .where(and(eq(csa.subjectId, id), isNull(csa.revokedAt), eq(classes.teacherId, teacherId))),
      this.topicList(id, locale),
    ]);
    const tr: Translations<SubjectLangDto> = {};
    for (const t of translations) tr[t.locale!] = { title: t.title, description: t.description };
    return {
      id,
      translations: tr,
      inPublicCatalog: subject.inPublicCatalog,
      grantedClassIds: access.map((a) => a.classId),
      topics: topicRows,
    };
  }

  /** API-T-03 PATCH: переводы заменяются целиком; изменение флага каталога — в журнал аудита. */
  async update(teacherId: string, id: string, dto: SubjectDto): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ inPublicCatalog: subjects.inPublicCatalog })
        .from(subjects)
        .where(eq(subjects.id, id))
        .for('update');
      await tx.update(subjects).set({ inPublicCatalog: dto.inPublicCatalog }).where(eq(subjects.id, id));
      await tx.delete(st).where(eq(st.subjectId, id));
      await tx.insert(st).values(this.translationRows(id, dto));
      if (before?.inPublicCatalog !== dto.inPublicCatalog) {
        await this.audit.record(
          {
            actorId: teacherId,
            entityType: 'subject',
            entityId: id,
            action: 'catalog_flag',
            before: { inPublicCatalog: before?.inPublicCatalog },
            after: { inPublicCatalog: dto.inPublicCatalog },
          },
          tx,
        );
      }
    });
  }

  /** API-T-07: только свой класс (BR-ACL-02); повтор — без дубля (ux_csa_active). `created` — была ли новая выдача. */
  async grant(teacherId: string, subjectId: string, classId: string): Promise<{ created: boolean }> {
    await this.ownClass(teacherId, classId);
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(csa)
        .values({ classId, subjectId, grantedBy: teacherId })
        .onConflictDoNothing({
          target: [csa.classId, csa.subjectId],
          where: sql`${csa.revokedAt} IS NULL`,
        })
        .returning({ id: csa.id });
      if (inserted.length === 0) return { created: false };
      await this.audit.record(
        {
          actorId: teacherId,
          entityType: 'subject_access',
          entityId: inserted[0]!.id,
          action: 'grant',
          after: { classId, subjectId },
        },
        tx,
      );
      return { created: true };
    });
  }

  /** API-T-08: отзыв действующей выдачи; повторный отзыв ничего не меняет. */
  async revoke(teacherId: string, subjectId: string, classId: string): Promise<void> {
    await this.ownClass(teacherId, classId);
    await this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(csa)
        .set({ revokedAt: new Date() })
        .where(and(eq(csa.classId, classId), eq(csa.subjectId, subjectId), isNull(csa.revokedAt)))
        .returning({ id: csa.id });
      for (const row of revoked) {
        await this.audit.record(
          {
            actorId: teacherId,
            entityType: 'subject_access',
            entityId: row.id,
            action: 'revoke',
            before: { classId, subjectId },
          },
          tx,
        );
      }
    });
  }

  /** API-T-09: черновик без переводов в конце списка; квиз темы создаётся сразу (API-T-19). */
  async createTopic(subjectId: string): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      // Блокировка предмета: две одновременные темы не получат одинаковую позицию.
      await tx.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, subjectId)).for('update');
      const [last] = await tx
        .select({ position: max(topics.position) })
        .from(topics)
        .where(eq(topics.subjectId, subjectId));
      const [topic] = await tx
        .insert(topics)
        .values({ subjectId, position: (last?.position ?? 0) + 1 })
        .returning({ id: topics.id });
      await tx.insert(quizzes).values({ topicId: topic!.id });
      return { id: topic!.id };
    });
  }

  async topicList(subjectId: string, locale: Locale): Promise<TopicListItemDto[]> {
    const rows = await this.db
      .select({ id: topics.id, position: topics.position, status: topics.status })
      .from(topics)
      .where(and(eq(topics.subjectId, subjectId), isNull(topics.archivedAt)))
      .orderBy(asc(topics.position));
    if (rows.length === 0) return [];
    const translations = await this.db
      .select()
      .from(tt)
      .where(
        inArray(
          tt.topicId,
          rows.map((r) => r.id),
        ),
      );
    const blockers = await this.deletion.blockers(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      number: r.position,
      status: r.status,
      deletable: !blockers.has(r.id),
      title:
        pickTranslation(
          translations.filter((t) => t.topicId === r.id),
          locale,
        )?.title ?? null,
    }));
  }

  private translationRows(subjectId: string, dto: SubjectDto) {
    return filledTranslations(dto.translations).map(([locale, t]) => ({
      subjectId,
      locale,
      title: t.title!,
      description: t.description ?? null,
    }));
  }

  private async ownClass(teacherId: string, classId: string): Promise<void> {
    const [cls] = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId), isNull(classes.archivedAt)));
    if (!cls) throw notFound();
  }
}
