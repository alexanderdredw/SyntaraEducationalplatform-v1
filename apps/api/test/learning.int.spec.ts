import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { localDate } from '@syntara/shared';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { GamificationService } from '../src/modules/gamification/gamification.service';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const TZ = 'Asia/Almaty';

/** Итерация 8: обучение ученика — каталог, урок, квиз, XP, серия, бейджи (AC-ST-02..05, BR-VIS-01). */
describe('student learning (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  let teacher: Session;
  let student: Session;
  let outsider: Session;
  let classId: string;
  let subjectId: string;
  let topicId: string;
  let quizId: string;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie).set('Accept-Language', 'ru'),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .set('Accept-Language', 'ru')
        .send(body),
    put: (path: string, body: object) =>
      http().put(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf),
  });
  const choice = (n: number, correct = 0) => ({
    type: 'single_choice',
    difficulty: 'medium',
    translations: { ru: { text: `Вопрос ${n}`, explanation: `Объяснение ${n}` } },
    options: [0, 1, 2, 3].map((i) => ({
      translations: { ru: `Вариант ${n}.${i}` },
      isCorrect: i === correct,
    })),
  });

  async function topicWithQuiz(title: string, questionsCount: number, extra: object[] = []) {
    const id = (await as(teacher).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body
      .id as string;
    await as(teacher)
      .put(`/api/teacher/topics/${id}`, {
        translations: {
          ru: { title, description: `Описание: ${title}`, funFact: 'Факт', bodyMd: '## Текст' },
        },
        materialIds: [],
      })
      .expect(204);
    for (let n = 1; n <= questionsCount; n++) {
      await as(teacher).post(`/api/teacher/topics/${id}/quiz/questions`, choice(n)).expect(201);
    }
    for (const q of extra) await as(teacher).post(`/api/teacher/topics/${id}/quiz/questions`, q).expect(201);
    await as(teacher).post(`/api/teacher/topics/${id}/publish`).expect(200);
    const lesson = await as(student).get(`/api/student/topics/${id}`).expect(200);
    return { id, quizId: lesson.body.quizId as string };
  }

  async function newStudent(loginName: string, code?: string): Promise<Session> {
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({
        displayName: 'Ученик',
        login: loginName,
        password: 'student-pass-1',
        ...(code ? { code } : {}),
      })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  /** Ответить на все вопросы попытки: первые `correct` — верно, остальные — неверно. */
  async function answerAll(
    s: Session,
    attempt: {
      attemptId: string;
      questions: Array<{ id: string; options: Array<{ id: string; text: string }> }>;
    },
    correct: number,
  ) {
    for (const [i, q] of attempt.questions.entries()) {
      const right = q.options.find((o) => o.text.endsWith('.0'))!;
      const wrong = q.options.find((o) => o.text.endsWith('.1'))!;
      await as(s)
        .post(`/api/student/attempts/${attempt.attemptId}/answers`, {
          questionId: q.id,
          optionId: i < correct ? right.id : wrong.id,
        })
        .expect(200);
    }
  }

  const stats = async (s: Session) => (await as(s).get('/api/me/stats').expect(200)).body;

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
    const cls = await as(teacher).post('/api/teacher/classes', { name: '9 «А»' }).expect(201);
    classId = cls.body.id;
    const code = (await as(teacher).post(`/api/teacher/classes/${classId}/invite-codes`).expect(201)).body
      .code;
    student = await newStudent('learn.student', code);
    outsider = await newStudent('learn.outsider');
    subjectId = (
      await as(teacher)
        .post('/api/teacher/subjects', {
          translations: { ru: { title: 'Ботаника' } },
          inPublicCatalog: false,
        })
        .expect(201)
    ).body.id;
    await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
    ({ id: topicId, quizId } = await topicWithQuiz('Растения', 20));
  });

  afterAll(() => stack?.stop());

  it('API-S-04, API-S-05, REQ-ST-CAT-02/03 catalog, section and the subject page show only visible content', async () => {
    const catalog = await as(student).get('/api/student/catalog').expect(200);
    expect(catalog.body.subjects.map((s: { id: string }) => s.id)).toContain(subjectId);
    const section = await as(student).get(`/api/student/sections/${B.sectionBiology}`).expect(200);
    expect(section.body.subjects.map((s: { id: string }) => s.id)).toContain(B.subjectAnatomy);
    await as(student).get('/api/student/sections/0190a1b2-0000-7000-8000-000000000000').expect(404);

    // Черновик в предмете не показывается.
    await as(teacher).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201);
    const page = await as(student).get(`/api/student/subjects/${subjectId}`).expect(200);
    expect(page.body).toMatchObject({ id: subjectId, title: 'Ботаника' });
    expect(page.body.topics).toEqual([{ id: topicId, number: 1, title: 'Растения', status: 'not_started' }]);
  });

  it('BR-VIS-01 a student of another class and a guest cannot see the subject, lesson or quiz (404/401)', async () => {
    await as(outsider).get(`/api/student/subjects/${subjectId}`).expect(404);
    await as(outsider).get(`/api/student/topics/${topicId}`).expect(404);
    await as(outsider).post(`/api/student/quizzes/${quizId}/attempts`).expect(404);
    const catalog = await as(outsider).get('/api/student/catalog').expect(200);
    expect(catalog.body.subjects.map((s: { id: string }) => s.id)).not.toContain(subjectId);
    await http().get(`/api/student/topics/${topicId}`).expect(401);
  });

  it('API-S-06, REQ-ST-LES-02 the lesson has the quiz id, the fun fact and the number of questions', async () => {
    const lesson = await as(student).get(`/api/student/topics/${topicId}`).expect(200);
    expect(lesson.body).toMatchObject({
      quizId,
      funFact: 'Факт',
      questionsCount: 20,
      number: 1,
      title: 'Растения',
    });
  });

  it('AC-ST-02, AC-ST-03, BR-QZ-01/04/06 no correct answer before answering; instant check; the attempt resumes', async () => {
    const started = await as(student).post(`/api/student/quizzes/${quizId}/attempts`).expect(200);
    expect(started.body.questions).toHaveLength(20);
    expect(JSON.stringify(started.body)).not.toMatch(/isCorrect|is_correct|correctOptionId|explanation/);
    const q = started.body.questions[0];
    const res = await as(student)
      .post(`/api/student/attempts/${started.body.attemptId}/answers`, {
        questionId: q.id,
        optionId: q.options[1].id,
      })
      .expect(200);
    expect(res.body).toEqual({
      correct: false,
      correctOptionId: q.options[0].id,
      correctAnswer: null,
      explanation: 'Объяснение 1',
    });
    // Повторный ответ на тот же вопрос — прежний результат, ответ не меняется.
    const again = await as(student)
      .post(`/api/student/attempts/${started.body.attemptId}/answers`, {
        questionId: q.id,
        optionId: q.options[0].id,
      })
      .expect(200);
    expect(again.body.correct).toBe(false);
    // Возврат — та же попытка с уже данным ответом.
    const resumed = await as(student).post(`/api/student/quizzes/${quizId}/attempts`).expect(200);
    expect(resumed.body.attemptId).toBe(started.body.attemptId);
    expect(resumed.body.answered[q.id]).toMatchObject({ optionId: q.options[1].id, correct: false });
    // BR-ACL-03: чужая попытка → 404.
    await as(outsider)
      .post(`/api/student/attempts/${started.body.attemptId}/answers`, {
        questionId: q.id,
        optionId: q.options[0].id,
      })
      .expect(404);
    await as(outsider).post(`/api/student/attempts/${started.body.attemptId}/finish`).expect(404);
    // Завершаем, чтобы следующий тест начал новую попытку.
    await as(student).post(`/api/student/attempts/${started.body.attemptId}/finish`).expect(200);
  });

  it('AC-ST-04, BR-XP-01 finishing with 85 % → +17 XP (round(20 × 17 / 20)), the topic is mastered, «Первый шаг» and «Тема освоена»', async () => {
    const { id, quizId: quiz } = await topicWithQuiz('Листья', 20);
    const fresh = await newStudent('learn.ac04', undefined);
    await stack.db.insert(schema.classMemberships).values({ classId, studentId: fresh.userId });
    const attempt = (await as(fresh).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    await answerAll(fresh, attempt, 17);
    const finished = await as(fresh).post(`/api/student/attempts/${attempt.attemptId}/finish`).expect(200);
    expect(finished.body.scorePercent).toBe(85);
    expect(finished.body.xpAwarded).toBe(17);
    expect(finished.body.badgesAwarded.map((b: { code: string }) => b.code).sort()).toEqual([
      'first_step',
      'topic_mastered',
    ]);
    expect(finished.body.badgesAwarded).toContainEqual({ code: 'first_step', title: 'Первый шаг' });
    const [mastery] = await stack.db
      .select()
      .from(schema.topicMastery)
      .where(and(eq(schema.topicMastery.studentId, fresh.userId), eq(schema.topicMastery.topicId, id)));
    expect(mastery).toMatchObject({ bestPercent: '85.00', attemptsCount: 1 });
    expect(mastery!.masteredAt).not.toBeNull();
    expect(await stats(fresh)).toMatchObject({ xpTotal: 17, streakDays: 1 });
    // Повторный finish → 409, ответ после завершения → 409 (SM-ATTEMPT).
    await as(fresh).post(`/api/student/attempts/${attempt.attemptId}/finish`).expect(409);
    await as(fresh)
      .post(`/api/student/attempts/${attempt.attemptId}/answers`, {
        questionId: attempt.questions[0].id,
        optionId: attempt.questions[0].options[0].id,
      })
      .expect(409);

    // AC-ST-05: повторная обработка того же события — без повторного начисления.
    const [event] = await stack.db
      .select()
      .from(schema.learningEvents)
      .where(
        and(
          eq(schema.learningEvents.studentId, fresh.userId),
          eq(schema.learningEvents.type, 'quiz_finished'),
        ),
      );
    const again = await stack.db.transaction((tx) =>
      stack.app.get(GamificationService).process(
        tx,
        {
          id: event!.id,
          studentId: fresh.userId,
          type: 'quiz_finished',
          topicId: id,
          idempotencyKey: event!.idempotencyKey,
        },
        'ru',
      ),
    );
    expect(again).toEqual({ xpAwarded: 0, badgesAwarded: [] });
    expect((await stats(fresh)).xpTotal).toBe(17);

    // Лучший результат сохраняется, попытки считаются (BR-QZ-06).
    const second = (await as(fresh).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    await answerAll(fresh, second, 5);
    const low = await as(fresh).post(`/api/student/attempts/${second.attemptId}/finish`).expect(200);
    // BR-XP-01: повтор хуже лучшего результата — прирост 0 (не отрицательный).
    expect(low.body).toMatchObject({ scorePercent: 25, xpAwarded: 0, badgesAwarded: [] });
    // Повтор лучше лучшего — только прирост: 20 − 17 = 3.
    const third = (await as(fresh).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    await answerAll(fresh, third, 20);
    const top = await as(fresh).post(`/api/student/attempts/${third.attemptId}/finish`).expect(200);
    expect(top.body).toMatchObject({ scorePercent: 100, xpAwarded: 3 });
    expect((await stats(fresh)).xpTotal).toBe(20);
    const [after] = await stack.db
      .select()
      .from(schema.topicMastery)
      .where(and(eq(schema.topicMastery.studentId, fresh.userId), eq(schema.topicMastery.topicId, id)));
    expect(after).toMatchObject({ bestPercent: '100.00', attemptsCount: 3 });

    // API-S-18: статусы тем ученика — «Освоена», «Начата», «Не начата».
    const statuses = async () =>
      Object.fromEntries(
        (await as(fresh).get(`/api/student/subjects/${subjectId}`).expect(200)).body.topics.map(
          (t: { id: string; status: string }) => [t.id, t.status],
        ),
      );
    expect((await statuses())[id]).toBe('mastered');
    expect((await statuses())[topicId]).toBe('not_started');
    await as(fresh)
      .post('/api/student/events', {
        type: 'lesson_opened',
        topicId,
        idempotencyKey: `lesson:${topicId}:${localDate(new Date(), TZ)}`,
      })
      .expect(204);
    expect((await statuses())[topicId]).toBe('started');
  });

  it('BR-XP-01 0 correct answers → 0 XP and no ledger row; the attempt and the streak day still count', async () => {
    const { quizId: quiz } = await topicWithQuiz('Корни', 4);
    const fresh = await newStudent('learn.zero', undefined);
    await stack.db.insert(schema.classMemberships).values({ classId, studentId: fresh.userId });
    const attempt = (await as(fresh).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    await answerAll(fresh, attempt, 0);
    const finished = await as(fresh).post(`/api/student/attempts/${attempt.attemptId}/finish`).expect(200);
    expect(finished.body).toMatchObject({ scorePercent: 0, xpAwarded: 0 });
    const ledger = await stack.db
      .select()
      .from(schema.xpLedger)
      .where(eq(schema.xpLedger.studentId, fresh.userId));
    expect(ledger).toEqual([]);
    expect(await stats(fresh)).toMatchObject({ xpTotal: 0, streakDays: 1 });
  });

  it('BR-BDG-01 «Исправился»: a topic mastered after a failed attempt (< 50 %)', async () => {
    const { quizId: quiz } = await topicWithQuiz('Корни', 4);
    const fresh = await newStudent('learn.comeback');
    await stack.db.insert(schema.classMemberships).values({ classId, studentId: fresh.userId });
    const first = (await as(fresh).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    await answerAll(fresh, first, 1);
    expect(
      (await as(fresh).post(`/api/student/attempts/${first.attemptId}/finish`).expect(200)).body.scorePercent,
    ).toBe(25);
    const second = (await as(fresh).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    await answerAll(fresh, second, 4);
    const done = await as(fresh).post(`/api/student/attempts/${second.attemptId}/finish`).expect(200);
    expect(done.body.badgesAwarded.map((b: { code: string }) => b.code)).toEqual(
      expect.arrayContaining(['topic_mastered', 'comeback']),
    );
  });

  it('BR-QZ-03 text answers are normalised; true/false uses fixed options', async () => {
    const { quizId: quiz } = await topicWithQuiz('Цветы', 0, [
      {
        type: 'text_input',
        difficulty: 'easy',
        translations: { ru: { text: 'Сколько лепестков?' } },
        textAnswer: 'Пять Лепестков',
      },
      {
        type: 'true_false',
        difficulty: 'easy',
        translations: { ru: { text: 'Цветок — орган растения' } },
        options: [
          { translations: {}, isCorrect: true },
          { translations: {}, isCorrect: false },
        ],
      },
    ]);
    const attempt = (await as(student).post(`/api/student/quizzes/${quiz}/attempts`).expect(200)).body;
    const [text, tf] = attempt.questions;
    expect(text.options).toEqual([]);
    expect(tf.options.map((o: { text: string }) => o.text)).toEqual(['Верно', 'Неверно']);
    const res = await as(student)
      .post(`/api/student/attempts/${attempt.attemptId}/answers`, {
        questionId: text.id,
        textAnswer: '  пять   лепестков ',
      })
      .expect(200);
    expect(res.body).toMatchObject({ correct: true, correctAnswer: 'Пять Лепестков' });
    await as(student)
      .post(`/api/student/attempts/${attempt.attemptId}/answers`, { questionId: text.id })
      .expect(400);
  });

  it('API-S-17, BR-XP-01 lesson_opened: +5 XP only for the first opening; same key — no new event', async () => {
    const fresh = await newStudent('learn.lesson');
    await stack.db.insert(schema.classMemberships).values({ classId, studentId: fresh.userId });
    const today = localDate(new Date(), TZ);
    const open = (key: string) =>
      as(fresh).post('/api/student/events', { type: 'lesson_opened', topicId, idempotencyKey: key });
    await open(`lesson:${topicId}:${today}`).expect(204);
    await open(`lesson:${topicId}:${today}`).expect(204);
    expect(await stats(fresh)).toMatchObject({ xpTotal: 5, streakDays: 1, continueTopicId: topicId });
    await open(`lesson:${topicId}:2030-01-01`).expect(204);
    expect((await stats(fresh)).xpTotal).toBe(5);
    const events = await stack.db
      .select()
      .from(schema.learningEvents)
      .where(eq(schema.learningEvents.studentId, fresh.userId));
    expect(events).toHaveLength(2);
    await open(`lesson:${subjectId}:${today}`).expect(400);
    await as(outsider)
      .post('/api/student/events', {
        type: 'lesson_opened',
        topicId,
        idempotencyKey: `lesson:${topicId}:${today}`,
      })
      .expect(404);
  });

  it('BR-ST-03 the header streak is 0 when the last activity was before yesterday', async () => {
    const fresh = await newStudent('learn.streak');
    await stack.db.insert(schema.studentStats).values({
      studentId: fresh.userId,
      xpTotal: 30,
      level: 1,
      streakCurrent: 4,
      streakBest: 4,
      lastActivityDate: '2020-01-01',
    });
    expect(await stats(fresh)).toEqual({ xpTotal: 30, streakDays: 0, continueTopicId: null });
  });

  it('AC-AUTH-04, BR-CLS-03, REQ-TCH-PUB-05 unpublishing, revoking access or leaving the class hides the topic', async () => {
    const { id, quizId: quiz } = await topicWithQuiz('Семена', 2);
    await as(student).get(`/api/student/topics/${id}`).expect(200);
    await as(teacher).post(`/api/teacher/topics/${id}/unpublish`).expect(200);
    await as(student).get(`/api/student/topics/${id}`).expect(404);
    await as(student).post(`/api/student/quizzes/${quiz}/attempts`).expect(404);
    await as(teacher).post(`/api/teacher/topics/${id}/publish`).expect(200);
    await as(student).get(`/api/student/topics/${id}`).expect(200);

    await as(teacher).delete(`/api/teacher/subjects/${subjectId}/access/${classId}`).expect(204);
    await as(student).get(`/api/student/subjects/${subjectId}`).expect(404);
    await as(student).get(`/api/student/topics/${id}`).expect(404);
    await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
    await as(student).get(`/api/student/topics/${id}`).expect(200);

    const xpBefore = (await stats(student)).xpTotal;
    await as(student).post('/api/student/class/leave').expect(204);
    await as(student).get(`/api/student/subjects/${subjectId}`).expect(404);
    const catalog = await as(student).get('/api/student/catalog').expect(200);
    expect(catalog.body.subjects.map((s: { id: string }) => s.id)).not.toContain(subjectId);
    // Личные результаты сохраняются.
    expect((await stats(student)).xpTotal).toBe(xpBefore);
  });
});
