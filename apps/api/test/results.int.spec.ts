import request from 'supertest';
import { eq } from 'drizzle-orm';
import { localDate } from '@syntara/shared';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { AppConfigService } from '../src/config/app-config.service';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const { submissions, auditLog, topicMastery, learningEvents, appConfig } = schema;
const DAY = 86_400_000;
const TZ = 'Asia/Almaty';

/**
 * Итерация 10 — задания, показатели, аналитика: назначение и сдача (BR-ASG-01..03, SM-SUBMISSION, AC-TCH-08),
 * аналитика класса на фиксированных данных (BR-AN-01..05, AC-TCH-09), «Мои показатели» (BR-ST-04..06, AC-ST-08),
 * достижения (BR-XP-03, BR-BDG-01), чужие объекты → 404 (AC-ST-09). Базовые и личные уроки — вместе.
 */
describe('assignments, progress, analytics (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  let teacher: Session;
  let n = 0;
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
  });

  async function newStudent(code?: string, name = 'Ученик'): Promise<Session> {
    const loginName = `res.student.${++n}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: name, login: loginName, password: 'student-pass-1', ...(code ? { code } : {}) })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  async function newClass(name: string) {
    const id = (await as(teacher).post('/api/teacher/classes', { name }).expect(201)).body.id as string;
    const code = (await as(teacher).post(`/api/teacher/classes/${id}/invite-codes`).expect(201)).body
      .code as string;
    return { id, code };
  }

  /** Личный предмет учителя с опубликованной темой и квизом из 4 вопросов (правильный вариант — «….0»). */
  async function ownSubject(title: string, classId?: string) {
    const subjectId = (
      await as(teacher)
        .post('/api/teacher/subjects', { translations: { ru: { title } }, inPublicCatalog: false })
        .expect(201)
    ).body.id as string;
    if (classId) await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
    const topicId = (await as(teacher).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body
      .id as string;
    await as(teacher)
      .put(`/api/teacher/topics/${topicId}`, {
        translations: { ru: { title: `${title}: тема` } },
        materialIds: [],
      })
      .expect(204);
    for (let q = 1; q <= 4; q++) {
      await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          type: 'single_choice',
          difficulty: 'easy',
          translations: { ru: { text: `Вопрос ${q}` } },
          options: [0, 1].map((i) => ({ translations: { ru: `Ответ ${q}.${i}` }, isCorrect: i === 0 })),
        })
        .expect(201);
    }
    await as(teacher).post(`/api/teacher/topics/${topicId}/publish`).expect(200);
    const draftId = (await as(teacher).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body
      .id as string;
    return { subjectId, topicId, draftId };
  }

  /** Попытка квиза: первые `correct` ответов — верно. */
  async function passQuiz(s: Session, topicId: string, correct: number, assignmentId?: string) {
    const lesson = await as(s).get(`/api/student/topics/${topicId}`).expect(200);
    const attempt = (
      await as(s)
        .post(`/api/student/quizzes/${lesson.body.quizId}/attempts`, assignmentId ? { assignmentId } : {})
        .expect(200)
    ).body;
    for (const [i, q] of attempt.questions.entries()) {
      const pick = q.options.find((o: { text: string }) => o.text.endsWith(i < correct ? '.0' : '.1'));
      await as(s)
        .post(`/api/student/attempts/${attempt.attemptId}/answers`, { questionId: q.id, optionId: pick.id })
        .expect(200);
    }
    return (await as(s).post(`/api/student/attempts/${attempt.attemptId}/finish`).expect(200)).body;
  }

  const dueIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
  });

  afterAll(() => stack?.stop());

  it('API-T-22, BR-ASG-01, API-T-28 a teacher assigns a base or an own granted topic; wrong subject/topic/class are refused', async () => {
    const cls = await newClass('10 «А»');
    const own = await ownSubject('Ботаника', cls.id);
    const notGranted = await ownSubject('Зоология');
    const options = await as(teacher).get(`/api/teacher/classes/${cls.id}/assignment-options`).expect(200);
    const ids = options.body.subjects.map((s: { id: string }) => s.id);
    expect(ids).toContain(B.subjectAnatomy);
    expect(ids).toContain(own.subjectId);
    expect(ids).not.toContain(notGranted.subjectId);
    const anatomy = options.body.subjects.find((s: { id: string }) => s.id === B.subjectAnatomy);
    expect(anatomy).toMatchObject({ official: true, title: 'Анатомия человека' });
    expect(anatomy.topics[0]).toEqual({ id: B.topicCardio, title: 'Сердечно-сосудистая система' });
    // Только опубликованные темы.
    const ownOption = options.body.subjects.find((s: { id: string }) => s.id === own.subjectId);
    expect(ownOption.topics.map((t: { id: string }) => t.id)).toEqual([own.topicId]);

    const body = { classId: cls.id, subjectId: B.subjectAnatomy, topicId: B.topicCardio, dueAt: dueIn(3) };
    await as(teacher).post('/api/teacher/assignments', body).expect(201);
    await as(teacher)
      .post('/api/teacher/assignments', { ...body, subjectId: own.subjectId, topicId: own.topicId })
      .expect(201);
    const refused = async (patch: object, field: string, key: string) => {
      const res = await as(teacher)
        .post('/api/teacher/assignments', { ...body, ...patch })
        .expect(422);
      expect(res.body.fieldErrors).toEqual({ [field]: key });
    };
    await refused(
      { subjectId: notGranted.subjectId, topicId: notGranted.topicId },
      'subjectId',
      'subjectNotGranted',
    );
    await refused({ topicId: own.topicId }, 'topicId', 'topicNotInSubject');
    await refused({ subjectId: own.subjectId, topicId: own.draftId }, 'topicId', 'topicNotPublished');
    await as(teacher)
      .post('/api/teacher/assignments', { ...body, dueAt: '05.10.2026' })
      .expect(400);
    // Чужой класс и чужой личный предмет — 404 (BR-ACL-01/02).
    const other = await stack.db
      .insert(schema.users)
      .values({ displayName: 'Другой', email: `t${n}@x.kz` })
      .returning();
    await stack.db.insert(schema.userRoles).values({ userId: other[0]!.id, role: 'teacher' });
    const [foreign] = await stack.db
      .insert(schema.classes)
      .values({ teacherId: other[0]!.id, name: 'Чужой' })
      .returning();
    await as(teacher)
      .post('/api/teacher/assignments', { ...body, classId: foreign!.id })
      .expect(404);
    await as(teacher).get(`/api/teacher/classes/${foreign!.id}/assignment-options`).expect(404);
    expect(
      await stack.db.select().from(auditLog).where(eq(auditLog.action, 'assignment.created')),
    ).toHaveLength(2);
  });

  it('AC-TCH-08, BR-ASG-03, SM-SUBMISSION the student sees the assignment, passes the quiz from it → graded with the best grade; counters update', async () => {
    const cls = await newClass('8 «Б»');
    const own = await ownSubject('Химия опытов', cls.id);
    const student = await newStudent(cls.code);
    const outsider = await newStudent();
    const assignment = (
      await as(teacher)
        .post('/api/teacher/assignments', {
          classId: cls.id,
          subjectId: own.subjectId,
          topicId: own.topicId,
          dueAt: dueIn(2),
        })
        .expect(201)
    ).body.id as string;
    const past = (
      await as(teacher)
        .post('/api/teacher/assignments', {
          classId: cls.id,
          subjectId: B.subjectAnatomy,
          topicId: B.topicCardio,
          dueAt: dueIn(-1),
        })
        .expect(201)
    ).body.id as string;

    let list = (await as(student).get('/api/student/assignments').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({
        id: past,
        topicTitle: 'Сердечно-сосудистая система',
        status: 'not_started',
        overdue: true,
      }),
      expect.objectContaining({
        id: assignment,
        topicTitle: 'Химия опытов: тема',
        subjectTitle: 'Химия опытов',
        status: 'not_started',
        grade: null,
        overdue: false,
      }),
    ]);
    expect((await as(outsider).get('/api/student/assignments').expect(200)).body).toEqual([]);

    // BR-ASG-03 (решение владельца 2026-10-17): квиз темы, пройденный из урока после выдачи задания, — тоже сдача.
    await passQuiz(student, own.topicId, 3);
    list = (await as(student).get('/api/student/assignments').expect(200)).body;
    expect(list.find((a: { id: string }) => a.id === assignment)).toMatchObject({
      status: 'graded',
      grade: 75,
      late: false,
    });
    // Из задания — лучше; затем хуже — оценка остаётся лучшей.
    await passQuiz(student, own.topicId, 4, assignment);
    await passQuiz(student, own.topicId, 1, assignment);
    const [sub] = await stack.db.select().from(submissions).where(eq(submissions.assignmentId, assignment));
    expect(sub).toMatchObject({ status: 'graded', grade: '100.00', gradedBy: null });
    expect(sub!.submittedAt).toBeTruthy();

    // После срока сдача принимается с пометкой «Сдано после срока» (submitted_at > due_at).
    const lesson = await as(student).get(`/api/student/topics/${B.topicCardio}`).expect(200);
    const late = (await as(student).post(`/api/student/quizzes/${lesson.body.quizId}/attempts`).expect(200))
      .body;
    await as(student).post(`/api/student/attempts/${late.attemptId}/finish`).expect(200);
    list = (await as(student).get('/api/student/assignments').expect(200)).body;
    expect(list.find((a: { id: string }) => a.id === past)).toMatchObject({
      status: 'graded',
      grade: 0,
      overdue: false,
      late: true,
    });

    const teacherList = (await as(teacher).get('/api/teacher/assignments').expect(200)).body;
    expect(teacherList.find((a: { id: string }) => a.id === assignment)).toMatchObject({
      topicTitle: 'Химия опытов: тема',
      className: '8 «Б»',
      counts: { submitted: 1, inReview: 0, graded: 1 },
    });
    expect(teacherList.find((a: { id: string }) => a.id === past).counts).toEqual({
      submitted: 1,
      inReview: 0,
      graded: 1,
    });
    // REQ-NFR-SEC-05: каждая оценка — в журнале аудита.
    const graded = await stack.db.select().from(auditLog).where(eq(auditLog.action, 'submission.graded'));
    expect(graded.filter((a) => a.entityId === assignment)).toHaveLength(3);
    expect(graded.filter((a) => a.entityId === assignment).at(-1)!.after).toMatchObject({
      studentId: student.userId,
      grade: 100,
    });
    // API-T-24 (PH-29): ручной проверки нет — очередь пуста.
    expect((await as(teacher).get('/api/teacher/review-queue').expect(200)).body).toEqual([]);
  });

  it('BR-ASG-03 a quiz finished before the assignment was issued is not a submission; another class is not affected', async () => {
    const cls = await newClass('8 «Г»');
    const own = await ownSubject('Астрономия', cls.id);
    const student = await newStudent(cls.code);
    await passQuiz(student, own.topicId, 4);
    const assignment = (
      await as(teacher)
        .post('/api/teacher/assignments', {
          classId: cls.id,
          subjectId: own.subjectId,
          topicId: own.topicId,
          dueAt: dueIn(3),
        })
        .expect(201)
    ).body.id as string;
    expect(await stack.db.select().from(submissions).where(eq(submissions.assignmentId, assignment))).toEqual(
      [],
    );
    const list = (await as(student).get('/api/student/assignments').expect(200)).body;
    expect(list[0]).toMatchObject({ id: assignment, status: 'not_started', late: false });
  });

  it('API-T-29 «Карта освоения»: students × topics of a base or own granted subject, status per cell, subject filter', async () => {
    const cls = await newClass('10 «Б»');
    const own = await ownSubject('Экология', cls.id);
    const a = await newStudent(cls.code, 'Айжан');
    const b = await newStudent(cls.code, 'Болат');
    await newStudent(cls.code, 'Вера');
    await passQuiz(a, own.topicId, 4); // освоена
    await passQuiz(b, own.topicId, 1); // начата, 25 %
    const base = (await as(teacher).get(`/api/teacher/classes/${cls.id}/mastery`).expect(200)).body;
    // По умолчанию — первый доступный предмет (базовые — первыми).
    expect(base.subjectId).toBe(B.subjectAnatomy);
    expect(base.subjects.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining([B.subjectAnatomy, own.subjectId]),
    );
    expect(base.topics).toHaveLength(3);
    expect(base.students.map((s: { name: string }) => s.name)).toEqual(['Айжан', 'Болат', 'Вера']);
    expect(base.cells).toHaveLength(9);

    const map = (
      await as(teacher).get(`/api/teacher/classes/${cls.id}/mastery?subjectId=${own.subjectId}`).expect(200)
    ).body;
    expect(map.topics).toEqual([{ id: own.topicId, title: 'Экология: тема' }]);
    const cell = (studentId: string) =>
      map.cells.find((c: { studentId: string }) => c.studentId === studentId);
    expect(cell(a.userId)).toMatchObject({ status: 'mastered', percent: 100 });
    expect(cell(b.userId)).toMatchObject({ status: 'started', percent: 25 });
    expect(map.cells.filter((c: { status: string }) => c.status === 'not_started')).toHaveLength(1);

    // Предмет, который классу не показать, и чужой класс — 404; не учитель — 403.
    const other = await ownSubject('Не выдан');
    await as(teacher).get(`/api/teacher/classes/${cls.id}/mastery?subjectId=${other.subjectId}`).expect(404);
    await as(teacher).get('/api/teacher/classes/0190a1b2-0000-7000-8000-000000000000/mastery').expect(404);
    await as(a).get(`/api/teacher/classes/${cls.id}/mastery`).expect(403);
  });

  it('AC-ST-09, Q-18 an assignment of another class or another topic → 404 when starting the quiz', async () => {
    const cls = await newClass('7 «В»');
    const own = await ownSubject('Физика опытов', cls.id);
    await newStudent(cls.code);
    const assignment = (
      await as(teacher)
        .post('/api/teacher/assignments', {
          classId: cls.id,
          subjectId: B.subjectAnatomy,
          topicId: B.topicCardio,
          dueAt: dueIn(2),
        })
        .expect(201)
    ).body.id as string;
    const stranger = await newStudent();
    const lesson = await as(stranger).get(`/api/student/topics/${B.topicCardio}`).expect(200);
    await as(stranger)
      .post(`/api/student/quizzes/${lesson.body.quizId}/attempts`, { assignmentId: assignment })
      .expect(404);
    // Своё назначение, но квиз другой темы.
    const member = await newStudent(cls.code);
    const ownLesson = await as(member).get(`/api/student/topics/${own.topicId}`).expect(200);
    await as(member)
      .post(`/api/student/quizzes/${ownLesson.body.quizId}/attempts`, { assignmentId: assignment })
      .expect(404);
  });

  it('AC-TCH-09, BR-AN-01..05 class analytics on fixed data: base and own topics, colors by PH-30, inactive students', async () => {
    const cls = await newClass('11 «А»');
    const own = await ownSubject('Генетика', cls.id);
    const s1 = await newStudent(cls.code, 'Айгерим');
    const s2 = await newStudent(cls.code, 'Бауыржан');
    const s3 = await newStudent(cls.code, 'Ваня');
    const left = await newStudent(cls.code, 'Ушедший');
    await as(left).post('/api/student/class/leave').expect(204);
    const mastery = (studentId: string, topicId: string, best: number) =>
      stack.db
        .insert(topicMastery)
        .values({ studentId, topicId, bestPercent: String(best), attemptsCount: 1 });
    await mastery(s1.userId, B.topicCardio, 30);
    await mastery(s2.userId, B.topicCardio, 40);
    await mastery(s1.userId, own.topicId, 100);
    await mastery(left.userId, B.topicCardio, 100); // вышедший из класса не учитывается (BR-AN-01)
    const event = (studentId: string, daysAgo: number) =>
      stack.db.insert(learningEvents).values({
        studentId,
        type: 'lesson_opened',
        topicId: B.topicCardio,
        subjectId: B.subjectAnatomy,
        occurredAt: new Date(Date.now() - daysAgo * DAY),
        idempotencyKey: `test:${studentId}:${daysAgo}`,
      });
    await event(s1.userId, 0);
    await event(s2.userId, 10);
    await stack.db.delete(learningEvents).where(eq(learningEvents.studentId, s3.userId));

    const res = (await as(teacher).get(`/api/teacher/classes/${cls.id}/analytics`).expect(200)).body;
    expect(res.avgPercent).toBe(57); // (30 + 40 + 100) / 3
    expect(res.engagement).toEqual({ active: 1, total: 3, windowDays: 7 });
    expect(res.weakTopics).toEqual([
      {
        topicId: B.topicCardio,
        title: 'Сердечно-сосудистая система',
        students: 2,
        percent: 35,
        color: 'red',
      },
      { topicId: own.topicId, title: 'Генетика: тема', students: 1, percent: 100, color: 'green' },
    ]);
    expect(res.attention.map((a: { name: string; reason: string }) => [a.name, a.reason])).toEqual([
      ['Ваня', 'inactive'],
      ['Бауыржан', 'inactive'],
    ]);
    expect(res.attention[0].lastActivityAt).toBeNull();
    expect(res.attention[1].lastActivityAt).toBeTruthy();

    // BR-AN-02: есть назначения — только назначенные темы; 50 ≤ percent < 80 — blue.
    await mastery(s3.userId, B.topicCardio, 80);
    await as(teacher)
      .post('/api/teacher/assignments', {
        classId: cls.id,
        subjectId: B.subjectAnatomy,
        topicId: B.topicCardio,
        dueAt: dueIn(5),
      })
      .expect(201);
    const assigned = (await as(teacher).get(`/api/teacher/classes/${cls.id}/analytics`).expect(200)).body;
    expect(assigned.avgPercent).toBe(50);
    expect(assigned.weakTopics).toEqual([
      expect.objectContaining({ students: 3, percent: 50, color: 'blue' }),
    ]);

    const student = await newStudent();
    await as(student).get(`/api/teacher/classes/${cls.id}/analytics`).expect(403);
  });

  it('AC-ST-08, BR-ST-04/05 «Мои показатели»: period and compare dates, progress and streak are recalculated', async () => {
    const s = await newStudent();
    const today = localDate(new Date(), TZ);
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    const event = (type: string, daysAgo: number) =>
      stack.db.insert(learningEvents).values({
        studentId: s.userId,
        type,
        topicId: B.topicCardio,
        subjectId: B.subjectAnatomy,
        occurredAt: ago(daysAgo),
        idempotencyKey: `p:${type}:${daysAgo}`,
      });
    await event('lesson_opened', 3);
    await event('lesson_opened', 1);
    await event('quiz_finished', 0);
    await stack.db.insert(topicMastery).values({
      studentId: s.userId,
      topicId: B.topicCardio,
      bestPercent: '100',
      attemptsCount: 1,
      masteredAt: ago(2),
    });

    const week = (await as(s).get('/api/student/progress?period=7d').expect(200)).body;
    expect(week.range).toEqual({ from: localDate(ago(6), TZ), to: today });
    expect(week.compareRange).toEqual({ from: localDate(ago(13), TZ), to: localDate(ago(7), TZ) });
    // Анатомия: 3 опубликованные темы, освоена 1; неделю назад событий не было.
    expect(week.progress).toEqual({ mastered: 1, total: 3, percent: 33.3, deltaPercent: 33.3 });
    expect(week.streak).toEqual({ days: 2, lastActivityDate: today, delta: 2 });

    const day = (await as(s).get('/api/student/progress?period=today').expect(200)).body;
    expect(day.range).toEqual({ from: today, to: today });
    expect(day.progress).toMatchObject({ percent: 33.3, deltaPercent: 0 });
    expect(day.streak).toEqual({ days: 2, lastActivityDate: today, delta: 1 });

    // Q-23 (решение владельца 2026-10-17): четверти 2026–2027 — в app_config (PH-38), «Четверть» активна; учебный год
    // — 1 сентября — 25 мая.
    const [row] = await stack.db.select().from(appConfig).where(eq(appConfig.key, 'progress'));
    const value = row!.value as {
      school_year: { from: string; to: string };
      quarters: Array<{ from: string; to: string }>;
    };
    expect(value.school_year).toEqual({ from: '09-01', to: '05-25' });
    expect(value.quarters).toEqual([
      { from: '2026-09-01', to: '2026-10-25' },
      { from: '2026-11-02', to: '2026-12-27' },
      { from: '2027-01-11', to: '2027-03-21' },
      { from: '2027-03-29', to: '2027-05-25' },
    ]);
    expect(week.availablePeriods).toEqual(['today', '7d', '30d', '90d', 'quarter', 'year']);
    const seeded = (await as(s).get('/api/student/progress?period=quarter').expect(200)).body;
    expect(value.quarters).toContainEqual(seeded.range);
    const year = (await as(s).get('/api/student/progress?period=year').expect(200)).body;
    expect(year.range.to).toMatch(/-05-25$/);
    // Период ещё не закончился — серия и прогресс считаются на сегодня, а не на будущий конец периода.
    for (const p of [seeded, year]) {
      expect(p.streak).toMatchObject({ days: week.streak.days, lastActivityDate: today });
      expect(p.progress.percent).toBe(week.progress.percent);
    }

    // Даты меняются без изменения кода: другие четверти — другой период; без четвертей — 422.
    const config = stack.app.get(AppConfigService);
    const setQuarters = async (quarters: unknown[]) => {
      await stack.db
        .update(appConfig)
        .set({ value: { ...value, quarters } })
        .where(eq(appConfig.key, 'progress'));
      await config.invalidate('progress');
    };
    try {
      await setQuarters([{ from: localDate(ago(10), TZ), to: localDate(ago(-10), TZ) }]);
      const q = (await as(s).get('/api/student/progress?period=quarter').expect(200)).body;
      expect(q.range).toEqual({ from: localDate(ago(10), TZ), to: localDate(ago(-10), TZ) });
      await setQuarters([]);
      const none = await as(s).get('/api/student/progress?period=quarter').expect(422);
      expect(none.body.fieldErrors).toEqual({ period: 'periodUnavailable' });
      expect((await as(s).get('/api/student/progress').expect(200)).body.availablePeriods).not.toContain(
        'quarter',
      );
    } finally {
      await stack.db.update(appConfig).set({ value }).where(eq(appConfig.key, 'progress'));
      await config.invalidate('progress');
    }
    await as(s).get('/api/student/progress?period=week').expect(400);
  });

  it('BR-ST-06 nextStep: assignment → weak topic → next topic → catalog', async () => {
    const fresh = await newStudent();
    const step = async (s: Session) => (await as(s).get('/api/student/progress').expect(200)).body.nextStep;
    expect(await step(fresh)).toMatchObject({ action: 'catalog', reason: 'start', href: '/learn/subjects' });

    await stack.db.insert(learningEvents).values({
      studentId: fresh.userId,
      type: 'lesson_opened',
      topicId: B.topicCardio,
      subjectId: B.subjectAnatomy,
      occurredAt: new Date(),
      idempotencyKey: 'ns:open',
    });
    expect(await step(fresh)).toMatchObject({ action: 'next_topic', topicTitle: 'Дыхательная система' });

    await stack.db
      .insert(topicMastery)
      .values({ studentId: fresh.userId, topicId: B.topicCardio, bestPercent: '40', attemptsCount: 1 });
    expect(await step(fresh)).toMatchObject({
      action: 'improve_topic',
      reason: 'below_mastery',
      href: `/learn/topics/${B.topicCardio}?tab=quiz`,
      percent: 40,
    });

    const cls = await newClass('6 «Г»');
    const member = await newStudent(cls.code);
    await stack.db
      .insert(topicMastery)
      .values({ studentId: member.userId, topicId: B.topicCardio, bestPercent: '40', attemptsCount: 1 });
    const assignment = (
      await as(teacher)
        .post('/api/teacher/assignments', {
          classId: cls.id,
          subjectId: B.subjectAnatomy,
          topicId: B.topicCardio,
          dueAt: dueIn(1),
        })
        .expect(201)
    ).body.id as string;
    expect(await step(member)).toMatchObject({
      action: 'assignment',
      reason: 'assignment_due',
      href: `/learn/topics/${B.topicCardio}?tab=quiz&assignment=${assignment}`,
      topicTitle: 'Сердечно-сосудистая система',
    });
  });

  it('API-S-15, BR-XP-03, BR-BDG-01 achievements: level, rank, all 12 badges, earned ones with a date', async () => {
    const cls = await newClass('5 «А»');
    const own = await ownSubject('Природоведение', cls.id);
    const s = await newStudent(cls.code);
    let a = (await as(s).get('/api/student/achievements').expect(200)).body;
    expect(a).toMatchObject({ level: 1, rankTitle: 'Новичок', xpTotal: 0, xpToNext: 100, streakDays: 0 });
    expect(a.totalCount).toBe(12);
    expect(a.earnedCount).toBe(0);
    expect(a.badges[0]).toMatchObject({
      code: 'first_step',
      title: 'Первый шаг',
      condition: 'Пройден первый квиз',
    });

    await passQuiz(s, own.topicId, 0);
    a = (await as(s).get('/api/student/achievements').expect(200)).body;
    expect(a).toMatchObject({ xpTotal: 10, xpToNext: 90, streakDays: 1, earnedCount: 1 });
    expect(a.badges.find((b: { code: string }) => b.code === 'first_step')).toMatchObject({
      earned: true,
      earnedAt: expect.any(String),
    });
    const kk = (
      await http().get('/api/student/achievements').set('Cookie', s.cookie).set('Accept-Language', 'kk')
    ).body;
    expect(kk.rankTitle).toBe('Жаңадан бастаушы');
  });

  it('API-GEN-01 OpenAPI documents API-T-22..25, API-T-28, API-S-10, API-S-14, API-S-15', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const paths = buildOpenApi(stack.app).paths;
    for (const p of [
      '/api/teacher/assignments',
      '/api/teacher/review-queue',
      '/api/teacher/classes/{id}/analytics',
      '/api/teacher/classes/{id}/assignment-options',
      '/api/student/assignments',
      '/api/student/progress',
      '/api/student/achievements',
    ]) {
      expect(paths[p]).toBeDefined();
    }
  });
});
