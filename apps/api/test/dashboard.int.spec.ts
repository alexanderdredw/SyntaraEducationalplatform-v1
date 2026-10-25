import request from 'supertest';
import { schema } from '@syntara/db';
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
    expect(d.achievements).toMatchObject({
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
    expect(d.counts).toEqual({ classes: 1, students: 2, subjects: 1, publishedTopics: 1, battlesHosted: 0 });
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

  it('AC-PRF-22 API-ME-15 activity: 12 weeks from Monday, lesson_opened + quiz_finished per Almaty day, active days and the longest run', async () => {
    const student = await newStudent();
    const now = Date.now();
    // UTC+5: 2026-…T20:00Z — уже следующий день в Алматы; ai_question не считается (BR-ST-02).
    const at = (daysAgo: number, hourUtc = 6) => {
      const d = new Date(now - daysAgo * DAY);
      d.setUTCHours(hourUtc, 0, 0, 0);
      return d;
    };
    const event = (type: string, occurredAt: Date) => ({
      studentId: student.userId,
      type,
      occurredAt,
      idempotencyKey: crypto.randomUUID(),
    });
    await stack.db
      .insert(schema.learningEvents)
      .values([
        event('lesson_opened', at(3)),
        event('quiz_finished', at(3)),
        event('lesson_opened', at(3)),
        event('lesson_opened', at(2)),
        event('lesson_opened', at(1)),
        event('ai_question', at(1)),
        event('lesson_opened', at(40)),
        event('lesson_opened', at(200)),
      ]);
    const body = (await as(student).get('/api/me/activity').expect(200)).body;
    const days = body.days as Array<{ date: string; count: number }>;
    expect(new Date(`${body.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(days.length).toBeGreaterThan(77);
    expect(days.length).toBeLessThanOrEqual(84);
    expect(days.at(-1)!.date).toBe(body.to);
    const local = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
    const countOn = (d: Date) => days.find((x) => x.date === local(d))?.count;
    expect(countOn(at(3))).toBe(3);
    expect(countOn(at(2))).toBe(1);
    expect(countOn(at(1))).toBe(1);
    expect(countOn(at(40))).toBe(1);
    expect(days.some((d) => d.date === local(at(200)))).toBe(false);
    expect(body).toMatchObject({ activeDays: 4, longestStreak: 3 });
    expect(
      (await as(student).get('/api/me/activity?weeks=8').expect(200)).body.days.length,
    ).toBeLessThanOrEqual(56);
    await as(student).get('/api/me/activity?weeks=30').expect(400);
    // Только ученик и только свои данные.
    await as(await newTeacher())
      .get('/api/me/activity')
      .expect(403);
  });

  it('AC-PRF-23 completeness: student and teacher items, percent; «Скрыть» hides for 30 days', async () => {
    const student = await newStudent();
    const p1 = (await as(student).get('/api/me/profile').expect(200)).body.completeness;
    expect(p1).toEqual({ percent: 25, missing: ['avatar', 'email', 'emailVerified'], hiddenUntil: null });
    await as(student).send('put', '/api/me/avatar', { kind: 'preset', preset: 'owl' }).expect(200);
    expect((await as(student).get('/api/me/profile').expect(200)).body.completeness.percent).toBe(50);
    await as(student).send('post', '/api/me/profile-completeness/hide').expect(204);
    const hidden = (await as(student).get('/api/me/profile').expect(200)).body.completeness
      .hiddenUntil as string;
    expect(new Date(hidden).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(new Date(hidden).getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY + 60_000);

    const teacher = await newTeacher();
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.completeness).toEqual({
      percent: 0,
      missing: ['photoOrAvatar', 'position', 'about', 'emailVerified'],
      hiddenUntil: null,
    });
    await as(teacher)
      .send('patch', '/api/me/profile', { position: 'Учитель биологии', about: 'О себе' })
      .expect(200);
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.completeness).toMatchObject({
      percent: 50,
      missing: ['photoOrAvatar', 'emailVerified'],
    });
    // API-S-21 по-прежнему принимает только «class» и «achievements».
    await as(student).send('post', '/api/student/nav-seen', { section: 'profile_completeness' }).expect(400);
  });

  it('AC-PRF-21 AC-PRF-25 header numbers; «Сдано X из Y» for deadlines; days without activity for «Требуют внимания»', async () => {
    const teacher = await newTeacher();
    const t = await setup(teacher);
    await as(teacher)
      .send('post', '/api/teacher/assignments', {
        classId: t.classId,
        subjectId: t.subjectId,
        topicId: t.topicId,
        dueAt: new Date(Date.now() + 4 * DAY).toISOString(),
      })
      .expect(201);
    const s1 = await newStudent(t.code);
    await newStudent(t.code);
    const lesson = (await as(s1).get(`/api/student/topics/${t.topicId}`).expect(200)).body;
    const attempt = (
      await as(s1)
        .send('post', `/api/student/quizzes/${lesson.quizId}/attempts`)
        .expect((r) => expect(r.status).toBeLessThan(300))
    ).body;
    for (const q of attempt.questions) {
      await as(s1)
        .send('post', `/api/student/attempts/${attempt.attemptId}/answers`, {
          questionId: q.id,
          optionId: q.options.find((o: { text: string }) => o.text.endsWith('0')).id,
        })
        .expect((r) => expect(r.status).toBeLessThan(300));
    }
    await as(s1)
      .send('post', `/api/student/attempts/${attempt.attemptId}/finish`)
      .expect((r) => expect(r.status).toBeLessThan(300));

    const d = (await as(teacher).get('/api/me/dashboard').expect(200)).body.teacher;
    expect(d.counts).toMatchObject({ classes: 1, students: 2, publishedTopics: 1, battlesHosted: 0 });
    expect(d.deadlines[0]).toMatchObject({ classId: t.classId, submitted: 1, total: 2 });
    for (const a of d.attention) expect(a.daysInactive === null || a.daysInactive >= 0).toBe(true);

    const st = (await as(s1).get('/api/me/dashboard').expect(200)).body.student;
    const achievements = (await as(s1).get('/api/student/achievements').expect(200)).body;
    expect(st.achievements).toMatchObject({
      masteredTopics: 1,
      badgesEarned: achievements.earnedCount,
      badgesTotal: achievements.totalCount,
    });
  });
});
