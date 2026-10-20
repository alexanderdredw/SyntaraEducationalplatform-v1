import request from 'supertest';
import { eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import kk from '@syntara/shared/i18n/kk.json';
import ru from '@syntara/shared/i18n/ru.json';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const { battleQuestions, questionTranslations, mediaFiles } = schema;

/**
 * Итерация 10.5, этап B1 — Battle-тесты учителя (SPEC 6.8 API-BTL-01…11, BR-BTL-10, BR-BTL-12, AC-BTL-01):
 * создание, правка, вопросы и их проверка, порядок, архив, дубль, импорт из квиза темы (копии), права.
 */
describe('Battle tests (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  let teacher: Session;
  let other: Session;
  let student: Session;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie).set('Accept-Language', 'ru'),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('Accept-Language', 'ru')
        .send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf),
  });

  const choice = (text: string, correct = 0, n = 2, timeLimitSec = 20) => ({
    type: 'single_choice',
    text,
    timeLimitSec,
    options: Array.from({ length: n }, (_, i) => ({ text: `${text}.${i}`, isCorrect: i === correct })),
  });
  const newBattle = async (title = 'Сердце', locale = 'ru') =>
    (await as(teacher).post('/api/teacher/battles', { title, locale }).expect(201)).body.id as string;

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({
        role: 'teacher',
        email: 'battle.other@example.kz',
        displayName: 'Другой',
        password: 'strong-pass-1',
      })
      .expect(201);
    other = await login(http, 'battle.other@example.kz', 'strong-pass-1');
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: 'Асель Каримова', login: 'battle.asel', password: 'student-pass-1' })
      .expect(201);
    student = await login(http, 'battle.asel', 'student-pass-1');
  });

  afterAll(() => stack?.stop());

  it('API-BTL-01..04 create, read, edit and archive a Battle test', async () => {
    const id = await newBattle('Кровообращение');
    await as(teacher).patch(`/api/teacher/battles/${id}`, { description: 'Для 8 класса' }).expect(204);
    const got = await as(teacher).get(`/api/teacher/battles/${id}`).expect(200);
    expect(got.body).toMatchObject({
      id,
      title: 'Кровообращение',
      description: 'Для 8 класса',
      locale: 'ru',
      archived: false,
      gamesCount: 0,
      questions: [],
    });
    const list = await as(teacher).get('/api/teacher/battles').expect(200);
    expect(list.body.find((b: { id: string }) => b.id === id)).toMatchObject({
      questionsCount: 0,
      gamesCount: 0,
      lastPlayedAt: null,
      archived: false,
    });
    await as(teacher).patch(`/api/teacher/battles/${id}`, { archived: true }).expect(204);
    expect(
      (await as(teacher).get('/api/teacher/battles').expect(200)).body.map((b: { id: string }) => b.id),
    ).not.toContain(id);
    const archived = await as(teacher).get('/api/teacher/battles?archived=true').expect(200);
    expect(archived.body.map((b: { id: string }) => b.id)).toContain(id);
    await as(teacher).patch(`/api/teacher/battles/${id}`, { archived: false }).expect(204);
    // BR-BTL-10: длина названия.
    await as(teacher)
      .post('/api/teacher/battles', { title: 'x'.repeat(121), locale: 'ru' })
      .expect(400);
    await as(teacher).post('/api/teacher/battles', { title: '', locale: 'ru' }).expect(400);
  });

  it('API-BTL-06, BR-BTL-10 questions: 2–4 options, exactly one correct, allowed time limits; true_false texts by test language', async () => {
    const id = await newBattle('Типы', 'kk');
    await as(teacher)
      .post(`/api/teacher/battles/${id}/questions`, choice('Q1', 1, 4, 30))
      .expect(201);
    await as(teacher)
      .post(`/api/teacher/battles/${id}/questions`, {
        type: 'true_false',
        text: 'Q2',
        timeLimitSec: 10,
        options: [
          { text: '', isCorrect: false },
          { text: '', isCorrect: true },
        ],
      })
      .expect(201);
    for (const bad of [choice('one', 0, 1), choice('five', 0, 5), choice('time', 0, 2, 15)]) {
      await as(teacher).post(`/api/teacher/battles/${id}/questions`, bad).expect(400);
    }
    const twoCorrect = choice('two');
    twoCorrect.options[1]!.isCorrect = true;
    const res = await as(teacher).post(`/api/teacher/battles/${id}/questions`, twoCorrect).expect(400);
    expect(res.body.fieldErrors.options).toBe('exactlyOneCorrect');
    await as(teacher)
      .post(`/api/teacher/battles/${id}/questions`, { ...choice('T'), type: 'text_input' })
      .expect(400);

    const got = (await as(teacher).get(`/api/teacher/battles/${id}`).expect(200)).body;
    expect(got.questions).toHaveLength(2);
    expect(got.questions[0]).toMatchObject({
      number: 1,
      type: 'single_choice',
      timeLimitSec: 30,
      imported: false,
    });
    expect(got.questions[0].options.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    // «Верно» / «Неверно» на языке теста (KK); при смене языка — переписываются.
    expect(got.questions[1].options.map((o: { text: string }) => o.text)).toEqual([
      kk.teacher.quiz.optionTrue,
      kk.teacher.quiz.optionFalse,
    ]);
    await as(teacher).patch(`/api/teacher/battles/${id}`, { locale: 'ru' }).expect(204);
    const ruBattle = (await as(teacher).get(`/api/teacher/battles/${id}`).expect(200)).body;
    expect(ruBattle.questions[1].options.map((o: { text: string }) => o.text)).toEqual([
      ru.teacher.quiz.optionTrue,
      ru.teacher.quiz.optionFalse,
    ]);
  });

  it('API-BTL-07..09 edit, reorder and archive questions', async () => {
    const id = await newBattle('Порядок');
    const q = [];
    for (const t of ['A', 'B', 'C']) {
      q.push(
        (await as(teacher).post(`/api/teacher/battles/${id}/questions`, choice(t)).expect(201)).body
          .id as string,
      );
    }
    await as(teacher)
      .patch(`/api/teacher/battles/${id}/questions/${q[1]}`, choice('B2', 2, 3, 60))
      .expect(204);
    await as(teacher).delete(`/api/teacher/battles/${id}/questions/${q[0]}`).expect(204);
    // Нужны все неархивные вопросы — иначе 422.
    const bad = await as(teacher)
      .post(`/api/teacher/battles/${id}/questions/reorder`, { questionIds: [q[2]] })
      .expect(422);
    expect(bad.body.fieldErrors.questionIds).toBe('invalidOrder');
    await as(teacher)
      .post(`/api/teacher/battles/${id}/questions/reorder`, { questionIds: [q[0], q[2], q[1]] })
      .expect(422);
    await as(teacher)
      .post(`/api/teacher/battles/${id}/questions/reorder`, { questionIds: [q[2], q[1]] })
      .expect(204);
    const got = (await as(teacher).get(`/api/teacher/battles/${id}`).expect(200)).body;
    expect(got.questions.map((x: { text: string; number: number }) => [x.number, x.text])).toEqual([
      [1, 'C'],
      [2, 'B2'],
    ]);
    expect(got.questions[1]).toMatchObject({ timeLimitSec: 60 });
    expect(got.questions[1].options).toHaveLength(3);
    // Архивный вопрос не редактируется; вопрос другого теста — 404.
    await as(teacher).patch(`/api/teacher/battles/${id}/questions/${q[0]}`, choice('X')).expect(404);
    const otherBattle = await newBattle('Другой');
    await as(teacher).patch(`/api/teacher/battles/${otherBattle}/questions/${q[1]}`, choice('X')).expect(404);
  });

  it('BR-BTL-10 a test holds at most 50 questions', async () => {
    const id = await newBattle('Пятьдесят');
    for (let i = 1; i <= 50; i++) {
      await as(teacher)
        .post(`/api/teacher/battles/${id}/questions`, choice(`Q${i}`))
        .expect(201);
    }
    const res = await as(teacher).post(`/api/teacher/battles/${id}/questions`, choice('Q51')).expect(422);
    expect(res.body.fieldErrors.questions).toBe('tooManyQuestions');
  });

  it('API-BTL-05 duplicate copies the questions; editing the copy keeps the original', async () => {
    const id = await newBattle('Оригинал');
    const qid = (await as(teacher).post(`/api/teacher/battles/${id}/questions`, choice('Q')).expect(201)).body
      .id;
    await as(teacher).post(`/api/teacher/battles/${id}/questions`, choice('R', 1)).expect(201);
    const copy = (await as(teacher).post(`/api/teacher/battles/${id}/duplicate`).expect(201)).body
      .id as string;
    expect(copy).not.toBe(id);
    const copied = (await as(teacher).get(`/api/teacher/battles/${copy}`).expect(200)).body;
    expect(copied.questions.map((q: { text: string }) => q.text)).toEqual(['Q', 'R']);
    await as(teacher)
      .patch(`/api/teacher/battles/${copy}/questions/${copied.questions[0].id}`, choice('Q!'))
      .expect(204);
    const original = (await as(teacher).get(`/api/teacher/battles/${id}`).expect(200)).body;
    expect(original.questions[0]).toMatchObject({ id: qid, text: 'Q' });
  });

  it('AC-BTL-01, API-BTL-10/11 import copies quiz questions of a base topic; the source quiz is unchanged', async () => {
    const id = await newBattle('Импорт');
    for (const t of ['Свой 1', 'Свой 2', 'Свой 3']) {
      await as(teacher).post(`/api/teacher/battles/${id}/questions`, choice(t)).expect(201);
    }
    const sources = (await as(teacher).get('/api/teacher/battles/import-sources').expect(200)).body;
    const anatomy = sources.find((s: { subjectId: string }) => s.subjectId === B.subjectAnatomy);
    expect(anatomy).toMatchObject({ official: true, subjectTitle: 'Анатомия человека' });
    const cardio = anatomy.topics.find((t: { id: string }) => t.id === B.topicCardio);
    expect(cardio.eligibleCount).toBeGreaterThanOrEqual(2);
    expect(cardio.questions).toHaveLength(cardio.eligibleCount);
    // Вписанный ответ в Battle не поддерживается — такие вопросы не предлагаются.
    expect(
      cardio.questions.every((q: { type: string }) => ['single_choice', 'true_false'].includes(q.type)),
    ).toBe(true);

    const picked = cardio.questions.slice(0, 2).map((q: { id: string }) => q.id);
    const imported = await as(teacher)
      .post(`/api/teacher/battles/${id}/import`, { topicId: B.topicCardio, questionIds: picked })
      .expect(200);
    expect(imported.body).toEqual({ imported: 2 });
    const got = (await as(teacher).get(`/api/teacher/battles/${id}`).expect(200)).body;
    expect(got.questions).toHaveLength(5);
    expect(got.questions.filter((q: { imported: boolean }) => q.imported)).toHaveLength(2);
    expect(got.questions[3]).toMatchObject({ text: cardio.questions[0].text, timeLimitSec: 20 });
    const rows = await stack.db
      .select()
      .from(battleQuestions)
      .where(eq(battleQuestions.sourceQuestionId, picked[0]));
    expect(rows).toHaveLength(1);

    // Правка копии не меняет исходный квиз.
    await as(teacher)
      .patch(`/api/teacher/battles/${id}/questions/${got.questions[3].id}`, choice('Изменено'))
      .expect(204);
    const [source] = await stack.db
      .select()
      .from(questionTranslations)
      .where(eq(questionTranslations.questionId, picked[0]));
    expect(source!.text).toBe(cardio.questions[0].text);

    // Вопрос не из этой темы — 422; тема чужого учителя — 404.
    await as(teacher)
      .post(`/api/teacher/battles/${id}/import`, { topicId: B.topicCardio, questionIds: [id] })
      .expect(422);
    const foreignSubject = (
      await as(other)
        .post('/api/teacher/subjects', { translations: { ru: { title: 'Чужой' } }, inPublicCatalog: false })
        .expect(201)
    ).body.id;
    const foreignTopic = (await as(other).post(`/api/teacher/subjects/${foreignSubject}/topics`).expect(201))
      .body.id;
    await as(teacher).post(`/api/teacher/battles/${id}/import`, { topicId: foreignTopic }).expect(404);
    expect(
      (await as(teacher).get('/api/teacher/battles/import-sources').expect(200)).body.some(
        (s: { subjectId: string }) => s.subjectId === foreignSubject,
      ),
    ).toBe(false);
  });

  it('BR-BTL-10 a question image must be a cover from the teacher’s own gallery', async () => {
    const id = await newBattle('Картинки');
    const [foreignMedia] = await stack.db
      .insert(mediaFiles)
      .values({
        ownerId: other.userId,
        kind: 'cover',
        originalName: 'x.png',
        mime: 'image/png',
        sizeBytes: 10,
        storageKey: `test/${other.userId}/x.png`,
        scanStatus: 'clean',
      })
      .returning({ id: mediaFiles.id });
    const res = await as(teacher)
      .post(`/api/teacher/battles/${id}/questions`, { ...choice('Img'), imageMediaId: foreignMedia!.id })
      .expect(422);
    expect(res.body.fieldErrors.imageMediaId).toBe('invalidFile');
  });

  it('BR-BTL-12 only the owner sees and changes a test: other teacher → 404, student → 403, guest → 401', async () => {
    const id = await newBattle('Мой');
    const qid = (await as(teacher).post(`/api/teacher/battles/${id}/questions`, choice('Q')).expect(201)).body
      .id;
    await as(other).get(`/api/teacher/battles/${id}`).expect(404);
    await as(other).patch(`/api/teacher/battles/${id}`, { title: 'Взлом' }).expect(404);
    await as(other).post(`/api/teacher/battles/${id}/questions`, choice('X')).expect(404);
    await as(other).patch(`/api/teacher/battles/${id}/questions/${qid}`, choice('X')).expect(404);
    await as(other).delete(`/api/teacher/battles/${id}/questions/${qid}`).expect(404);
    await as(other).post(`/api/teacher/battles/${id}/duplicate`).expect(404);
    await as(other).post(`/api/teacher/battles/${id}/import`, { topicId: B.topicCardio }).expect(404);
    expect(
      (await as(other).get('/api/teacher/battles').expect(200)).body.map((b: { id: string }) => b.id),
    ).not.toContain(id);
    await as(student).get(`/api/teacher/battles/${id}`).expect(403);
    await http().get(`/api/teacher/battles/${id}`).expect(401);
    // Без CSRF-заголовка изменение отклоняется (API-GEN-02).
    await http()
      .patch(`/api/teacher/battles/${id}`)
      .set('Cookie', teacher.cookie)
      .send({ title: 'X' })
      .expect(403);
    expect((await as(teacher).get(`/api/teacher/battles/${id}`).expect(200)).body.title).toBe('Мой');
  });
});
