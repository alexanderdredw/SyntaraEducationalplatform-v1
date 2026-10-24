import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const { navSeen, studentBadges } = schema;
const DAY = 86_400_000;

/**
 * docs/NAV_TZ_2.md: «Мой класс» (API-S-19), счётчики панели (API-S-20) и отметка открытия раздела (API-S-21).
 * Права — как у операций ученика: только свой класс; гость — 401, учитель — 403.
 */
describe('student nav: «Мой класс» and badges (integration)', () => {
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

  async function newStudent(code?: string): Promise<Session & { id: string }> {
    const loginName = `nav.student.${++n}`;
    const res = await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({
        displayName: 'Ученик',
        login: loginName,
        password: 'student-pass-1',
        ...(code ? { code } : {}),
      })
      .expect(201);
    return { ...(await login(http, loginName, 'student-pass-1')), id: res.body.user.id as string };
  }

  async function newClass(name: string) {
    const id = (await as(teacher).post('/api/teacher/classes', { name }).expect(201)).body.id as string;
    const code = (await as(teacher).post(`/api/teacher/classes/${id}/invite-codes`).expect(201)).body
      .code as string;
    return { id, code };
  }

  /** Личный предмет с одной опубликованной темой и квизом из 2 вопросов (правильный — «….0»). */
  async function ownSubject(title: string, classId?: string) {
    const subjectId = (
      await as(teacher)
        .post('/api/teacher/subjects', {
          translations: { ru: { title, description: `${title}: описание` } },
          inPublicCatalog: false,
        })
        .expect(201)
    ).body.id as string;
    const topicId = (await as(teacher).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body
      .id as string;
    await as(teacher)
      .put(`/api/teacher/topics/${topicId}`, {
        translations: { ru: { title: `${title}: тема` } },
        materialIds: [],
      })
      .expect(204);
    for (let q = 1; q <= 2; q++) {
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
    if (classId) await grant(subjectId, classId);
    return { subjectId, topicId };
  }

  const grant = (subjectId: string, classId: string) =>
    as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);

  async function passQuiz(s: Session, topicId: string) {
    const lesson = await as(s).get(`/api/student/topics/${topicId}`).expect(200);
    const attempt = (await as(s).post(`/api/student/quizzes/${lesson.body.quizId}/attempts`).expect(200))
      .body;
    for (const q of attempt.questions) {
      const pick = q.options.find((o: { text: string }) => o.text.endsWith('.0'));
      await as(s)
        .post(`/api/student/attempts/${attempt.attemptId}/answers`, { questionId: q.id, optionId: pick.id })
        .expect(200);
    }
    await as(s).post(`/api/student/attempts/${attempt.attemptId}/finish`).expect(200);
  }

  const assign = (classId: string, topic: { subjectId: string; topicId: string }, days: number) =>
    as(teacher)
      .post('/api/teacher/assignments', {
        classId,
        subjectId: topic.subjectId,
        topicId: topic.topicId,
        dueAt: new Date(Date.now() + days * DAY).toISOString(),
      })
      .expect(201);

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
  });

  afterAll(() => stack?.stop());

  it('API-S-19, REQ-NAV-11, AC-NAV-11 class card, granted subjects with progress and «Новое», up to 3 upcoming assignments', async () => {
    const cls = await newClass('7 «Н»');
    const botany = await ownSubject('Ботаника', cls.id);
    const zoology = await ownSubject('Зоология', cls.id);
    const hidden = await ownSubject('Не выдан');
    const student = await newStudent(cls.code);

    // Все предметы — «новые», пока раздел не открыт; невыданный предмет не показывается.
    let overview = (await as(student).get('/api/student/class/overview').expect(200)).body;
    expect(overview.class).toMatchObject({ classId: cls.id, className: '7 «Н»' });
    expect(overview.subjects).toEqual([
      {
        id: botany.subjectId,
        title: 'Ботаника',
        description: 'Ботаника: описание',
        topicsTotal: 1,
        topicsMastered: 0,
        isNew: true,
      },
      expect.objectContaining({ id: zoology.subjectId, isNew: true }),
    ]);
    expect(overview.subjects.map((s: { id: string }) => s.id)).not.toContain(hidden.subjectId);
    expect(overview.upcomingAssignments).toEqual([]);

    // Прогресс: освоенная тема; задания — только несданные, до 3, по сроку.
    await passQuiz(student, botany.topicId);
    for (const days of [5, -1, 3, 9]) await assign(cls.id, zoology, days);
    await assign(cls.id, botany, 1);
    await passQuiz(student, botany.topicId);
    await as(student).post('/api/student/nav-seen', { section: 'class' }).expect(204);
    overview = (await as(student).get('/api/student/class/overview').expect(200)).body;
    expect(overview.subjects[0]).toMatchObject({ topicsTotal: 1, topicsMastered: 1, isNew: false });
    expect(overview.upcomingAssignments).toHaveLength(3);
    expect(overview.upcomingAssignments.map((a: { overdue: boolean }) => a.overdue)).toEqual([
      true,
      false,
      false,
    ]);

    // Предмет, выданный после открытия раздела, — «Новое».
    const chemistry = await ownSubject('Химия опытов', cls.id);
    overview = (await as(student).get('/api/student/class/overview').expect(200)).body;
    expect(overview.subjects.find((s: { id: string }) => s.id === chemistry.subjectId).isNew).toBe(true);
    expect(overview.subjects.find((s: { id: string }) => s.id === botany.subjectId).isNew).toBe(false);
  });

  it('API-S-19, AC-NAV-12 without a class → class null, no subjects; after joining the class subjects appear', async () => {
    const cls = await newClass('7 «П»');
    const own = await ownSubject('Физика опытов', cls.id);
    const student = await newStudent();
    expect((await as(student).get('/api/student/class/overview').expect(200)).body).toEqual({
      class: null,
      subjects: [],
      upcomingAssignments: [],
    });
    await as(student).post('/api/student/join', { code: cls.code }).expect(200);
    const overview = (await as(student).get('/api/student/class/overview').expect(200)).body;
    expect(overview.subjects.map((s: { id: string }) => s.id)).toEqual([own.subjectId]);
  });

  it('API-S-20, REQ-NAV-14, AC-NAV-16..18 badges: open and overdue assignments, new subject, new badge; nav-seen clears dots', async () => {
    const cls = await newClass('7 «С»');
    const own = await ownSubject('Астрономия', cls.id);
    const student = await newStudent(cls.code);
    const badges = async () => (await as(student).get('/api/student/nav-badges').expect(200)).body;

    expect(await badges()).toEqual({
      assignmentsOpen: 0,
      assignmentsOverdue: 0,
      classHasNew: true,
      achievementsHasNew: false,
    });
    await as(student).post('/api/student/nav-seen', { section: 'class' }).expect(204);
    expect((await badges()).classHasNew).toBe(false);

    // Задания: одно просроченное и одно с будущим сроком; после сдачи число уменьшается.
    await assign(cls.id, { subjectId: B.subjectAnatomy, topicId: B.topicCardio }, -1);
    await assign(cls.id, own, 2);
    expect(await badges()).toMatchObject({ assignmentsOpen: 2, assignmentsOverdue: 1 });
    await passQuiz(student, own.topicId);
    expect(await badges()).toMatchObject({
      assignmentsOpen: 1,
      assignmentsOverdue: 1,
      achievementsHasNew: true,
    });

    // Новый бейдж («Первый шаг») — точка до открытия «Достижений»; повторная отметка не возвращает точку.
    await as(student).post('/api/student/nav-seen', { section: 'achievements' }).expect(204);
    expect((await badges()).achievementsHasNew).toBe(false);
    await as(student).post('/api/student/nav-seen', { section: 'achievements' }).expect(204);
    expect((await badges()).achievementsHasNew).toBe(false);

    // Новый предмет класса после открытия раздела — снова точка.
    await ownSubject('Геология', cls.id);
    expect((await badges()).classHasNew).toBe(true);

    // Отметки хранятся по одной строке на раздел.
    const rows = await stack.db.select().from(navSeen).where(eq(navSeen.userId, student.id));
    expect(rows.map((r) => r.section).sort()).toEqual(['achievements', 'class']);
    const [badgeRows] = await stack.db
      .select({ n: sql<number>`count(*)` })
      .from(studentBadges)
      .where(and(eq(studentBadges.studentId, student.id)));
    expect(Number(badgeRows!.n)).toBeGreaterThan(0);
  });

  it('API-S-21 validation; API-S-19..21 access: guest 401, teacher 403; RLS keeps nav_seen rows private', async () => {
    const student = await newStudent();
    await as(student).post('/api/student/nav-seen', { section: 'other' }).expect(400);
    for (const path of ['/api/student/class/overview', '/api/student/nav-badges']) {
      await http().get(path).expect(401);
      await as(teacher).get(path).expect(403);
    }
    await http()
      .post('/api/student/nav-seen')
      .send({ section: 'class' })
      .expect((r) => {
        expect([401, 403]).toContain(r.status);
      });
    await as(teacher).post('/api/student/nav-seen', { section: 'class' }).expect(403);

    // RLS (второй уровень): в контексте другого пользователя чужие отметки не видны.
    await as(student).post('/api/student/nav-seen', { section: 'class' }).expect(204);
    const visible = await stack.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(
        sql`SELECT set_config('app.user_id', ${'00000000-0000-4000-8000-000000000001'}, true)`,
      );
      return tx.select().from(navSeen).where(eq(navSeen.userId, student.id));
    });
    expect(visible).toEqual([]);
  });

  it('API-GEN-01 OpenAPI documents API-S-19..21', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/student/class/overview']?.get).toBeDefined();
    expect(doc.paths['/api/student/nav-badges']?.get).toBeDefined();
    expect(doc.paths['/api/student/nav-seen']?.post).toBeDefined();
  });
});
