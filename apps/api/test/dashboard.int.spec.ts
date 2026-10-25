import request from 'supertest';
import { freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const DAY = 86_400_000;

/**
 * SPEC 8.7 (REQ-PRF-02…04, API-ME-12): «Обзор» показывает те же числа, что разделы «Показатели», «Достижения»,
 * «Мои задания», аналитика класса и «Задания» (AC-PRF-02); аватары и «Должность»/«О себе» учителя — только тем, кому
 * они видны (AC-PRF-10, BR-PRF-04/09).
 */
describe('personal dashboard (integration)', () => {
  let stack: TestStack;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie).set('Accept-Language', 'ru'),
    send: (method: 'post' | 'put' | 'patch', path: string, body: object = {}) =>
      http()
        [method](path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .set('Accept-Language', 'ru')
        .send(body),
  });

  async function newTeacher(): Promise<Session> {
    const email = `dash.teacher.${++n}@example.com`;
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email, displayName: 'Алия Нурланова', password: 'teacher-pass-1' })
      .expect(201);
    return login(http, email, 'teacher-pass-1');
  }

  async function newStudent(code?: string): Promise<Session> {
    const loginName = `dash.student.${++n}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({
        displayName: 'Асель Касымова',
        login: loginName,
        password: 'student-pass-1',
        ...(code ? { code } : {}),
      })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  /** Класс с кодом, предмет учителя с опубликованной темой и квизом (правильный ответ — «….0»), выдан классу. */
  async function setup(teacher: Session) {
    const classId = (await as(teacher).send('post', '/api/teacher/classes', { name: '7 «Д»' }).expect(201))
      .body.id as string;
    const code = (await as(teacher).send('post', `/api/teacher/classes/${classId}/invite-codes`).expect(201))
      .body.code as string;
    const subjectId = (
      await as(teacher)
        .send('post', '/api/teacher/subjects', {
          translations: { ru: { title: 'Ботаника', description: 'Растения' } },
          inPublicCatalog: false,
        })
        .expect(201)
    ).body.id as string;
    const topicId = (await as(teacher).send('post', `/api/teacher/subjects/${subjectId}/topics`).expect(201))
      .body.id as string;
    await as(teacher)
      .send('put', `/api/teacher/topics/${topicId}`, {
        translations: { ru: { title: 'Корень' } },
        materialIds: [],
      })
      .expect(204);
    await as(teacher)
      .send('post', `/api/teacher/topics/${topicId}/quiz/questions`, {
        type: 'single_choice',
        difficulty: 'easy',
        translations: { ru: { text: 'Вопрос?' } },
        options: [0, 1].map((i) => ({ translations: { ru: `Ответ ${i}` }, isCorrect: i === 0 })),
      })
      .expect(201);
    await as(teacher).send('post', `/api/teacher/topics/${topicId}/publish`).expect(200);
    await as(teacher).send('post', `/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
    return { classId, code, subjectId, topicId };
  }

  beforeAll(async () => {
    stack = await startStack('demo');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('AC-PRF-02 the student overview matches «Показатели», «Достижения», «Мои задания» and «Мой класс»', async () => {
    const teacher = await newTeacher();
    await as(teacher)
      .send('patch', '/api/me/profile', { position: 'Учитель биологии', about: 'Люблю растения' })
      .expect(200);
    await as(teacher).send('put', '/api/me/avatar', { kind: 'preset', preset: 'owl' }).expect(200);
    const t = await setup(teacher);
    for (const days of [2, 5, 9, 12]) {
      await as(teacher)
        .send('post', '/api/teacher/assignments', {
          classId: t.classId,
          subjectId: t.subjectId,
          topicId: t.topicId,
          dueAt: new Date(Date.now() + days * DAY).toISOString(),
        })
        .expect(201);
    }
    const student = await newStudent(t.code);
    // Квиз — бейдж, XP и освоение темы.
    const lesson = (await as(student).get(`/api/student/topics/${t.topicId}`).expect(200)).body;
    const attempt = (
      await as(student)
        .send('post', `/api/student/quizzes/${lesson.quizId}/attempts`)
        .expect((r) => expect(r.status).toBeLessThan(300))
    ).body;
    for (const q of attempt.questions) {
      await as(student)
        .send('post', `/api/student/attempts/${attempt.attemptId}/answers`, {
          questionId: q.id,
          optionId: q.options.find((o: { text: string }) => o.text.endsWith('0')).id,
        })
        .expect((r) => expect(r.status).toBeLessThan(300));
    }
    await as(student)
      .send('post', `/api/student/attempts/${attempt.attemptId}/finish`)
      .expect((r) => expect(r.status).toBeLessThan(300));

    const dash = (await as(student).get('/api/me/dashboard').expect(200)).body;
    expect(dash.role).toBe('student');
    expect(dash.teacher).toBeNull();
    const d = dash.student;
    const achievements = (await as(student).get('/api/student/achievements').expect(200)).body;
    const progress = (await as(student).get('/api/student/progress?period=30d').expect(200)).body;
    const assignments = (await as(student).get('/api/student/assignments').expect(200)).body as Array<{
      id: string;
      status: string;
    }>;
    expect(d.achievements).toEqual({
      level: achievements.level,
      rankTitle: achievements.rankTitle,
      xpTotal: achievements.xpTotal,
      xpToNext: achievements.xpToNext,
      xpPerLevel: achievements.xpPerLevel,
      streakDays: achievements.streakDays,
    });
    expect(d.progress).toEqual({
      mastered: progress.progress.mastered,
      total: progress.progress.total,
      percent: progress.progress.percent,
    });
    expect(d.nextStep).toEqual(progress.nextStep);
    expect(d.assignments.map((a: { id: string }) => a.id)).toEqual(
      assignments
        .filter((a) => a.status === 'not_started')
        .slice(0, 3)
        .map((a) => a.id),
    );
    const earned = (achievements.badges as Array<{ code: string; earned: boolean }>).filter((b) => b.earned);
    expect(d.badges.length).toBe(Math.min(3, earned.length));
    expect(d.badges.length).toBeGreaterThan(0);
    expect(d.class).toMatchObject({
      name: '7 «Д»',
      teacher: { name: 'Алия Нурланова', avatar: { kind: 'preset', preset: 'owl' } },
    });
    expect(d.lastBattle).toBeNull();

    // BR-PRF-04: «Должность» и «О себе» учителя и его аватар — ученику его класса (карточка «Мой класс»).
    const cls = (await as(student).get('/api/student/class').expect(200)).body;
    expect(cls).toMatchObject({
      teacherPosition: 'Учитель биологии',
      teacherAbout: 'Люблю растения',
      teacherAvatar: { kind: 'preset', preset: 'owl' },
    });
    expect(JSON.stringify(cls)).not.toContain('@example.com');
  });

  it('AC-PRF-02 the teacher overview matches the class analytics and «Задания»; avatars in roster and mastery map', async () => {
    const teacher = await newTeacher();
    const t = await setup(teacher);
    await as(teacher)
      .send('post', '/api/teacher/assignments', {
        classId: t.classId,
        subjectId: t.subjectId,
        topicId: t.topicId,
        dueAt: new Date(Date.now() + 3 * DAY).toISOString(),
      })
      .expect(201);
    const s1 = await newStudent(t.code);
    await newStudent(t.code);
    await as(s1).send('put', '/api/me/avatar', { kind: 'preset', preset: 'fox' }).expect(200);

    const dash = (await as(teacher).get('/api/me/dashboard').expect(200)).body;
    expect(dash.role).toBe('teacher');
    expect(dash.student).toBeNull();
    const d = dash.teacher;
    expect(d.counts).toEqual({ classes: 1, students: 2, subjects: 1, publishedTopics: 1 });
    expect(d.review).toEqual({ enabled: false, count: 0 });
    const analytics = (await as(teacher).get(`/api/teacher/classes/${t.classId}/analytics`).expect(200)).body;
    expect(d.attention.map((a: { studentId: string }) => a.studentId)).toEqual(
      (analytics.attention as Array<{ studentId: string }>).slice(0, 5).map((a) => a.studentId),
    );
    expect(d.attention.find((a: { studentId: string }) => a.studentId === s1.userId)?.avatar).toMatchObject({
      kind: 'preset',
      preset: 'fox',
    });
    const list = (await as(teacher).get('/api/teacher/assignments').expect(200)).body as Array<{
      id: string;
    }>;
    expect(d.deadlines.map((x: { id: string }) => x.id)).toEqual(list.map((x) => x.id));
    expect(d.battles).toEqual([]);

    const roster = (await as(teacher).get(`/api/teacher/classes/${t.classId}/roster`).expect(200)).body;
    expect(roster.find((r: { id: string }) => r.id === s1.userId).avatar).toMatchObject({
      kind: 'preset',
      preset: 'fox',
    });
    const mastery = (await as(teacher).get(`/api/teacher/classes/${t.classId}/mastery`).expect(200)).body;
    expect(mastery.students.find((r: { id: string }) => r.id === s1.userId).avatar.kind).toBe('preset');
  });

  it('AC-PRF-10 BR-PRF-09 another teacher cannot see the roster or avatars of a foreign class; guests and staff get no dashboard', async () => {
    const owner = await newTeacher();
    const t = await setup(owner);
    await newStudent(t.code);
    const stranger = await newTeacher();
    await as(stranger).get(`/api/teacher/classes/${t.classId}/roster`).expect(404);
    await as(stranger).get(`/api/teacher/classes/${t.classId}/mastery`).expect(404);
    const strangerDash = (await as(stranger).get('/api/me/dashboard').expect(200)).body.teacher;
    expect(strangerDash.counts.students).toBe(0);
    expect(strangerDash.attention).toEqual([]);
    await http().get('/api/me/dashboard').expect(401);
    const support = await login(http, 'support@syntara.local');
    await as(support).get('/api/me/dashboard').expect(403);
  });
});
