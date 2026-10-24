import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

/** Итерация 7: кабинет учителя — предметы, выдача классу, темы, публикация, видимость для ученика, квиз. */
describe('teacher content (integration)', () => {
  let stack: TestStack;
  let teacher: Session;
  let otherTeacher: Session;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => {
    const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) => {
      const req = http()
        [method](path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .set('Accept-Language', 'ru');
      return body === undefined ? req : req.send(body);
    };
    return {
      get: (path: string, locale = 'ru') =>
        http().get(path).set('Cookie', s.cookie).set('Accept-Language', locale),
      post: (path: string, body: object = {}) => send('post', path, body),
      put: (path: string, body: object) => send('put', path, body),
      patch: (path: string, body: object) => send('patch', path, body),
      delete: (path: string) => send('delete', path),
    };
  };

  const subjectBody = (title: string, extra: object = {}) => ({
    translations: { ru: { title, description: 'Описание' } },
    inPublicCatalog: false,
    ...extra,
  });
  const newSubject = async (s: Session, body: object = subjectBody('Предмет')) =>
    (await as(s).post('/api/teacher/subjects', body).expect(201)).body.id as string;
  const newTopic = async (s: Session, subjectId: string, title?: string) => {
    const id = (await as(s).post(`/api/teacher/subjects/${subjectId}/topics`).expect(201)).body.id as string;
    if (title) await as(s).put(`/api/teacher/topics/${id}`, topicBody(title)).expect(204);
    return id;
  };
  const topicBody = (title: string, extra: object = {}) => ({
    translations: {
      ru: { title, description: 'Описание темы', funFact: 'Факт', bodyMd: '## Раздел\n\nТекст' },
    },
    materialIds: [],
    ...extra,
  });

  async function studentInClass(loginName: string): Promise<{ session: Session; classId: string }> {
    const cls = await as(teacher)
      .post('/api/teacher/classes', { name: `Класс ${loginName}` })
      .expect(201);
    const code = await as(teacher).post(`/api/teacher/classes/${cls.body.id}/invite-codes`).expect(201);
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ code: code.body.code, displayName: 'Ученик', login: loginName, password: 'student-pass-1' })
      .expect(201);
    return { session: await login(http, loginName, 'student-pass-1'), classId: cls.body.id };
  }

  const audit = (entityId: string) =>
    stack.db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));

  beforeAll(async () => {
    stack = await startStack('demo');
    teacher = await login(http, ACCOUNTS.teacher);
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({
        role: 'teacher',
        email: 'content.other@example.kz',
        displayName: 'Другой',
        password: 'strong-pass-1',
      })
      .expect(201);
    otherTeacher = await login(http, 'content.other@example.kz', 'strong-pass-1');
  });

  afterAll(() => stack?.stop());

  describe('subjects', () => {
    it('AC-TCH-01, REQ-TCH-SUBJ-01 a subject with only a KK title is created', async () => {
      const id = await newSubject(teacher, {
        translations: { ru: { title: '', description: '' }, kk: { title: 'Биология' }, en: {} },
        inPublicCatalog: false,
      });
      const res = await as(teacher).get(`/api/teacher/subjects/${id}`).expect(200);
      expect(res.body.translations).toEqual({ kk: { title: 'Биология', description: null } });
      // API-T-01: название — на доступном языке, если RU нет.
      const list = await as(teacher).get('/api/teacher/subjects').expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({ id, title: 'Биология', locale: 'kk', topicsCount: 0 }),
      );
    });

    it('REQ-TCH-SUBJ-02 no title in any language → 400 atLeastOneLanguage; text without a title → title required', async () => {
      const empty = await as(teacher)
        .post('/api/teacher/subjects', { translations: { ru: { title: ' ' } }, inPublicCatalog: false })
        .expect(400);
      expect(empty.body.fieldErrors).toEqual({ translations: 'atLeastOneLanguage' });
      const noTitle = await as(teacher)
        .post('/api/teacher/subjects', {
          translations: { kk: { title: 'Атауы' }, ru: { description: 'Только описание' } },
          inPublicCatalog: false,
        })
        .expect(400);
      expect(noTitle.body.fieldErrors).toEqual({ 'translations.ru.title': 'required' });
      // PH-23: длины.
      const long = await as(teacher)
        .post('/api/teacher/subjects', subjectBody('x'.repeat(151)))
        .expect(400);
      expect(long.body.fieldErrors).toEqual({ 'translations.ru.title': 'tooLong' });
    });

    it('API-T-03, REQ-NFR-SEC-05 PATCH replaces translations; the catalog flag change is audited', async () => {
      const id = await newSubject(teacher);
      await as(teacher)
        .patch(`/api/teacher/subjects/${id}`, {
          translations: { en: { title: 'Physics' } },
          inPublicCatalog: true,
        })
        .expect(204);
      const res = await as(teacher).get(`/api/teacher/subjects/${id}`).expect(200);
      expect(res.body).toMatchObject({ translations: { en: { title: 'Physics' } }, inPublicCatalog: true });
      expect(Object.keys(res.body.translations)).toEqual(['en']);
      expect((await audit(id)).map((a) => a.action)).toEqual(['create', 'catalog_flag']);
    });

    it('BR-ACL-01 another teacher gets 404 for the subject and cannot change it', async () => {
      const id = await newSubject(teacher);
      await as(otherTeacher).get(`/api/teacher/subjects/${id}`).expect(404);
      await as(otherTeacher).patch(`/api/teacher/subjects/${id}`, {}).expect(404);
      await as(otherTeacher).post(`/api/teacher/subjects/${id}/topics`).expect(404);
      expect((await as(otherTeacher).get('/api/teacher/subjects').expect(200)).body).toEqual([]);
    });
  });

  describe('access and visibility', () => {
    it('API-T-07, API-T-08, REQ-NFR-SEC-05 granting is idempotent, revoking closes access; both are audited', async () => {
      const subjectId = await newSubject(teacher);
      const { classId } = await studentInClass('access.student');
      await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
      await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(200);
      const rows = await stack.db
        .select()
        .from(schema.classSubjectAccess)
        .where(eq(schema.classSubjectAccess.subjectId, subjectId));
      expect(rows).toHaveLength(1);
      expect((await as(teacher).get(`/api/teacher/subjects/${subjectId}`)).body.grantedClassIds).toEqual([
        classId,
      ]);

      await as(teacher).delete(`/api/teacher/subjects/${subjectId}/access/${classId}`).expect(204);
      expect((await as(teacher).get(`/api/teacher/subjects/${subjectId}`)).body.grantedClassIds).toEqual([]);
      const actions = (await audit(rows[0]!.id)).map((a) => a.action);
      expect(actions).toEqual(['grant', 'revoke']);
      // Повторная выдача после отзыва — новая запись.
      await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
    });

    it('BR-ACL-02 granting to another teacher’s class → 404', async () => {
      const subjectId = await newSubject(teacher);
      const foreign = await as(otherTeacher).post('/api/teacher/classes', { name: 'Чужой' }).expect(201);
      await as(teacher)
        .post(`/api/teacher/subjects/${subjectId}/access`, { classId: foreign.body.id })
        .expect(404);
    });

    it('AC-TCH-03, BR-VIS-01 after granting, a class student sees the subject and only published topics', async () => {
      const subjectId = await newSubject(teacher, subjectBody('Ботаника'));
      const published = await newTopic(teacher, subjectId, 'Растения');
      const draft = await newTopic(teacher, subjectId, 'Животные');
      await as(teacher).post(`/api/teacher/topics/${published}/publish`, {}).expect(200);
      const { session, classId } = await studentInClass('visible.student');
      const outsider = await studentInClass('outsider.student');

      // До выдачи предмет не виден.
      let catalog = await as(session).get('/api/student/catalog').expect(200);
      expect(catalog.body.subjects.map((s: { id: string }) => s.id)).not.toContain(subjectId);
      await as(session).get(`/api/student/topics/${published}`).expect(404);

      await as(teacher).post(`/api/teacher/subjects/${subjectId}/access`, { classId }).expect(201);
      catalog = await as(session).get('/api/student/catalog').expect(200);
      expect(catalog.body.subjects).toContainEqual({
        id: subjectId,
        title: 'Ботаника',
        description: 'Описание',
        status: 'available',
      });
      expect(catalog.body.sections.length).toBeGreaterThan(0);
      expect(catalog.body.sections[0]).toMatchObject({ status: 'section' });

      const lesson = await as(session).get(`/api/student/topics/${published}`).expect(200);
      expect(lesson.body).toMatchObject({
        id: published,
        subject: { id: subjectId, title: 'Ботаника' },
        title: 'Растения',
        number: 1,
        summary: 'Описание темы',
        // «Интересный факт» — в API-S-06 (решение владельца 2026-10-16).
        funFact: 'Факт',
        bodyMd: '## Раздел\n\nТекст',
        next: null,
        locale: 'ru',
      });
      await as(session).get(`/api/student/topics/${draft}`).expect(404);
      // Ученик другого класса предмет не видит (BR-VIS-01).
      await as(outsider.session).get(`/api/student/topics/${published}`).expect(404);
    });

    it('AC-TCH-02, BR-VIS-02 a draft topic in a public-catalog subject → 404 for a student', async () => {
      const subjectId = await newSubject(teacher, subjectBody('Каталожный', { inPublicCatalog: true }));
      const draft = await newTopic(teacher, subjectId, 'Черновая');
      const { session } = await studentInClass('catalog.student');
      const catalog = await as(session).get('/api/student/catalog').expect(200);
      expect(catalog.body.subjects.map((s: { id: string }) => s.id)).toContain(subjectId);
      await as(session).get(`/api/student/topics/${draft}`).expect(404);
    });
  });

  describe('topics', () => {
    it('API-T-09, REQ-TCH-ACC-02 new topics are drafts numbered in order and listed with status', async () => {
      const subjectId = await newSubject(teacher);
      const a = await newTopic(teacher, subjectId);
      const b = await newTopic(teacher, subjectId, 'Вторая');
      const res = await as(teacher).get(`/api/teacher/subjects/${subjectId}`).expect(200);
      expect(res.body.topics).toEqual([
        { id: a, number: 1, title: null, status: 'draft', deletable: true },
        { id: b, number: 2, title: 'Вторая', status: 'draft', deletable: true },
      ]);
    });

    it('API-T-10, REQ-TCH-TOP-06 saving keeps the status and stores all languages', async () => {
      const subjectId = await newSubject(teacher);
      const id = await newTopic(teacher, subjectId);
      await as(teacher)
        .put(`/api/teacher/topics/${id}`, {
          translations: {
            ru: { title: 'Сердце', description: 'Камеры', funFact: 'Клапаны', bodyMd: '## Камеры' },
            kk: { title: 'Жүрек' },
            en: { title: '', description: '' },
          },
          materialIds: [],
        })
        .expect(204);
      const res = await as(teacher).get(`/api/teacher/topics/${id}`).expect(200);
      expect(res.body).toMatchObject({
        status: 'draft',
        number: 1,
        coverUrl: null,
        coverPreviewUrl: null,
        materials: [],
        translations: {
          ru: { title: 'Сердце', description: 'Камеры', funFact: 'Клапаны', bodyMd: '## Камеры' },
          kk: { title: 'Жүрек', description: null, funFact: null, bodyMd: null },
        },
      });
      expect(res.body.translations.en).toBeUndefined();
    });

    it('REQ-TCH-TOP-04 the cover link must be http(s); a foreign file cannot be a cover or material', async () => {
      const id = await newTopic(teacher, await newSubject(teacher), 'Тема');
      const bad = await as(teacher)
        .put(`/api/teacher/topics/${id}`, topicBody('Тема', { coverUrl: 'javascript:alert(1)' }))
        .expect(400);
      expect(bad.body.fieldErrors).toEqual({ coverUrl: 'invalidUrl' });
      const [media] = await stack.db
        .insert(schema.mediaFiles)
        .values({
          ownerId: otherTeacher.userId,
          kind: 'material',
          originalName: 'a.pdf',
          mime: 'application/pdf',
          sizeBytes: 10,
          storageKey: `material/${crypto.randomUUID()}`,
        })
        .returning();
      const foreign = await as(teacher)
        .put(`/api/teacher/topics/${id}`, topicBody('Тема', { materialIds: [media!.id] }))
        .expect(400);
      expect(foreign.body.fieldErrors).toEqual({ materialIds: 'invalidFile' });
      await as(teacher)
        .put(`/api/teacher/topics/${id}`, topicBody('Тема', { coverMediaId: media!.id }))
        .expect(400);
    });

    it('API-T-11, PH-19 in mock mode the AI draft is unavailable (503) and nothing is saved', async () => {
      const id = await newTopic(teacher, await newSubject(teacher), 'Тема');
      const res = await as(teacher)
        .post(`/api/teacher/topics/${id}/ai-draft`, { title: 'Сердце' })
        .expect(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('API-T-12, SM-TOPIC, REQ-NFR-SEC-05 publishing creates versions, sets published_version_id and is audited', async () => {
      const id = await newTopic(teacher, await newSubject(teacher), 'Публикуемая');
      const first = await as(teacher)
        .post(`/api/teacher/topics/${id}/publish`, { changeNote: 'Первая' })
        .expect(200);
      expect(first.body).toMatchObject({ status: 'published', versionNo: 1 });
      const second = await as(teacher).post(`/api/teacher/topics/${id}/publish`, {}).expect(200);
      expect(second.body.versionNo).toBe(2);
      const [topic] = await stack.db.select().from(schema.topics).where(eq(schema.topics.id, id));
      const versions = await as(teacher).get(`/api/teacher/topics/${id}/versions`).expect(200);
      expect(
        versions.body.map((v: { versionNo: number; changeNote: string | null }) => [
          v.versionNo,
          v.changeNote,
        ]),
      ).toEqual([
        [2, null],
        [1, 'Первая'],
      ]);
      expect(topic!.publishedVersionId).toBe(versions.body[0].id);
      expect((await audit(id)).filter((a) => a.action === 'publish')).toHaveLength(2);

      const long = await as(teacher)
        .post(`/api/teacher/topics/${id}/publish`, { changeNote: 'x'.repeat(501) })
        .expect(400);
      expect(long.body.fieldErrors).toEqual({ changeNote: 'tooLong' });
    });

    it('API-T-12 a topic without a title cannot be published', async () => {
      const id = await newTopic(teacher, await newSubject(teacher));
      const res = await as(teacher).post(`/api/teacher/topics/${id}/publish`, {}).expect(400);
      expect(res.body.fieldErrors).toEqual({ translations: 'atLeastOneLanguage' });
    });

    it('REQ-TCH-PUB-05 changes to a published topic are visible to students only after publishing again', async () => {
      const subjectId = await newSubject(teacher, subjectBody('Снимки', { inPublicCatalog: true }));
      const id = await newTopic(teacher, subjectId, 'Версия 1');
      await as(teacher).post(`/api/teacher/topics/${id}/publish`, {}).expect(200);
      const { session } = await studentInClass('snapshot.student');
      await as(teacher).put(`/api/teacher/topics/${id}`, topicBody('Версия 2')).expect(204);
      // Сохранение не меняет статус и снимок.
      expect((await as(teacher).get(`/api/teacher/topics/${id}`)).body.status).toBe('published');
      expect((await as(session).get(`/api/student/topics/${id}`)).body.title).toBe('Версия 1');
      // API-T-15: предпросмотр показывает черновик.
      expect((await as(teacher).get(`/api/teacher/topics/${id}/preview`).expect(200)).body.title).toBe(
        'Версия 2',
      );
      await as(teacher).post(`/api/teacher/topics/${id}/publish`, {}).expect(200);
      expect((await as(session).get(`/api/student/topics/${id}`)).body.title).toBe('Версия 2');
    });

    it('API-T-13, PH-27 unpublish returns the topic to draft; unpublishing a draft → 409', async () => {
      const subjectId = await newSubject(teacher, subjectBody('Снятие', { inPublicCatalog: true }));
      const id = await newTopic(teacher, subjectId, 'Снимаемая');
      const { session } = await studentInClass('unpublish.student');
      await as(teacher).post(`/api/teacher/topics/${id}/unpublish`).expect(409);
      await as(teacher).post(`/api/teacher/topics/${id}/publish`, {}).expect(200);
      await as(session).get(`/api/student/topics/${id}`).expect(200);
      const res = await as(teacher).post(`/api/teacher/topics/${id}/unpublish`).expect(200);
      expect(res.body).toEqual({ status: 'draft', versionNo: null, publishedAt: null });
      await as(session).get(`/api/student/topics/${id}`).expect(404);
      expect((await audit(id)).map((a) => a.action)).toEqual(['publish', 'unpublish']);
    });

    it('REQ-ST-LES-03 the next published topic is linked from the lesson', async () => {
      const subjectId = await newSubject(teacher, subjectBody('Порядок', { inPublicCatalog: true }));
      const t1 = await newTopic(teacher, subjectId, 'Первая');
      await newTopic(teacher, subjectId, 'Черновая');
      const t3 = await newTopic(teacher, subjectId, 'Третья');
      await as(teacher).post(`/api/teacher/topics/${t1}/publish`, {}).expect(200);
      await as(teacher).post(`/api/teacher/topics/${t3}/publish`, {}).expect(200);
      const { session } = await studentInClass('next.student');
      const lesson = await as(session).get(`/api/student/topics/${t1}`).expect(200);
      expect(lesson.body.next).toEqual({ id: t3, title: 'Третья' });
    });

    it('BR-ACL-01 another teacher gets 404 for topic routes', async () => {
      const id = await newTopic(teacher, await newSubject(teacher), 'Своя');
      await as(otherTeacher).get(`/api/teacher/topics/${id}`).expect(404);
      await as(otherTeacher).put(`/api/teacher/topics/${id}`, topicBody('Чужая')).expect(404);
      await as(otherTeacher).post(`/api/teacher/topics/${id}/publish`, {}).expect(404);
      await as(otherTeacher).get(`/api/teacher/topics/${id}/preview`).expect(404);
    });
  });

  describe('quiz', () => {
    let topicId: string;
    const question = (extra: object = {}) => ({
      type: 'single_choice',
      difficulty: 'easy',
      translations: {
        ru: { text: 'Какая камера направляет кровь в аорту?', explanation: 'Левый желудочек' },
      },
      options: [
        { translations: { ru: 'Левый желудочек' }, isCorrect: true },
        { translations: { ru: 'Правое предсердие' }, isCorrect: false },
      ],
      ...extra,
    });
    const count = async () =>
      (await as(teacher).get(`/api/teacher/topics/${topicId}/quiz`).expect(200)).body.questions
        .length as number;

    beforeAll(async () => {
      topicId = await newTopic(teacher, await newSubject(teacher), 'Квиз');
    });

    it('AC-TCH-07, BR-QZ-02 two correct options or a single option → 400 and no question is created', async () => {
      const before = await count();
      const twoCorrect = await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          ...question(),
          options: [
            { translations: { ru: 'А' }, isCorrect: true },
            { translations: { ru: 'Б' }, isCorrect: true },
          ],
        })
        .expect(400);
      expect(twoCorrect.body.fieldErrors).toEqual({ options: 'exactlyOneCorrect' });
      const single = await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          ...question(),
          options: [{ translations: { ru: 'А' }, isCorrect: true }],
        })
        .expect(400);
      expect(single.body.fieldErrors).toEqual({ options: 'min2' });
      const nine = await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          ...question(),
          options: Array.from({ length: 9 }, (_, i) => ({
            translations: { ru: `В${i}` },
            isCorrect: i === 0,
          })),
        })
        .expect(400);
      expect(nine.body.fieldErrors).toEqual({ options: 'max8' });
      expect(await count()).toBe(before);
    });

    it('API-T-20, API-T-19, REQ-TCH-QZ-03 a question is created; correctness is stored in the option', async () => {
      const created = await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, question())
        .expect(201);
      const quiz = await as(teacher).get(`/api/teacher/topics/${topicId}/quiz`).expect(200);
      const q = quiz.body.questions.find((x: { id: string }) => x.id === created.body.id);
      expect(q).toMatchObject({
        type: 'single_choice',
        difficulty: 'easy',
        textAnswer: null,
        translations: {
          ru: { text: 'Какая камера направляет кровь в аорту?', explanation: 'Левый желудочек' },
        },
        options: [
          { isCorrect: true, translations: { ru: 'Левый желудочек' } },
          { isCorrect: false, translations: { ru: 'Правое предсердие' } },
        ],
      });
    });

    it('BR-QZ-02, PH-28 true/false gets the fixed «Верно» / «Неверно» options in every language', async () => {
      const created = await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          type: 'true_false',
          difficulty: 'medium',
          translations: { kk: { text: 'Жүрек — бұлшықет' } },
          options: [
            { translations: {}, isCorrect: true },
            { translations: {}, isCorrect: false },
          ],
        })
        .expect(201);
      const quiz = await as(teacher).get(`/api/teacher/topics/${topicId}/quiz`).expect(200);
      const q = quiz.body.questions.find((x: { id: string }) => x.id === created.body.id);
      expect(q.options).toEqual([
        { id: expect.any(String), isCorrect: true, translations: { ru: 'Верно', kk: 'Дұрыс', en: 'True' } },
        {
          id: expect.any(String),
          isCorrect: false,
          translations: { ru: 'Неверно', kk: 'Бұрыс', en: 'False' },
        },
      ]);
    });

    it('REQ-TCH-QZ-02 text input requires the correct answer', async () => {
      const missing = await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          type: 'text_input',
          difficulty: 'hard',
          translations: { ru: { text: 'Сколько камер у сердца?' } },
        })
        .expect(400);
      expect(missing.body.fieldErrors).toEqual({ textAnswer: 'required' });
      await as(teacher)
        .post(`/api/teacher/topics/${topicId}/quiz/questions`, {
          type: 'text_input',
          difficulty: 'hard',
          translations: { ru: { text: 'Сколько камер у сердца?' } },
          textAnswer: ' четыре ',
        })
        .expect(201);
    });

    it('API-T-21, REQ-TCH-QZ-04 a question is edited in place and archived; archived ones leave the list', async () => {
      const id = (
        await as(teacher).post(`/api/teacher/topics/${topicId}/quiz/questions`, question()).expect(201)
      ).body.id as string;
      const edited = await as(teacher)
        .put(`/api/teacher/questions/${id}`, {
          ...question(),
          difficulty: 'hard',
          options: [
            { translations: { ru: 'А' }, isCorrect: false },
            { translations: { ru: 'Б' }, isCorrect: false },
            { translations: { ru: 'В' }, isCorrect: true },
          ],
        })
        .expect(200);
      expect(edited.body.id).toBe(id);
      let quiz = await as(teacher).get(`/api/teacher/topics/${topicId}/quiz`).expect(200);
      const q = quiz.body.questions.find((x: { id: string }) => x.id === id);
      expect(q.difficulty).toBe('hard');
      expect(q.options.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual([false, false, true]);

      await as(otherTeacher).delete(`/api/teacher/questions/${id}`).expect(404);
      await as(teacher).delete(`/api/teacher/questions/${id}`).expect(204);
      quiz = await as(teacher).get(`/api/teacher/topics/${topicId}/quiz`).expect(200);
      expect(quiz.body.questions.map((x: { id: string }) => x.id)).not.toContain(id);
      await as(teacher).put(`/api/teacher/questions/${id}`, question()).expect(404);
      const [row] = await stack.db
        .select()
        .from(schema.questions)
        .where(and(eq(schema.questions.id, id)));
      expect(row!.archivedAt).not.toBeNull();
      // Номера в списке идут подряд.
      expect(quiz.body.questions.map((x: { number: number }) => x.number)).toEqual(
        quiz.body.questions.map((_: unknown, i: number) => i + 1),
      );
    });
  });
});
