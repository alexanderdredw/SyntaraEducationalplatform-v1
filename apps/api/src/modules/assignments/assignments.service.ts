import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { type AssignmentCreateDto, type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { subjectTitles, topicTitles } from '../../common/titles';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { VisibilityService } from '../content/visibility.service';
import {
  type AssignmentOptionsDto,
  type StudentAssignmentDto,
  type TeacherAssignmentDto,
} from './assignments.dto';

const { assignments, submissions, classes, classMemberships: m, classSubjectAccess: csa } = schema;
const { subjects, topics } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
const unprocessable = (field: string, key: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'Assignment not accepted', {
    [field]: key,
  });

/**
 * Задания (7.6, 8.3.6, 8.4.8): учитель назначает тему своему классу (BR-ASG-01), ученик видит назначения своих
 * действующих классов (PH-33) и сдаёт их квизом темы, начатым из задания (BR-ASG-03, SM-SUBMISSION). Ручной
 * проверки нет (PH-29) — сдача сразу «Оценено» с лучшим результатом. Оценки и назначения — в журнале аудита
 * (REQ-NFR-SEC-05).
 */
@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly visibility: VisibilityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * API-T-28 (решение по ходу итерации 10): что можно назначить классу — базовые предметы платформы (is_official,
   * общий каталог) и свои предметы, выданные этому классу; только опубликованные темы (иначе ученик их не увидит).
   */
  async options(teacherId: string, classId: string, locale: Locale): Promise<AssignmentOptionsDto> {
    await this.ownClass(teacherId, classId);
    const rows = await this.db
      .select({ id: subjects.id, official: subjects.isOfficial, position: subjects.position })
      .from(subjects)
      .where(this.assignable(teacherId, classId))
      .orderBy(
        sql`${subjects.isOfficial} DESC`,
        sql`${subjects.position} ASC NULLS LAST`,
        asc(subjects.createdAt),
      );
    const ids = rows.map((r) => r.id);
    const topicRows = ids.length
      ? await this.db
          .select({ id: topics.id, subjectId: topics.subjectId })
          .from(topics)
          .where(
            and(inArray(topics.subjectId, ids), eq(topics.status, 'published'), isNull(topics.archivedAt)),
          )
          .orderBy(asc(topics.position))
      : [];
    const [subjectNames, topicNames] = await Promise.all([
      subjectTitles(this.db, ids, locale),
      topicTitles(
        this.db,
        topicRows.map((t) => t.id),
        locale,
      ),
    ]);
    return {
      subjects: rows
        .map((s) => ({
          id: s.id,
          title: subjectNames.get(s.id) ?? '',
          official: s.official,
          topics: topicRows
            .filter((t) => t.subjectId === s.id)
            .map((t) => ({ id: t.id, title: topicNames.get(t.id) ?? '' })),
        }))
        .filter((s) => s.topics.length > 0),
    };
  }

  /** API-T-22 (BR-ASG-01): класс — свой; предмет — свой (выданный классу) или базовый; тема — из предмета. */
  async create(teacherId: string, dto: AssignmentCreateDto): Promise<{ id: string }> {
    await this.ownClass(teacherId, dto.classId);
    const [subject] = await this.db
      .select({ id: subjects.id, ownerId: subjects.ownerId, official: subjects.isOfficial })
      .from(subjects)
      .where(and(eq(subjects.id, dto.subjectId), isNull(subjects.archivedAt)));
    // Чужой личный предмет — как несуществующий (BR-ACL-01).
    if (!subject || (!subject.official && subject.ownerId !== teacherId)) throw notFound();
    const [assignable] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, dto.subjectId), this.assignable(teacherId, dto.classId)));
    if (!assignable) throw unprocessable('subjectId', 'subjectNotGranted');
    const [topic] = await this.db
      .select({ subjectId: topics.subjectId, status: topics.status })
      .from(topics)
      .where(and(eq(topics.id, dto.topicId), isNull(topics.archivedAt)));
    if (!topic || topic.subjectId !== dto.subjectId) throw unprocessable('topicId', 'topicNotInSubject');
    if (topic.status !== 'published') throw unprocessable('topicId', 'topicNotPublished');

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(assignments)
        .values({
          classId: dto.classId,
          subjectId: dto.subjectId,
          topicId: dto.topicId,
          dueAt: new Date(dto.dueAt),
          createdBy: teacherId,
        })
        .returning({ id: assignments.id });
      await this.audit.record(
        {
          actorId: teacherId,
          entityType: 'assignment',
          entityId: created!.id,
          action: 'assignment.created',
          after: { classId: dto.classId, subjectId: dto.subjectId, topicId: dto.topicId, dueAt: dto.dueAt },
        },
        tx,
      );
      return created!;
    });
  }

  /** API-T-23: задания учителя (по своим классам) со счётчиками BR-ASG-03; ближайший срок — первым. */
  async teacherList(teacherId: string, locale: Locale): Promise<TeacherAssignmentDto[]> {
    const rows = await this.db
      .select({
        id: assignments.id,
        topicId: assignments.topicId,
        className: classes.name,
        dueAt: assignments.dueAt,
      })
      .from(assignments)
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .where(and(eq(classes.teacherId, teacherId), isNull(classes.archivedAt)))
      .orderBy(desc(assignments.dueAt), desc(assignments.id));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [counts, names] = await Promise.all([
      this.db
        .select({ assignmentId: submissions.assignmentId, status: submissions.status, n: count() })
        .from(submissions)
        .where(inArray(submissions.assignmentId, ids))
        .groupBy(submissions.assignmentId, submissions.status),
      topicTitles(
        this.db,
        rows.map((r) => r.topicId),
        locale,
      ),
    ]);
    const n = (id: string, status?: string) =>
      counts
        .filter((c) => c.assignmentId === id && (!status || c.status === status))
        .reduce((sum, c) => sum + Number(c.n), 0);
    return rows.map((r) => ({
      id: r.id,
      topicTitle: names.get(r.topicId) ?? '',
      className: r.className,
      dueAt: r.dueAt.toISOString(),
      // Категории пересекаются: сданная и оценённая работа учитывается в обоих счётчиках (BR-ASG-03).
      counts: { submitted: n(r.id), inReview: n(r.id, 'in_review'), graded: n(r.id, 'graded') },
    }));
  }

  /** API-S-10 (PH-33): назначения действующих классов ученика по видимым ему темам; ближайший срок — первым. */
  async studentList(studentId: string, locale: Locale): Promise<StudentAssignmentDto[]> {
    const rows = await this.db
      .select({
        id: assignments.id,
        topicId: assignments.topicId,
        subjectId: assignments.subjectId,
        dueAt: assignments.dueAt,
      })
      .from(assignments)
      .innerJoin(
        m,
        and(eq(m.classId, assignments.classId), eq(m.studentId, studentId), eq(m.status, 'active')),
      )
      .orderBy(asc(assignments.dueAt), asc(assignments.id));
    const visible: typeof rows = [];
    for (const r of rows) {
      if (await this.visibility.canStudentSeeTopic(studentId, r.topicId)) visible.push(r);
    }
    if (visible.length === 0) return [];
    const [own, topicNames, subjectNames] = await Promise.all([
      this.db
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.studentId, studentId),
            inArray(
              submissions.assignmentId,
              visible.map((r) => r.id),
            ),
          ),
        ),
      topicTitles(
        this.db,
        visible.map((r) => r.topicId),
        locale,
      ),
      subjectTitles(
        this.db,
        visible.map((r) => r.subjectId),
        locale,
      ),
    ]);
    const now = Date.now();
    return visible.map((r) => {
      const submission = own.find((s) => s.assignmentId === r.id);
      const status = submission
        ? submission.status === 'graded'
          ? ('graded' as const)
          : ('submitted' as const)
        : ('not_started' as const);
      return {
        id: r.id,
        topicId: r.topicId,
        topicTitle: topicNames.get(r.topicId) ?? '',
        subjectTitle: subjectNames.get(r.subjectId) ?? '',
        dueAt: r.dueAt.toISOString(),
        status,
        grade:
          submission?.grade === null || submission?.grade === undefined ? null : Number(submission.grade),
        overdue: !submission && r.dueAt.getTime() < now,
        late: Boolean(submission?.submittedAt && submission.submittedAt > r.dueAt),
      };
    });
  }

  /**
   * Q-18: попытка в контексте назначения — назначение действующего класса ученика по той же теме; иначе 404
   * (чужое назначение не раскрывается, BR-ACL-03).
   */
  async assertStudentAssignment(studentId: string, assignmentId: string, topicId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(
        m,
        and(eq(m.classId, assignments.classId), eq(m.studentId, studentId), eq(m.status, 'active')),
      )
      .where(and(eq(assignments.id, assignmentId), eq(assignments.topicId, topicId)));
    if (!row) throw notFound();
  }

  /**
   * BR-ASG-03, SM-SUBMISSION, PH-29 (решение владельца 2026-10-17): завершённая попытка квиза темы засчитывается
   * сдачей каждого задания по этой теме в действующих классах ученика, выданного до завершения попытки, — и попытка из
   * задания (Q-18), и попытка из урока. status = graded, grade = лучший score_percent. После срока сдача тоже
   * принимается и помечается «Сдано после срока» (submitted_at > due_at). Запись — в транзакции finish; оценка —
   * в журнале аудита (REQ-NFR-SEC-05).
   */
  async recordSubmissions(
    tx: Tx,
    input: {
      assignmentId: string | null;
      topicId: string;
      studentId: string;
      attemptId: string;
      score: number;
      finishedAt: Date;
    },
  ): Promise<void> {
    const matching = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(
        m,
        and(eq(m.classId, assignments.classId), eq(m.studentId, input.studentId), eq(m.status, 'active')),
      )
      .where(and(eq(assignments.topicId, input.topicId), lte(assignments.createdAt, input.finishedAt)));
    const ids = new Set(matching.map((a) => a.id));
    if (input.assignmentId) ids.add(input.assignmentId);
    for (const assignmentId of [...ids].sort()) {
      await this.recordSubmission(tx, { ...input, assignmentId, now: input.finishedAt });
    }
  }

  private async recordSubmission(
    tx: Tx,
    input: { assignmentId: string; studentId: string; attemptId: string; score: number; now: Date },
  ): Promise<void> {
    const now = input.now;
    const [before] = await tx
      .select()
      .from(submissions)
      .where(
        and(eq(submissions.assignmentId, input.assignmentId), eq(submissions.studentId, input.studentId)),
      )
      .for('update');
    const grade = Math.max(Number(before?.grade ?? 0), input.score);
    const values = {
      status: 'graded' as const,
      grade: String(grade),
      submittedAt: before?.submittedAt ?? now,
      gradedAt: now,
      gradedBy: null,
    };
    await tx
      .insert(submissions)
      .values({ assignmentId: input.assignmentId, studentId: input.studentId, ...values })
      .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.studentId], set: values });
    await this.audit.record(
      {
        actorId: null,
        entityType: 'submission',
        entityId: input.assignmentId,
        action: 'submission.graded',
        before: before ? { grade: Number(before.grade) } : null,
        after: { studentId: input.studentId, attemptId: input.attemptId, grade },
      },
      tx,
    );
  }

  /** Предмет можно назначить классу: базовый (общий каталог) или свой, выданный этому классу. */
  private assignable(teacherId: string, classId: string) {
    return and(
      isNull(subjects.archivedAt),
      or(
        and(eq(subjects.isOfficial, true), eq(subjects.inPublicCatalog, true)),
        and(
          eq(subjects.ownerId, teacherId),
          sql`EXISTS (SELECT 1 FROM ${csa} WHERE ${csa.subjectId} = ${subjects.id}
            AND ${csa.classId} = ${classId} AND ${csa.revokedAt} IS NULL)`,
        ),
      ),
    );
  }

  /** BR-ACL-02: чужой или несуществующий класс — 404 (API-GEN-08). */
  private async ownClass(teacherId: string, classId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId), isNull(classes.archivedAt)));
    if (!row) throw notFound();
  }
}
