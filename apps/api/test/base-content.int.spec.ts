import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

/**
 * Этап 8.6 — базовая программа платформы: гость читает каталог и «Обзор» (BR-VIS-04, AC-CNT-01), ученик проходит
 * квиз базового урока (AC-CNT-02), никто не меняет базовый контент через API (BR-ACL-05, AC-CNT-03), «Скоро»
 * у предметов без тем (BR-CNT-08), пометки языка (BR-CNT-05).
 */
describe('base content (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  let teacher: Session;
  let support: Session;
  let student: Session;
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
        .send(body),
    put: (path: string, body: object) =>
      http().put(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf),
  });

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
    support = await login(http, ACCOUNTS.support);
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: 'Ученик', login: 'base-student', password: 'student-pass-1' })
      .expect(201);
    student = await login(http, 'base-student', 'student-pass-1');
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('AC-CNT-01, BR-VIS-04 a guest reads the catalog, the subject and the overview of a base lesson; no quiz', async () => {
    const catalog = await guest('/api/public/catalog').expect(200);
    expect(catalog.body.sections.map((s: { title: string }) => s.title)).toEqual([
      'Биология',
      'Естественные науки',
      'Точные науки',
      'Гуманитарные науки',
      'Языки',
    ]);
    // «Химия» — в «Естественных науках», предметов вне разделов у базовой программы нет; порядок — position
    // из subject.yaml (решение владельца 2026-10-17).
    expect(catalog.body.subjects).toEqual([]);
    const natural = await guest(`/api/public/sections/${catalog.body.sections[1].id}`).expect(200);
    expect(natural.body.subjects.map((s: { title: string; status: string }) => [s.title, s.status])).toEqual([
      ['Химия', 'available'],
      ['Физика', 'soon'],
      ['География', 'soon'],
    ]);

    const section = await guest(`/api/public/sections/${B.sectionBiology}`).expect(200);
    expect(section.body.subjects).toEqual([
      expect.objectContaining({ id: B.subjectAnatomy, status: 'available' }),
      expect.objectContaining({ id: B.subjectGeneralBiology, status: 'soon' }),
    ]);

    const subject = await guest(`/api/public/subjects/${B.subjectAnatomy}`).expect(200);
    expect(subject.body.topics.map((t: { title: string }) => t.title)).toEqual([
      'Сердечно-сосудистая система',
      'Дыхательная система',
      'Пищеварительная система',
    ]);
    expect(subject.body.topics[0]).not.toHaveProperty('status');
    // BR-CHAP-05: у предмета без глав ответ прежний — поля chapters нет.
    expect(subject.body).not.toHaveProperty('chapters');

    const lesson = await guest(`/api/public/topics/${B.topicCardio}`).expect(200);
    expect(lesson.body).toMatchObject({
      title: 'Сердечно-сосудистая система',
      quizId: null,
      questionsCount: 5,
      needsReview: false,
      locale: 'ru',
      summary: 'Сердце и сосуды, обеспечивающие кровообращение.',
    });
    expect(lesson.body.sections.map((s: { title: string }) => s.title)).toEqual([
      'Основные функции',
      'Состав сердечно-сосудистой системы',
      'Строение сердца',
      'Круги кровообращения',
      'Кровеносные сосуды и давление',
    ]);
    expect(lesson.body.sections[2].illustrationAlt).toContain('Схема сердца');

    // Квиз, события и прогресс — только после входа.
    await http().post(`/api/student/quizzes/${B.quizCardio}/attempts`).expect(401);
    await http().post('/api/student/events').send({}).expect(401);
  });

  it('BR-CHAP-03, BR-CHAP-05 a subject with chapters: chapters in order with their topics for a student and a guest; empty chapters are hidden', async () => {
    const { subjectChapters, subjectChapterTranslations, topics } = schema;
    const [food, circulation, empty] = await stack.db
      .insert(subjectChapters)
      .values([
        { subjectId: B.subjectAnatomy, code: 'food', position: 1 },
        { subjectId: B.subjectAnatomy, code: 'circulation', position: 2 },
        { subjectId: B.subjectAnatomy, code: 'empty', position: 3 },
      ])
      .returning();
    await stack.db.insert(subjectChapterTranslations).values([
      { chapterId: food!.id, locale: 'ru', title: 'Питание' },
      { chapterId: circulation!.id, locale: 'ru', title: 'Кровь и дыхание' },
      { chapterId: circulation!.id, locale: 'en', title: 'Blood and breathing', needsReview: true },
      { chapterId: empty!.id, locale: 'ru', title: 'Пусто' },
    ]);
    await stack.db
      .update(topics)
      .set({ chapterId: circulation!.id })
      .where(inArray(topics.id, [B.topicCardio, B.topicRespiratory]));
    await stack.db.update(topics).set({ chapterId: food!.id }).where(eq(topics.id, B.topicDigestive));
    try {
      const expected = [
        { id: food!.id, title: 'Питание', topicIds: [B.topicDigestive] },
        { id: circulation!.id, title: 'Кровь и дыхание', topicIds: [B.topicCardio, B.topicRespiratory] },
      ];
      const asGuest = await guest(`/api/public/subjects/${B.subjectAnatomy}`).expect(200);
      expect(asGuest.body.chapters).toEqual(expected);
      const asStudent = await as(student).get(`/api/student/subjects/${B.subjectAnatomy}`).expect(200);
      expect(asStudent.body.chapters).toEqual(expected);
      expect(asStudent.body.topics.map((t: { status: string }) => t.status)).toEqual([
        'not_started',
        'not_started',
        'not_started',
      ]);
      const en = await guest(`/api/public/subjects/${B.subjectAnatomy}`, 'en').expect(200);
      expect(en.body.chapters.map((c: { title: string }) => c.title)).toEqual([
        'Питание',
        'Blood and breathing',
      ]);
    } finally {
      await stack.db.update(topics).set({ chapterId: null }).where(eq(topics.subjectId, B.subjectAnatomy));
      await stack.db
        .delete(subjectChapterTranslations)
        .where(inArray(subjectChapterTranslations.chapterId, [food!.id, circulation!.id, empty!.id]));
      await stack.db.delete(subjectChapters).where(eq(subjectChapters.subjectId, B.subjectAnatomy));
    }
  });

  it('AC-CHEM-02, AC-CHEM-03, AC-CHEM-04 «Химия»: 2 chapters, 60 elements by atomic number + «Учёные-химики»; an element lesson; KK and EN «на проверке»', async () => {
    const [chemistry] = await stack.db
      .select({ id: schema.subjects.id })
      .from(schema.subjects)
      .where(eq(schema.subjects.code, 'chemistry'));
    const page = await guest(`/api/public/subjects/${chemistry!.id}`).expect(200);
    expect(page.body.chapters.map((c: { title: string }) => c.title)).toEqual([
      'Химические элементы',
      'Учёные-химики',
    ]);
    expect(page.body.chapters.map((c: { topicIds: string[] }) => c.topicIds.length)).toEqual([60, 1]);
    expect(page.body.topics).toHaveLength(61);
    expect(
      page.body.topics.slice(0, 3).map((t: { number: number; title: string }) => [t.number, t.title]),
    ).toEqual([
      [1, 'Водород'],
      [2, 'Гелий'],
      [3, 'Литий'],
    ]);
    expect(page.body.topics.at(-1)).toMatchObject({ number: 61, title: 'Учёные-химики' });

    const oxygenId = page.body.topics[7].id;
    const lesson = await as(student).get(`/api/student/topics/${oxygenId}`).expect(200);
    expect(lesson.body).toMatchObject({
      title: 'Кислород',
      number: 8,
      questionsCount: 5,
      needsReview: false,
    });
    expect(lesson.body.funFact).toContain('46%');
    expect(lesson.body.illustrationAlt).toContain('кислород, O');
    expect(lesson.body.sections.map((s: { title: string }) => s.title).at(-1)).toBe('Источники');
    expect(lesson.body.sections[0].body).toContain('- ');
    expect(lesson.body.quizId).toBeTruthy();

    for (const lang of ['kk', 'en']) {
      const tr = await guest(`/api/public/topics/${oxygenId}`, lang).expect(200);
      expect(tr.body).toMatchObject({ locale: lang, needsReview: true });
      expect(tr.body.sections).toHaveLength(lesson.body.sections.length);
    }
  });

  it('BR-CNT-05, REQ-ST-LES-07 language marks: KK is «на проверке»; EN has its own sixth section', async () => {
    const kk = await guest(`/api/public/topics/${B.topicCardio}`, 'kk').expect(200);
    expect(kk.body).toMatchObject({ locale: 'kk', needsReview: true, title: 'Жүрек-қантамыр жүйесі' });
    expect(kk.body.sections).toHaveLength(5);
    const en = await guest(`/api/public/topics/${B.topicCardio}`, 'en').expect(200);
    expect(en.body.sections.map((s: { title: string }) => s.title).at(-1)).toBe('Microcirculation');
  });

  it('BR-VIS-04 a guest never sees teacher lessons, even from the common catalog, nor drafts', async () => {
    const created = await as(teacher)
      .post('/api/teacher/subjects', {
        translations: { ru: { title: 'Личный курс' } },
        inPublicCatalog: true,
      })
      .expect(201);
    const subjectId = created.body.id as string;
    const topicId = (await as(teacher).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body.id;
    await as(teacher)
      .put(`/api/teacher/topics/${topicId}`, { translations: { ru: { title: 'Тема' } }, materialIds: [] })
      .expect(204);
    await as(teacher).post(`/api/teacher/topics/${topicId}/publish`).expect(200);
    // Ученику предмет из общего каталога виден, гостю — нет.
    const studentCatalog = await as(student).get('/api/student/catalog').expect(200);
    expect(studentCatalog.body.subjects.map((s: { id: string }) => s.id)).toContain(subjectId);
    const guestCatalog = await guest('/api/public/catalog').expect(200);
    expect(guestCatalog.body.subjects.map((s: { id: string }) => s.id)).not.toContain(subjectId);
    await guest(`/api/public/subjects/${subjectId}`).expect(404);
    await guest(`/api/public/topics/${topicId}`).expect(404);
    // Снятая с публикации базовая тема гостю не видна.
    await stack.db
      .update(schema.topics)
      .set({ status: 'draft' })
      .where(eq(schema.topics.id, B.topicDigestive));
    try {
      await guest(`/api/public/topics/${B.topicDigestive}`).expect(404);
    } finally {
      await stack.db
        .update(schema.topics)
        .set({ status: 'published' })
        .where(eq(schema.topics.id, B.topicDigestive));
    }
  });

  it('AC-CNT-02 a student passes the quiz of a base lesson and gets XP', async () => {
    const lesson = await as(student).get(`/api/student/topics/${B.topicCardio}`).expect(200);
    expect(lesson.body.quizId).toBe(B.quizCardio);
    const attempt = (await as(student).post(`/api/student/quizzes/${B.quizCardio}/attempts`).expect(200))
      .body;
    const ids = attempt.questions.map((q: { id: string }) => q.id) as string[];
    const [rows, correct] = await Promise.all([
      stack.db.select().from(schema.questions).where(inArray(schema.questions.id, ids)),
      stack.db
        .select()
        .from(schema.answerOptions)
        .where(and(inArray(schema.answerOptions.questionId, ids), eq(schema.answerOptions.isCorrect, true))),
    ]);
    for (const q of rows) {
      const body =
        q.type === 'text_input'
          ? { questionId: q.id, textAnswer: q.textAnswer }
          : { questionId: q.id, optionId: correct.find((o) => o.questionId === q.id)!.id };
      const res = await as(student)
        .post(`/api/student/attempts/${attempt.attemptId}/answers`, body)
        .expect(200);
      expect(res.body.correct).toBe(true);
    }
    const finished = await as(student).post(`/api/student/attempts/${attempt.attemptId}/finish`).expect(200);
    expect(finished.body.scorePercent).toBe(100);
    expect(finished.body.xpAwarded).toBeGreaterThan(0);
    const subject = await as(student).get(`/api/student/subjects/${B.subjectAnatomy}`).expect(200);
    expect(subject.body.topics[0]).toMatchObject({ id: B.topicCardio, status: 'mastered' });
  });

  it('AC-CNT-03, BR-ACL-05 a teacher cannot change a base subject, topic, question or file (404); data unchanged', async () => {
    const [media] = await stack.db
      .insert(schema.mediaFiles)
      .values({
        ownerId: null,
        kind: 'illustration',
        originalName: 'heart.png',
        mime: 'image/png',
        sizeBytes: 100,
        storageKey: 'content/test-heart.png',
        scanStatus: 'clean',
      })
      .returning();
    const before = await stack.db.select().from(schema.topicVersions);
    const t = as(teacher);
    const question = {
      type: 'single_choice',
      difficulty: 'easy',
      translations: { ru: { text: 'Вопрос' } },
      options: [
        { translations: { ru: 'Да' }, isCorrect: true },
        { translations: { ru: 'Нет' }, isCorrect: false },
      ],
    };
    await t.get(`/api/teacher/subjects/${B.subjectAnatomy}`).expect(404);
    await t
      .patch(`/api/teacher/subjects/${B.subjectAnatomy}`, { translations: { ru: { title: 'Взлом' } } })
      .expect(404);
    await t.post(`/api/teacher/subjects/${B.subjectAnatomy}/topics`).expect(404);
    await t.get(`/api/teacher/topics/${B.topicCardio}`).expect(404);
    await t
      .put(`/api/teacher/topics/${B.topicCardio}`, {
        translations: { ru: { title: 'Взлом' } },
        materialIds: [],
      })
      .expect(404);
    await t.post(`/api/teacher/topics/${B.topicCardio}/publish`).expect(404);
    await t.post(`/api/teacher/topics/${B.topicCardio}/unpublish`).expect(404);
    await t.post(`/api/teacher/topics/${B.topicCardio}/quiz/questions`, question).expect(404);
    await t.put(`/api/teacher/questions/${B.demoQuestion}`, question).expect(404);
    await t.delete(`/api/teacher/questions/${B.demoQuestion}`).expect(404);
    await t
      .post('/api/files/upload-url', {
        kind: 'material',
        topicId: B.topicCardio,
        fileName: 'a.pdf',
        mime: 'application/pdf',
        size: 100,
      })
      .expect(404);
    await t.post(`/api/files/${media!.id}/complete`).expect(404);

    // Ученик и служебные роли — 403, гость — 401.
    for (const s of [student, support]) {
      await as(s)
        .patch(`/api/teacher/subjects/${B.subjectAnatomy}`, { translations: { ru: { title: 'Взлом' } } })
        .expect(403);
      await as(s).put(`/api/teacher/questions/${B.demoQuestion}`, question).expect(403);
    }
    await http().put(`/api/teacher/topics/${B.topicCardio}`).send({}).expect(401);

    const [subjectTr] = await stack.db
      .select()
      .from(schema.subjectTranslations)
      .where(
        and(
          eq(schema.subjectTranslations.subjectId, B.subjectAnatomy),
          eq(schema.subjectTranslations.locale, 'ru'),
        ),
      );
    expect(subjectTr!.title).toBe('Анатомия человека');
    const [demo] = await stack.db
      .select()
      .from(schema.questions)
      .where(eq(schema.questions.id, B.demoQuestion));
    expect(demo!.archivedAt).toBeNull();
    expect(await stack.db.select().from(schema.topicVersions)).toHaveLength(before.length);
    const [topic] = await stack.db.select().from(schema.topics).where(eq(schema.topics.id, B.topicCardio));
    expect(topic!.status).toBe('published');
  });

  it('BR-CNT-08 the student catalog marks subjects without published topics «soon»', async () => {
    const section = await as(student).get(`/api/student/sections/${B.sectionBiology}`).expect(200);
    expect(section.body.subjects).toEqual([
      expect.objectContaining({ id: B.subjectAnatomy, status: 'available' }),
      expect.objectContaining({ id: B.subjectGeneralBiology, status: 'soon' }),
    ]);
  });
});
