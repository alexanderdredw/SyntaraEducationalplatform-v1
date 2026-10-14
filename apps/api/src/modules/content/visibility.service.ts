import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
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
}
