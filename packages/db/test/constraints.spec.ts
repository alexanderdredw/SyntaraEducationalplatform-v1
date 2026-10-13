import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type Database } from '../src';
import { migrateUp } from '../src/migrator';
import {
  answerOptions,
  assignments,
  auditLog,
  classes,
  classMemberships,
  learningEvents,
  questions,
  schools,
  topics,
  userRoles,
  users,
  xpLedger,
} from '../src/schema';
import { DEMO_IDS, runSeed, VISUAL_IDS } from '../src/seed';
import { pgErrorCode, startPostgres } from './pg';

/** Ограничения целостности раздела 5 (AG-09: не удалять). */
describe('constraints, triggers, roles, RLS (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;

  beforeAll(async () => {
    ({ container, db } = await startPostgres());
    await migrateUp(db);
    await runSeed(db, 'visual');
  });

  afterAll(async () => {
    await db?.$client.end();
    await container?.stop();
  });

  it('BR-QZ-02 ux_one_correct: a question cannot have two correct options', async () => {
    const code = await pgErrorCode(
      db.insert(answerOptions).values({ questionId: DEMO_IDS.demoQuestion, position: 9, isCorrect: true }),
    );
    expect(code).toBe('23505');
  });

  it('BR-CLS-02 ux_membership_active: no second active membership; a left one allows re-join', async () => {
    const dup = await pgErrorCode(
      db.insert(classMemberships).values({ classId: VISUAL_IDS.class7, studentId: VISUAL_IDS.alexandr }),
    );
    expect(dup).toBe('23505');
    await db.insert(classMemberships).values({
      classId: VISUAL_IDS.class5,
      studentId: VISUAL_IDS.alexandr,
      status: 'left',
      leftAt: new Date(),
    });
    await db.insert(classMemberships).values({ classId: VISUAL_IDS.class5, studentId: VISUAL_IDS.alexandr });
  });

  it('BR-ASG-01 check_assignment_topic: topic must belong to the assignment subject', async () => {
    const code = await pgErrorCode(
      db.insert(assignments).values({
        classId: VISUAL_IDS.class9,
        subjectId: VISUAL_IDS.subjectBotany,
        topicId: DEMO_IDS.topicCardio,
        dueAt: new Date(),
        createdBy: VISUAL_IDS.alexandr,
      }),
    );
    expect(code).toBe('23514');
  });

  it('5.3 users: email is required unless the account is child-safe', async () => {
    expect(await pgErrorCode(db.insert(users).values({ displayName: 'No email' }))).toBe('23514');
    await db.insert(users).values({ displayName: 'Kid', login: 'kid-1', isChildSafe: true });
  });

  it('5.3 users.email is case-insensitive unique (citext)', async () => {
    expect(
      await pgErrorCode(db.insert(users).values({ email: 'ALEXANDR@example.com', displayName: 'Dup' })),
    ).toBe('23505');
  });

  it('Q-15 user_roles: UNIQUE NULLS NOT DISTINCT blocks duplicate roles without a school', async () => {
    const userId = uuidv7();
    await db.insert(users).values({ id: userId, email: 'roles@example.com', displayName: 'R' });
    await db.insert(userRoles).values({ userId, role: 'support_agent' });
    expect(await pgErrorCode(db.insert(userRoles).values({ userId, role: 'support_agent' }))).toBe('23505');
  });

  it('5.4 topics UNIQUE (subject_id, position) is deferred until commit', async () => {
    // Перестановка двух тем в одной транзакции проходит благодаря DEFERRABLE INITIALLY DEFERRED.
    await db.transaction(async (tx) => {
      await tx.update(topics).set({ position: 2 }).where(eq(topics.id, DEMO_IDS.topicCardio));
      await tx.update(topics).set({ position: 1 }).where(eq(topics.id, VISUAL_IDS.topicRespiratory));
    });
    const code = await pgErrorCode(
      db.update(topics).set({ position: 1 }).where(eq(topics.id, DEMO_IDS.topicCardio)),
    );
    expect(code).toBe('23505');
  });

  it('BR-XP-02 xp_ledger is unique per (student, source event, reason)', async () => {
    const [event] = await db
      .select({ id: learningEvents.id })
      .from(learningEvents)
      .where(eq(learningEvents.studentId, VISUAL_IDS.alexandr))
      .limit(1);
    const row = {
      studentId: VISUAL_IDS.alexandr,
      amount: 10,
      reason: 'quiz_finished',
      sourceEventId: event!.id,
    };
    await db.insert(xpLedger).values(row).onConflictDoNothing();
    expect(await pgErrorCode(db.insert(xpLedger).values(row))).toBe('23505');
  });

  it('5.6 learning_events: idempotency key is unique per student and type is checked', async () => {
    const base = {
      studentId: VISUAL_IDS.alexandr,
      occurredAt: new Date(),
      idempotencyKey: 'lesson:x:2026-09-28',
    };
    await db.insert(learningEvents).values({ ...base, type: 'lesson_opened' });
    expect(await pgErrorCode(db.insert(learningEvents).values({ ...base, type: 'lesson_opened' }))).toBe(
      '23505',
    );
    expect(
      await pgErrorCode(db.insert(learningEvents).values({ ...base, idempotencyKey: 'k2', type: 'clicked' })),
    ).toBe('23514');
  });

  it('5.4/5.5/5.7 length CHECKs reject over-limit texts', async () => {
    expect(await pgErrorCode(db.insert(schools).values({ name: 'x'.repeat(201) }))).toBe('23514');
    expect(
      await pgErrorCode(db.insert(classes).values({ name: 'x'.repeat(51), teacherId: VISUAL_IDS.alexandr })),
    ).toBe('23514');
  });

  it('5.1 updated_at is refreshed by trigger on UPDATE', async () => {
    const [before] = await db.select().from(questions).where(eq(questions.id, DEMO_IDS.demoQuestion));
    await new Promise((r) => setTimeout(r, 20));
    await db.update(questions).set({ position: 1 }).where(eq(questions.id, DEMO_IDS.demoQuestion));
    const [after] = await db.select().from(questions).where(eq(questions.id, DEMO_IDS.demoQuestion));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it('5.8 app_user can INSERT into audit_log but cannot UPDATE, DELETE or read it', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      await tx.insert(auditLog).values({ entityType: 'class', action: 'create' });
    });
    for (const statement of [
      sql`update audit_log set action = 'x'`,
      sql`delete from audit_log`,
      sql`select * from audit_log`,
    ]) {
      const code = await pgErrorCode(
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_user`);
          await tx.execute(statement);
        }),
      );
      expect(code).toBe('42501');
    }
  });

  it('5.8 app_user has no DDL and no DELETE on working tables', async () => {
    for (const statement of [sql`create table hack (id int)`, sql`delete from users`]) {
      const code = await pgErrorCode(
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_user`);
          await tx.execute(statement);
        }),
      );
      expect(code).toBe('42501');
    }
  });

  it('5.8 app_user cannot DELETE even from retention tables', async () => {
    for (const statement of [sql`delete from ai_messages`, sql`delete from media_files`]) {
      const code = await pgErrorCode(
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_user`);
          await tx.execute(statement);
        }),
      );
      expect(code).toBe('42501');
    }
  });

  it('5.8 app_maintenance deletes only retention/technical rows (PH-18, BR-FILE-03)', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_maintenance`);
      await tx.execute(sql`delete from ai_messages where created_at < now() - interval '365 days'`);
      await tx.execute(sql`delete from media_files where scan_status = 'rejected'`);
      await tx.execute(sql`delete from idempotency_keys where expires_at < now()`);
    });
    for (const statement of [
      sql`delete from users`,
      sql`delete from classes`,
      sql`delete from audit_log`,
      sql`select * from audit_log`,
      sql`insert into outbox_events (id, type, payload) values (gen_random_uuid(), 'x', '{}')`,
      sql`update support_tickets set status = 'closed'`,
      sql`create table hack (id int)`,
    ]) {
      const code = await pgErrorCode(
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_maintenance`);
          await tx.execute(statement);
        }),
      );
      expect(code).toBe('42501');
    }
  });

  it('5.8 analytics_ro can only read', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role analytics_ro`);
      expect((await tx.select().from(classes)).length).toBeGreaterThan(0);
    });
    const code = await pgErrorCode(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role analytics_ro`);
        await tx.execute(sql`update classes set name = 'x'`);
      }),
    );
    expect(code).toBe('42501');
  });

  it('5.1 RLS: with app.school_id set, app_user sees only that school (and school-less) rows', async () => {
    const otherSchool = uuidv7();
    await db.insert(schools).values({ id: otherSchool, name: 'Другая школа' });
    await db.insert(classes).values({ name: 'Чужой', schoolId: otherSchool, teacherId: VISUAL_IDS.alexandr });

    const visibleNames = async (schoolId?: string) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        if (schoolId) await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
        return (await tx.select({ name: classes.name }).from(classes)).map((r) => r.name);
      });

    expect(await visibleNames()).toEqual(expect.arrayContaining(['9', 'Чужой']));
    const scoped = await visibleNames(VISUAL_IDS.school);
    expect(scoped).toEqual(expect.arrayContaining(['9', '5', '7']));
    expect(scoped).not.toContain('Чужой');

    const code = await pgErrorCode(
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        await tx.execute(sql`select set_config('app.school_id', ${VISUAL_IDS.school}, true)`);
        await tx.insert(classes).values({ name: 'X', schoolId: otherSchool, teacherId: VISUAL_IDS.alexandr });
      }),
    );
    expect(code).toBe('42501');
  });
});
