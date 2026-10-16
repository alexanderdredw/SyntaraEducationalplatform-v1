import { Inject, Injectable } from '@nestjs/common';
import { type AnyColumn, and, eq, isNull, or, sql } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';
import { DB } from '../../infra/tokens';

/**
 * BR-VIS-01: ученик видит тему, если она опубликована, не в архиве и её предмет либо в общем каталоге,
 * либо выдан (без отзыва) классу, где ученик состоит активно. Каталог и уроки используют этот сервис
 * с итерации 8; выход из класса (BR-CLS-03) сразу закрывает доступ к предметам класса.
 */
@Injectable()
export class VisibilityService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Предмет виден ученику, если он не в архиве и либо в общем каталоге, либо выдан (без отзыва) классу, где ученик
   * состоит активно (BR-VIS-01 для предмета: каталог, раздел, страница предмета).
   */
  async canStudentSeeSubject(studentId: string, subjectId: string): Promise<boolean> {
    const { subjects } = schema;
    const [row] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(
        and(
          eq(subjects.id, subjectId),
          isNull(subjects.archivedAt),
          or(eq(subjects.inPublicCatalog, true), this.viaClass(studentId, subjects.id)),
        ),
      );
    return Boolean(row);
  }

  /** SQL: предмет выдан действующему классу ученика. */
  viaClass(studentId: string, subjectColumn: AnyColumn) {
    const { classSubjectAccess: csa, classMemberships: m } = schema;
    return sql`EXISTS (
      SELECT 1 FROM ${csa} JOIN ${m} ON ${m.classId} = ${csa.classId}
      WHERE ${csa.subjectId} = ${subjectColumn} AND ${csa.revokedAt} IS NULL
        AND ${m.studentId} = ${studentId} AND ${m.status} = 'active')`;
  }

  async canStudentSeeTopic(studentId: string, topicId: string): Promise<boolean> {
    const { topics, subjects, classSubjectAccess: csa, classMemberships: m } = schema;
    const viaClass = sql`EXISTS (
      SELECT 1 FROM ${csa} JOIN ${m} ON ${m.classId} = ${csa.classId}
      WHERE ${csa.subjectId} = ${topics.subjectId} AND ${csa.revokedAt} IS NULL
        AND ${m.studentId} = ${studentId} AND ${m.status} = 'active')`;
    const [row] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(subjects, eq(subjects.id, topics.subjectId))
      .where(
        and(
          eq(topics.id, topicId),
          eq(topics.status, 'published'),
          isNull(topics.archivedAt),
          or(eq(subjects.inPublicCatalog, true), viaClass),
        ),
      );
    return Boolean(row);
  }

  /** BR-VIS-04: гостю видны только базовые предметы платформы (is_official + общий каталог, не в архиве). */
  guestSubjectCondition() {
    const { subjects } = schema;
    return and(
      eq(subjects.isOfficial, true),
      eq(subjects.inPublicCatalog, true),
      isNull(subjects.archivedAt),
    );
  }

  async canGuestSeeSubject(subjectId: string): Promise<boolean> {
    const { subjects } = schema;
    const [row] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), this.guestSubjectCondition()));
    return Boolean(row);
  }

  /** BR-VIS-04: опубликованная тема базового предмета; личные уроки учителей гостю не видны. */
  async canGuestSeeTopic(topicId: string): Promise<boolean> {
    const { topics, subjects } = schema;
    const [row] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(subjects, eq(subjects.id, topics.subjectId))
      .where(
        and(
          eq(topics.id, topicId),
          eq(topics.status, 'published'),
          isNull(topics.archivedAt),
          this.guestSubjectCondition(),
        ),
      );
    return Boolean(row);
  }
}
