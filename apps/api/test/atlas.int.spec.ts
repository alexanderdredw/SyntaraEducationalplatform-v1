import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

/**
 * Модуль «Mendeleev Atlas» (docs/CHEM_TZ_2.md): модуль предмета (REQ-ATL-01), данные экранов (API-S-23, API-PUB-15),
 * квиз «Проверь знания» и игра «Кто этот учёный?» с XP (API-S-24…27, BR-XP-05, AC-ATL-06), предпросмотр учителя
 * (API-T-32, API-T-33, решение А-9), права (REQ-ATL-06.5, AC-ATL-11).
 */
describe('atlas (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  let teacher: Session;
  let student: Session;
  let other: Session;
  let chemistry: string;
  const http = () => request(stack.app.getHttpServer());
  const guest = (path: string, lang = 'ru') => http().get(path).set('Accept-Language', lang);
  const as = (s: Session) => ({
    get: (path: string, lang = 'ru') => http().get(path).set('Cookie', s.cookie).set('Accept-Language', lang),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .set('Accept-Language', 'ru')
        .send(body),
  });
  const register = async (login_: string) => {
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: 'Ученик Атласа', login: login_, password: 'student-pass-1' })
      .expect(201);
    return login(http, login_, 'student-pass-1');
  };

  /** Ответить на все вопросы сессии первым вариантом. */
  async function answerAll(
    s: Session,
    session: { id: string; question: { options: Array<{ id: string }> } | null },
  ) {
    let question = session.question;
    while (question) {
      const res = await as(s)
        .post(`/api/student/atlas-quiz/${session.id}/answers`, { optionId: question.options[0]!.id })
        .expect(200);
      expect(typeof res.body.correct).toBe('boolean');
      expect(question.options.map((o) => o.id)).toContain(res.body.correctOptionId);
      question = res.body.next;
    }
  }

  /** Ответы сессии задаются напрямую: вопросы случайные, правильные варианты заранее неизвестны. */
  async function setAnswers(sessionId: string, marks: Array<{ correct: boolean; hinted: boolean }>) {
    const [row] = await stack.db
      .select({ state: schema.atlasQuizSessions.state })
      .from(schema.atlasQuizSessions)
      .where(eq(schema.atlasQuizSessions.id, sessionId));
    const state = row!.state as { answers: Array<{ correct: boolean; hinted?: boolean }> };
    state.answers = state.answers.map((a, i) => ({ ...a, ...marks[i] }));
    await stack.db
      .update(schema.atlasQuizSessions)
      .set({ state, correctCount: marks.filter((m) => m.correct).length })
      .where(eq(schema.atlasQuizSessions.id, sessionId));
  }

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
    student = await register('atlas-student');
    other = await register('atlas-other');
    const [row] = await stack.db
      .select({ id: schema.subjects.id })
      .from(schema.subjects)
      .where(eq(schema.subjects.code, 'chemistry'));
    chemistry = row!.id;
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('REQ-ATL-01 the subject page reports the atlas module only for «Химия»', async () => {
    const page = await guest(`/api/public/subjects/${chemistry}`).expect(200);
    expect(page.body.module).toBe('atlas-chemistry');
    const anatomy = await guest(`/api/public/subjects/${B.subjectAnatomy}`).expect(200);
    expect(anatomy.body).not.toHaveProperty('module');
    const own = await as(student).get(`/api/student/subjects/${chemistry}`).expect(200);
    expect(own.body.module).toBe('atlas-chemistry');
  });

  it('REQ-ATL-03, REQ-ATL-04, AC-ATL-08 a guest gets 60 elements with color, group and image; scientists; no statuses', async () => {
    const res = await guest(`/api/public/subjects/${chemistry}/atlas`).expect(200);
    expect(res.body.subject).toEqual({ id: chemistry, title: 'Химия' });
    expect(res.body.elements).toHaveLength(60);
    expect(res.body.elements.map((e: { number: number }) => e.number)).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
    const oxygen = res.body.elements[7];
    expect(oxygen).toMatchObject({
      code: 'oxygen',
      number: 8,
      symbol: 'O',
      group: 'nonmetal',
      color: '#EF4444',
      title: 'Кислород',
      description: 'Жизненно важный газ, необходимый для аэробного дыхания и горения.',
    });
    expect(oxygen.imageAlt).toContain('Кислород (O)');
    expect(oxygen).not.toHaveProperty('status');
    expect(res.body.scientists.title).toBe('Учёные-химики');
    expect(res.body.hasGlossary).toBe(true);
    // Подписанная ссылка хранилища (BR-FILE-04) — только если картинки загружены (в тестах — без хранилища).
    expect(oxygen.imageUrl === null || typeof oxygen.imageUrl === 'string').toBe(true);

    const en = await guest(`/api/public/subjects/${chemistry}/atlas`, 'en').expect(200);
    expect(en.body.elements[7].title).toBe('Oxygen');
    expect(en.body.needsReview).toBe(true);
  });

  it('REQ-ATL-01 a subject without the module and an unknown subject → 404', async () => {
    await guest(`/api/public/subjects/${B.subjectAnatomy}/atlas`).expect(404);
    await guest('/api/public/subjects/00000000-0000-7000-8000-000000000000/atlas').expect(404);
    await as(student).get(`/api/student/subjects/${B.subjectAnatomy}/atlas`).expect(404);
  });

  it('REQ-ATL-03, decision А-6 a student sees topic statuses; an opened element becomes «started»', async () => {
    const before = await as(student).get(`/api/student/subjects/${chemistry}/atlas`).expect(200);
    const oxygen = before.body.elements[7];
    expect(oxygen.status).toBe('not_started');
    await as(student)
      .post('/api/student/events', {
        type: 'lesson_opened',
        topicId: oxygen.topicId,
        idempotencyKey: `lesson:${oxygen.topicId}:2026-10-27`,
      })
      .expect(204);
    const after = await as(student).get(`/api/student/subjects/${chemistry}/atlas`).expect(200);
    expect(after.body.elements[7].status).toBe('started');
    expect(after.body.scientists.status).toBe('not_started');
    // Решение А-15: показатели Syntara AI — без попыток: слабых тем нет, точности нет, рекомендуется первая тема.
    expect(after.body.stats).toEqual({ weak: 0, recommended: 'Водород', accuracy: null });
    const guestData = await guest(`/api/public/subjects/${chemistry}/atlas`).expect(200);
    expect(guestData.body).not.toHaveProperty('stats');
  });

  it('REQ-ATL-01 the lesson «Учёные-химики» gives section codes for /scientists/:code', async () => {
    const atlas = await guest(`/api/public/subjects/${chemistry}/atlas`).expect(200);
    const lesson = await guest(`/api/public/topics/${atlas.body.scientists.topicId}`).expect(200);
    expect(lesson.body.sections.map((s: { code: string }) => s.code)).toEqual([
      'lavoisier',
      'dalton',
      'nobel',
      'mendeleev',
      'curie',
      'rutherford',
      'bohr',
      'pauling',
      'hodgkin',
      'sources',
    ]);
  });

  it('AC-ATL-06, BR-QZ-01 the quiz «Проверь знания»: 10 server questions without answers, check after each answer, XP = correct answers', async () => {
    const start = await as(student)
      .post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements' })
      .expect(201);
    expect(start.body).toMatchObject({ kind: 'elements', status: 'in_progress', total: 10, answered: 0 });
    const q = start.body.question;
    expect(q).toMatchObject({ index: 1, difficulty: 'medium' });
    expect(q.options).toHaveLength(4);
    expect(JSON.stringify(q)).not.toMatch(/correct/i);
    expect(q.text).not.toMatch(/^___/);

    // Незавершённую нельзя завершить; ответ не из текущего вопроса — 400.
    await as(student).post(`/api/student/atlas-quiz/${start.body.id}/finish`).expect(409);
    await as(student)
      .post(`/api/student/atlas-quiz/${start.body.id}/answers`, { optionId: 'nope' })
      .expect(400);

    await answerAll(student, start.body);
    const state = await as(student).get(`/api/student/atlas-quiz/${start.body.id}`).expect(200);
    expect(state.body).toMatchObject({ answered: 10, question: null, result: null });

    const finish = await as(student).post(`/api/student/atlas-quiz/${start.body.id}/finish`).expect(200);
    expect(finish.body.status).toBe('finished');
    const result = finish.body.result;
    expect(result.total).toBe(10);
    expect(result.xpAwarded).toBe(result.correct);
    expect(result.percent).toBe(Math.round(result.correct * 10));
    expect(result.mistakes).toHaveLength(10 - result.correct);
    // Повторное завершение не начисляет XP повторно (BR-XP-02).
    await as(student).post(`/api/student/atlas-quiz/${start.body.id}/finish`).expect(409);
    const [event] = await stack.db
      .select()
      .from(schema.learningEvents)
      .where(eq(schema.learningEvents.idempotencyKey, `atlas-quiz:${start.body.id}`));
    expect(event?.type).toBe('atlas_quiz_finished');
  });

  it('BR-XP-05 a common daily cap of 20 XP for the quiz and the scientists game; the day counts in the streak (BR-ST-02)', async () => {
    const s = await register('atlas-cap');
    const finishWith = async (kind: 'elements' | 'scientists', correct: number) => {
      const start = await as(s).post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind }).expect(201);
      await answerAll(s, start.body);
      await setAnswers(
        start.body.id,
        Array.from({ length: start.body.total }, (_, i) => ({ correct: i < correct, hinted: false })),
      );
      const res = await as(s).post(`/api/student/atlas-quiz/${start.body.id}/finish`).expect(200);
      return res.body.result.xpAwarded as number;
    };
    expect(await finishWith('elements', 10)).toBe(10);
    expect(await finishWith('scientists', 9)).toBe(9);
    expect(await finishWith('elements', 10)).toBe(1);
    expect(await finishWith('scientists', 9)).toBe(0);
    const stats = await as(s).get('/api/me/stats').expect(200);
    expect(stats.body).toMatchObject({ xpTotal: 20, streakDays: 1 });
  });

  it('API-S-29, REQ-TST-04, BR-TST-01 «50/50» in the atlas quiz: two wrong options removed by the server, recorded, ≤ 3', async () => {
    const s = await register('atlas-hint');
    const start = (
      await as(s).post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements' }).expect(201)
    ).body;
    expect(start).toMatchObject({ hintsLeft: 3, answers: [] });
    expect(start.question.removed).toEqual([]);
    const hint = () => as(s).post(`/api/student/atlas-quiz/${start.id}/hint`);
    const first = (await hint().expect(200)).body;
    expect(first.hintsLeft).toBe(2);
    expect(first.removedOptionIds).toHaveLength(2);
    // Повтор — та же подсказка; состояние сессии хранит убранные варианты.
    expect((await hint().expect(200)).body).toEqual(first);
    expect(
      (await as(s).get(`/api/student/atlas-quiz/${start.id}`).expect(200)).body.question.removed,
    ).toEqual(first.removedOptionIds);
    // Убранный вариант выбрать нельзя.
    await as(s)
      .post(`/api/student/atlas-quiz/${start.id}/answers`, { optionId: first.removedOptionIds[0] })
      .expect(400);
    const left = start.question.options
      .map((o: { id: string }) => o.id)
      .filter((id: string) => !first.removedOptionIds.includes(id));
    const answer = (
      await as(s).post(`/api/student/atlas-quiz/${start.id}/answers`, { optionId: left[0] }).expect(200)
    ).body;
    // Правильный вариант не был убран; ответ помечен подсказкой; данные для объяснения (REQ-TST-09.3).
    expect(left).toContain(answer.correctOptionId);
    expect(answer.hinted).toBe(true);
    expect(answer.answer).toMatchObject({
      code: expect.any(String),
      symbol: expect.any(String),
      number: expect.any(Number),
      family: expect.any(String),
    });
    // Ещё две подсказки — и лимит исчерпан.
    let next = answer.next;
    for (let i = 0; i < 2; i++) {
      const removed = (await hint().expect(200)).body.removedOptionIds as string[];
      const option = next.options.find((o: { id: string }) => !removed.includes(o.id));
      next = (
        await as(s).post(`/api/student/atlas-quiz/${start.id}/answers`, { optionId: option.id }).expect(200)
      ).body.next;
    }
    const limit = await hint().expect(409);
    expect(limit.body.fieldErrors).toEqual({ hint: 'hintLimit' });
    const state = (await as(s).get(`/api/student/atlas-quiz/${start.id}`).expect(200)).body;
    expect(state.hintsLeft).toBe(0);
    expect(state.answers.map((a: { hinted: boolean }) => a.hinted)).toEqual([true, true, true]);
    // Чужая сессия — 404.
    await as(other).post(`/api/student/atlas-quiz/${start.id}/hint`).expect(404);
  });

  it('AC-TST-05, BR-TST-01, BR-XP-05 atlas XP = floor(sum of weights): a correct answer with a hint weighs 0.5', async () => {
    const s = await register('atlas-hintxp');
    const start = (
      await as(s).post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements' }).expect(201)
    ).body;
    await answerAll(s, start);
    // 7 верно без подсказки, 3 верно с подсказкой → 7 + 1,5 = 8,5 → 8 XP; в результате — 10 из 10 и «с подсказкой: 3».
    await setAnswers(start.id, [
      ...Array(7).fill({ correct: true, hinted: false }),
      ...Array(3).fill({ correct: true, hinted: true }),
    ]);
    const result = (await as(s).post(`/api/student/atlas-quiz/${start.id}/finish`).expect(200)).body.result;
    expect(result).toMatchObject({ correct: 10, percent: 100, hinted: 3, xpAwarded: 8, mistakes: [] });
  });

  it('REQ-TST-05 the atlas result: best and previous result of the mode, families, mistakes with the answer; «Повторить ошибки»', async () => {
    const s = await register('atlas-result');
    const play = async (marks: boolean[], retry?: string) => {
      const start = (
        await as(s)
          .post(`/api/student/subjects/${chemistry}/atlas-quiz`, {
            kind: 'elements',
            ...(retry ? { retry } : {}),
          })
          .expect(201)
      ).body;
      await answerAll(s, start);
      await setAnswers(
        start.id,
        marks.map((correct) => ({ correct, hinted: false })),
      );
      return {
        id: start.id as string,
        total: start.total as number,
        result: (await as(s).post(`/api/student/atlas-quiz/${start.id}/finish`).expect(200)).body.result,
      };
    };
    const first = await play([true, true, true, true, true, true, false, false, false, false]);
    expect(first.result).toMatchObject({ percent: 60, bestPercent: 60, previousPercent: null });
    expect(first.result.mistakes).toHaveLength(4);
    for (const m of first.result.mistakes) {
      expect(m.question.length).toBeGreaterThan(5);
      expect(m.selected).toBeTruthy();
      expect(m).toMatchObject({
        code: expect.any(String),
        symbol: expect.any(String),
        family: expect.any(String),
      });
    }
    const families = first.result.families as Array<{ correct: number; total: number }>;
    expect(families.reduce((n, f) => n + f.total, 0)).toBe(10);
    expect(families.reduce((n, f) => n + f.correct, 0)).toBe(6);

    // «Повторить ошибки» — новая сессия только из 4 ошибочных элементов.
    const retry = await play([true, true, true, true], first.id);
    expect(retry.total).toBe(4);
    expect(retry.result).toMatchObject({ percent: 100, bestPercent: 100, previousPercent: 60 });
    // Ошибок нет — повторять нечего; чужая сессия — 404.
    await as(s)
      .post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements', retry: retry.id })
      .expect(409);
    await as(other)
      .post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements', retry: first.id })
      .expect(404);
    // Сравнение — по режиму: игра про учёных считается отдельно.
    const sci = (
      await as(s).post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'scientists' }).expect(201)
    ).body;
    await answerAll(s, sci);
    const sciResult = (await as(s).post(`/api/student/atlas-quiz/${sci.id}/finish`).expect(200)).body.result;
    expect(sciResult.previousPercent).toBeNull();
    expect(sciResult.families).toEqual([]);
  });

  it('decision А-5 the game «Кто этот учёный?»: 9 questions about the scientists, 2 or 4 options', async () => {
    const start = await as(student)
      .post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'scientists' })
      .expect(201);
    expect(start.body.total).toBe(9);
    expect(start.body.question.text.length).toBeGreaterThan(10);
    const titles = start.body.question.options.map((o: { title: string }) => o.title);
    expect(titles.length === 2 || titles.length === 4).toBe(true);
    expect(titles.every((t: string) => /\s/.test(t))).toBe(true);
  });

  it('REQ-ATL-06.5, BR-ACL-03 access: a guest and a teacher cannot play; somebody else’s session → 404', async () => {
    await http().post(`/api/student/subjects/${chemistry}/atlas-quiz`).send({ kind: 'elements' }).expect(401);
    await as(teacher).post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements' }).expect(403);
    await as(student)
      .post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'chemicals' })
      .expect(400);
    await as(student)
      .post(`/api/student/subjects/${B.subjectAnatomy}/atlas-quiz`, { kind: 'elements' })
      .expect(404);
    const start = await as(student)
      .post(`/api/student/subjects/${chemistry}/atlas-quiz`, { kind: 'elements' })
      .expect(201);
    await as(other).get(`/api/student/atlas-quiz/${start.body.id}`).expect(404);
    await as(other)
      .post(`/api/student/atlas-quiz/${start.body.id}/answers`, {
        optionId: start.body.question.options[0].id,
      })
      .expect(404);
    await as(other).post(`/api/student/atlas-quiz/${start.body.id}/finish`).expect(404);
    const [session] = await stack.db
      .select({ answers: schema.atlasQuizSessions.correctCount })
      .from(schema.atlasQuizSessions)
      .where(and(eq(schema.atlasQuizSessions.id, start.body.id)));
    expect(session?.answers).toBe(0);
  });

  it('REQ-ATL-03 the element quiz uses all elements again after the approved unique descriptions (owner decision 2026-10-29)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const preview = await as(teacher)
        .get(`/api/teacher/atlas/${chemistry}/preview?kind=elements`)
        .expect(200);
      for (const q of preview.body.questions) for (const o of q.options) seen.add(o);
    }
    const formerlySkipped = [
      'Углерод',
      'Ниобий',
      'Молибден',
      'Серебро',
      'Индий',
      'Олово',
      'Йод',
      'Ксенон',
      'Цезий',
      'Барий',
      'Лантан',
      'Неодим',
    ];
    expect(formerlySkipped.filter((name) => seen.has(name)).length).toBeGreaterThan(0);
  });

  it('API-T-32, API-T-34 a teacher gets questions with correct answers; nothing is recorded; a student cannot', async () => {
    const preview = await as(teacher)
      .get(`/api/teacher/atlas/${chemistry}/preview?kind=elements`)
      .expect(200);
    expect(preview.body.questions).toHaveLength(10);
    for (const q of preview.body.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.options[q.correct]).toBe(q.answer.title);
      expect(q.answer.code).toBeTruthy();
    }
    const scientists = await as(teacher)
      .get(`/api/teacher/atlas/${chemistry}/preview?kind=scientists`)
      .expect(200);
    expect(scientists.body.questions).toHaveLength(9);
    expect(scientists.body.questions[0].options[scientists.body.questions[0].correct]).toBe(
      scientists.body.questions[0].answer.title,
    );
    await as(teacher).get(`/api/teacher/atlas/${chemistry}/preview?kind=x`).expect(400);
    await as(teacher).get(`/api/teacher/atlas/${B.subjectAnatomy}/preview?kind=elements`).expect(404);
    await as(student).get(`/api/teacher/atlas/${chemistry}/preview?kind=elements`).expect(403);
    const sessions = await stack.db
      .select()
      .from(schema.atlasQuizSessions)
      .where(eq(schema.atlasQuizSessions.studentId, teacher.userId));
    expect(sessions).toEqual([]);

    // Тест элемента — общий тест темы учителя (API-T-34).
    const atlas = await guest(`/api/public/subjects/${chemistry}/atlas`).expect(200);
    const oxygen = atlas.body.elements[7].topicId;
    const topic = await as(teacher).get(`/api/teacher/topics/${oxygen}/test`).expect(200);
    expect(topic.body.questions).toHaveLength(5);
    for (const q of topic.body.questions)
      expect(q.options.map((o: { id: string }) => o.id)).toContain(q.correctOptionId);
    await as(student).get(`/api/teacher/topics/${oxygen}/test`).expect(403);
  });
});
