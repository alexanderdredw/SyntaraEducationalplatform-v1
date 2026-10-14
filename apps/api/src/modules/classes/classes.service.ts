import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { type Response } from 'express';
import { type Locale, type RegisterStudentDto } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { createAccount } from '../auth/accounts';
import { hashPassword } from '../auth/auth.service';
import { type AuthUser } from '../auth/auth.types';
import { SessionService } from '../auth/session.service';
import { type MeDto } from '../users/me.dto';
import { MeService } from '../users/me.service';
import { ClassCodesService } from './class-codes.service';
import { type IssuedCodeDto, type StudentClassDto, type TeacherClassDto } from './classes.dto';

const { classes, classMemberships: m, schools } = schema;

export const codeNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Code not found or expired', { code: 'invalidCode' });

/**
 * Классы и членство (7.7, SM-MEMBERSHIP): учитель работает только со своими классами (BR-ACL-02, чужой → 404);
 * вступление — после входа и подтверждения, без второй активной записи (BR-CLS-02); выход сохраняет результаты
 * (BR-CLS-03). Изменения состава пишутся в audit_log (REQ-NFR-SEC-05).
 */
@Injectable()
export class ClassesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly codes: ClassCodesService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly me: MeService,
    private readonly config: AppConfigService,
  ) {}

  /** API-T-04 */
  async teacherClasses(teacherId: string): Promise<TeacherClassDto[]> {
    const rows = await this.db
      .select({ id: classes.id, name: classes.name, studentsCount: count(m.id) })
      .from(classes)
      .leftJoin(m, and(eq(m.classId, classes.id), eq(m.status, 'active')))
      .where(and(eq(classes.teacherId, teacherId), isNull(classes.archivedAt)))
      .groupBy(classes.id)
      .orderBy(asc(classes.createdAt), asc(classes.id));
    return rows;
  }

  /** API-T-05 */
  async create(teacherId: string, name: string): Promise<TeacherClassDto> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(classes)
        .values({ teacherId, name })
        .returning({ id: classes.id, name: classes.name });
      await this.audit.record(
        { actorId: teacherId, entityType: 'class', entityId: row!.id, action: 'create', after: { name } },
        tx,
      );
      return { ...row!, studentsCount: 0 };
    });
  }

  /** API-T-06: код показывается один раз; в БД — хеш (BR-CLS-01). */
  async issueCode(teacherId: string, classId: string): Promise<IssuedCodeDto> {
    await this.ownClass(teacherId, classId);
    const { code, expiresAt } = await this.codes.issue(classId, teacherId);
    await this.audit.record({
      actorId: teacherId,
      entityType: 'class',
      entityId: classId,
      action: 'invite_code_issued',
      after: { expiresAt: expiresAt.toISOString() },
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /** API-PUB-08: только признак годности — без данных класса (BR-CLS-02). */
  async check(code: string): Promise<{ valid: boolean }> {
    return { valid: (await this.codes.findActive(code)) !== null };
  }

  /** API-S-01: повторное вступление в тот же класс не создаёт второй записи (ux_membership_active). */
  async join(student: AuthUser, code: string): Promise<StudentClassDto> {
    const classId = await this.db.transaction(async (tx) => {
      const active = await this.codes.findActive(code, tx);
      if (!active) throw codeNotFound();
      await this.addMember(tx, active.classId, student.id, student.id);
      return active.classId;
    });
    return (await this.classOf(student.id, classId))!;
  }

  /** API-S-02: текущий класс ученика (последний, в который он вступил) или null. */
  async studentClass(studentId: string): Promise<StudentClassDto | null> {
    return this.classOf(studentId);
  }

  /** API-S-03 (BR-CLS-03, PH-40): status = left, left_at = now(); личные результаты не трогаются. */
  async leave(student: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select({ id: m.id, classId: m.classId })
        .from(m)
        .where(and(eq(m.studentId, student.id), eq(m.status, 'active')))
        .orderBy(desc(m.joinedAt))
        .limit(1)
        .for('update');
      if (!membership) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not a class member');
      await tx.update(m).set({ status: 'left', leftAt: new Date() }).where(eq(m.id, membership.id));
      await this.audit.record(
        {
          actorId: student.id,
          entityType: 'class_membership',
          entityId: membership.id,
          action: 'leave',
          before: { status: 'active', classId: membership.classId },
          after: { status: 'left', classId: membership.classId },
        },
        tx,
      );
    });
  }

  /**
   * PH-44: регистрация ученика только по действующему коду класса. Код проверяется повторно; пользователь
   * (без email — child-safe), роль, предпочтения, согласие и активное членство — одной транзакцией; затем вход.
   * Ответ без действующего кода не раскрывает данных класса.
   */
  async registerStudent(
    dto: RegisterStudentDto,
    locale: Locale,
    userAgent: string | undefined,
    res: Response,
  ): Promise<MeDto> {
    const settings = await this.config.get<{ enabled: boolean }>('auth.student_registration_by_class_code');
    if (!settings.enabled) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const min = await this.config.get<number>('auth.password_min_length');
    if (dto.password.length < min) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Password is too short', {
        password: 'passwordTooShort',
      });
    }
    const passwordHash = await hashPassword(dto.password);
    const userId = await this.db.transaction(async (tx) => {
      const active = await this.codes.findActive(dto.code, tx);
      if (!active) throw codeNotFound();
      const id = await createAccount(tx, {
        email: dto.email ? dto.email : null,
        login: dto.login,
        displayName: dto.displayName,
        passwordHash,
        role: 'student',
        locale,
      });
      await this.addMember(tx, active.classId, id, id);
      return id;
    });
    await this.sessions.create(userId, userAgent, res);
    return this.me.me({ id: userId, displayName: dto.displayName, roles: ['student'], sessionId: '' });
  }

  private async addMember(tx: Tx, classId: string, studentId: string, actorId: string): Promise<void> {
    const inserted = await tx
      .insert(m)
      .values({ classId, studentId, status: 'active' })
      .onConflictDoNothing()
      .returning({ id: m.id });
    if (inserted.length === 0) return;
    await this.audit.record(
      {
        actorId,
        entityType: 'class_membership',
        entityId: inserted[0]!.id,
        action: 'join',
        after: { status: 'active', classId },
      },
      tx,
    );
  }

  private async classOf(studentId: string, classId?: string): Promise<StudentClassDto | null> {
    const teacher = schema.users;
    const [row] = await this.db
      .select({
        classId: classes.id,
        className: classes.name,
        teacherName: teacher.displayName,
        schoolName: schools.name,
      })
      .from(m)
      .innerJoin(classes, eq(classes.id, m.classId))
      .innerJoin(teacher, eq(teacher.id, classes.teacherId))
      .leftJoin(schools, eq(schools.id, classes.schoolId))
      .where(
        and(eq(m.studentId, studentId), eq(m.status, 'active'), classId ? eq(m.classId, classId) : undefined),
      )
      .orderBy(desc(m.joinedAt))
      .limit(1);
    return row ? { ...row, schoolName: row.schoolName ?? null } : null;
  }

  /** BR-ACL-02: чужой или несуществующий класс — 404 (API-GEN-08). */
  private async ownClass(teacherId: string, classId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId), isNull(classes.archivedAt)));
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
  }
}
