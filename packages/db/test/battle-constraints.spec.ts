import { type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type Database } from '../src';
import { anonymizeStudentBattles } from '../src/battle';
import { migrateUp } from '../src/migrator';
import {
  battleAnswers,
  battleOptions,
  battleParticipants,
  battleQuestions,
  battleQuizzes,
  battleSessions,
  classes,
  users,
} from '../src/schema';
import { pgErrorCode, startPostgres } from './pg';

/** 5.9 Battle: ограничения целостности, триггеры, RLS (итерация 10.5, AG-09). */
describe('Battle constraints and RLS (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  const teacher = uuidv7();
  const otherTeacher = uuidv7();
  const student = uuidv7();
  const outsider = uuidv7();
  const classId = uuidv7();
  const quizId = uuidv7();
  const questionId = uuidv7();
  const sessionId = uuidv7();
  let participantId: string;

  const session = (code: string, status: 'lobby' | 'in_progress' | 'finished' | 'cancelled' = 'lobby') => ({
    id: uuidv7(),
    battleQuizId: quizId,
    hostId: teacher,
    classId,
    code,
    status,
    settings: {
      shuffleQuestions: false,
      shuffleOptions: false,
      leaderboard: true,
      autoAdvance: false,
      lateJoin: false,
      maxParticipants: 100,
    },
    questionsSnapshot: [],
  });

  beforeAll(async () => {
    ({ container, db } = await startPostgres());
    await migrateUp(db);
    await db.insert(users).values([
      { id: teacher, email: 'battle-teacher@example.kz', displayName: 'Учитель' },
      { id: otherTeacher, email: 'battle-other@example.kz', displayName: 'Другой' },
      { id: student, displayName: 'Асель Каримова', login: 'asel', isChildSafe: true },
      { id: outsider, displayName: 'Ерлан', login: 'erlan', isChildSafe: true },
    ]);
    await db.insert(classes).values({ id: classId, name: '7А', teacherId: teacher });
    await db.insert(battleQuizzes).values({ id: quizId, ownerId: teacher, title: 'Сердце', locale: 'ru' });
    await db
      .insert(battleQuestions)
      .values({ id: questionId, battleQuizId: quizId, position: 1, type: 'single_choice', text: 'Q1' });
    await db.insert(battleSessions).values({ ...session('KTR583'), id: sessionId });
    const [p] = await db
      .insert(battleParticipants)
      .values({ sessionId, studentId: student, displayName: 'Асель К.' })
      .returning({ id: battleParticipants.id });
    participantId = p!.id;
  });

  afterAll(async () => {
    await db?.$client.end();
    await container?.stop();
  });

  it('BR-BTL-01 code must match ^[A-Z]{3}[1-9]{3}$', async () => {
    for (const code of ['ktr583', 'KTR083', 'KT5833']) {
      expect(await pgErrorCode(db.insert(battleSessions).values(session(code)))).toBe('23514');
    }
  });

  it('BR-BTL-01 ux_battle_active_code: code is unique among active sessions and freed after finish', async () => {
    expect(await pgErrorCode(db.insert(battleSessions).values(session('KTR583')))).toBe('23505');
    await db.insert(battleSessions).values(session('ABC123', 'finished'));
    await db.insert(battleSessions).values(session('ABC123', 'cancelled'));
    await db.insert(battleSessions).values(session('ABC123', 'lobby'));
  });

  it('BR-BTL-10 ux_battle_one_correct, 1–4 option positions, 5/10/20/30/60/90 s, two types only', async () => {
    await db
      .insert(battleOptions)
      .values({ battleQuestionId: questionId, position: 1, text: 'A', isCorrect: true });
    expect(
      await pgErrorCode(
        db
          .insert(battleOptions)
          .values({ battleQuestionId: questionId, position: 2, text: 'B', isCorrect: true }),
      ),
    ).toBe('23505');
    expect(
      await pgErrorCode(
        db.insert(battleOptions).values({ battleQuestionId: questionId, position: 5, text: 'E' }),
      ),
    ).toBe('23514');
    expect(
      await pgErrorCode(
        db
          .insert(battleQuestions)
          .values({ battleQuizId: quizId, position: 9, type: 'single_choice', text: 'Q', timeLimitSec: 15 }),
      ),
    ).toBe('23514');
    expect(
      await pgErrorCode(
        db
          .insert(battleQuestions)
          .values({ battleQuizId: quizId, position: 9, type: 'text_input', text: 'Q' }),
      ),
    ).toBe('23514');
  });

  it('5.9 battle_questions UNIQUE (quiz, position) is deferred until commit (reorder in one transaction)', async () => {
    const second = uuidv7();
    await db
      .insert(battleQuestions)
      .values({ id: second, battleQuizId: quizId, position: 2, type: 'true_false', text: 'Q2' });
    await db.transaction(async (tx) => {
      await tx.update(battleQuestions).set({ position: 2 }).where(eq(battleQuestions.id, questionId));
      await tx.update(battleQuestions).set({ position: 1 }).where(eq(battleQuestions.id, second));
    });
    expect(
      await pgErrorCode(
        db
          .insert(battleQuestions)
          .values({ battleQuizId: quizId, position: 1, type: 'true_false', text: 'Q3' }),
      ),
    ).toBe('23505');
  });

  it('BR-BTL-03 one answer per question and per clientAnswerId; response_ms >= 0', async () => {
    const answer = {
      sessionId,
      participantId,
      questionIndex: 0,
      optionPosition: 1,
      isCorrect: true,
      responseMs: 1200,
      answeredAt: new Date(),
      clientAnswerId: uuidv7(),
    };
    await db.insert(battleAnswers).values(answer);
    expect(await pgErrorCode(db.insert(battleAnswers).values({ ...answer, clientAnswerId: uuidv7() }))).toBe(
      '23505',
    );
    expect(await pgErrorCode(db.insert(battleAnswers).values({ ...answer, questionIndex: 1 }))).toBe('23505');
    expect(
      await pgErrorCode(
        db
          .insert(battleAnswers)
          .values({ ...answer, questionIndex: 2, clientAnswerId: uuidv7(), responseMs: -1 }),
      ),
    ).toBe('23514');
  });

  it('BR-BTL-02 one participant row per student and session', async () => {
    expect(
      await pgErrorCode(
        db.insert(battleParticipants).values({ sessionId, studentId: student, displayName: 'X' }),
      ),
    ).toBe('23505');
  });

  it('5.1 updated_at is refreshed by trigger on battle tables', async () => {
    const before = (await db.select().from(battleQuizzes).where(eq(battleQuizzes.id, quizId)))[0]!.updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    await db.update(battleQuizzes).set({ title: 'Сердце 2' }).where(eq(battleQuizzes.id, quizId));
    const after = (await db.select().from(battleQuizzes).where(eq(battleQuizzes.id, quizId)))[0]!.updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });

  it('5.9 RLS: with app.user_id set, a teacher sees only own tests/sessions, a student only own sessions and answers', async () => {
    const asUser = <T>(userId: string, fn: (tx: Database) => Promise<T>) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
        return fn(tx as unknown as Database);
      });
    expect(await asUser(teacher, (tx) => tx.select().from(battleQuizzes))).toHaveLength(1);
    expect(await asUser(otherTeacher, (tx) => tx.select().from(battleQuizzes))).toHaveLength(0);
    expect(await asUser(otherTeacher, (tx) => tx.select().from(battleQuestions))).toHaveLength(0);
    expect(await asUser(otherTeacher, (tx) => tx.select().from(battleSessions))).toHaveLength(0);
    const own = await asUser(student, (tx) => tx.select({ id: battleSessions.id }).from(battleSessions));
    expect(own.map((r) => r.id)).toEqual([sessionId]);
    expect(await asUser(student, (tx) => tx.select().from(battleAnswers))).toHaveLength(1);
    expect(await asUser(outsider, (tx) => tx.select().from(battleAnswers))).toHaveLength(0);
    expect(await asUser(outsider, (tx) => tx.select().from(battleParticipants))).toHaveLength(0);
    // Без контекста пользователя — без ограничения (основная защита — guards и сервисы).
    const all = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select().from(battleQuizzes);
    });
    expect(all).toHaveLength(1);
    // Чужому учителю нельзя создать тест от имени владельца.
    expect(
      await pgErrorCode(
        asUser(otherTeacher, (tx) =>
          tx.insert(battleQuizzes).values({ ownerId: teacher, title: 'X', locale: 'ru' }),
        ),
      ),
    ).toBe('42501');
  });

  it('BR-BTL-11 app_maintenance can delete battle answers, app_user cannot', async () => {
    expect(
      await pgErrorCode(
        db.transaction(async (tx) => {
          await tx.execute(sql`set local role app_user`);
          await tx.execute(sql`delete from battle_answers`);
        }),
      ),
    ).toBe('42501');
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_maintenance`);
      await tx.execute(sql`delete from battle_answers where participant_id = ${participantId}`);
    });
    expect(await db.select().from(battleAnswers)).toHaveLength(0);
  });

  it('BR-BTL-11 anonymize: answers removed, name «Участник», final results kept; idempotent', async () => {
    await db
      .update(battleParticipants)
      .set({ finalRank: 2, correctCount: 1, correctTimeMs: 900 })
      .where(eq(battleParticipants.id, participantId));
    await db.insert(battleAnswers).values({
      sessionId,
      participantId,
      questionIndex: 0,
      optionPosition: 1,
      isCorrect: true,
      responseMs: 900,
      answeredAt: new Date(),
      clientAnswerId: uuidv7(),
    });
    expect(await anonymizeStudentBattles(db, student)).toEqual({ participants: 1, answers: 1 });
    const [p] = await db.select().from(battleParticipants).where(eq(battleParticipants.id, participantId));
    expect(p).toMatchObject({ displayName: 'Участник', finalRank: 2, correctCount: 1, correctTimeMs: 900 });
    expect(await db.select().from(battleAnswers)).toHaveLength(0);
    expect(await anonymizeStudentBattles(db, student)).toEqual({ participants: 1, answers: 0 });
    expect(await anonymizeStudentBattles(db, outsider)).toEqual({ participants: 0, answers: 0 });
  });
});
