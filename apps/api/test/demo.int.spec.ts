import request from 'supertest';
import { and, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { startStack, type TestStack } from './support/stack';

describe('demo question (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  const http = () => request(stack.app.getHttpServer());

  /** Число строк во всех таблицах — проверка, что пробный ответ ничего не записал (BR-QZ-09). */
  async function rowCounts(): Promise<Record<string, number>> {
    const tables = await stack.db.execute<{ t: string }>(
      sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const counts: Record<string, number> = {};
    for (const { t } of tables) {
      const [row] = await stack.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${t}"`));
      counts[t] = row!.n;
    }
    return counts;
  }

  beforeAll(async () => {
    stack = await startStack('demo');
    B = await baseIds(stack.db);
  });

  afterAll(() => stack?.stop());

  it('AC-PUB-04, API-PUB-02, BR-QZ-01 returns the demo question without the correct answer', async () => {
    const res = await http().get('/api/public/demo-question').expect(200);
    expect(res.body).toEqual({
      id: B.demoQuestion,
      subjectId: B.subjectAnatomy,
      version: expect.stringMatching(/^[0-9a-f]{16}$/),
      text: 'Какой сосуд несёт кровь от сердца к телу?',
      options: [
        { id: expect.any(String), text: 'Аорта' },
        { id: expect.any(String), text: 'Полая вена' },
        { id: expect.any(String), text: 'Капилляр' },
        { id: expect.any(String), text: 'Лимфатический сосуд' },
      ],
      hasAnother: false,
      locale: 'ru',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/isCorrect|is_correct|correct|explanation/i);
  });

  it('API-GEN-03 serves the requested language', async () => {
    const res = await http().get('/api/public/demo-question').set('Accept-Language', 'kk').expect(200);
    expect(res.body).toMatchObject({
      locale: 'kk',
      text: 'Қай қан тамыры қанды жүректен денеге тасымалдайды?',
    });
    expect(res.body.options[0].text).toBe('Қолқа');
  });

  it('AC-PUB-05, API-PUB-03, BR-QZ-09 wrong answer → correct=false, correct option and explanation; nothing is written', async () => {
    const question = (await http().get('/api/public/demo-question').expect(200)).body;
    const before = await rowCounts();
    const wrong = await http()
      .post('/api/public/demo-answer')
      .send({ questionId: question.id, version: question.version, optionId: question.options[1].id })
      .expect(200);
    expect(wrong.body).toEqual({
      correct: false,
      correctOptionId: question.options[0].id,
      explanation: 'Аорта — главная артерия: по ней кровь из левого желудочка идёт ко всем органам тела.',
      locale: 'ru',
    });
    const right = await http()
      .post('/api/public/demo-answer')
      .send({ questionId: question.id, version: question.version, optionId: question.options[0].id })
      .expect(200);
    expect(right.body.correct).toBe(true);
    expect(await rowCounts()).toEqual(before);
  });

  it('API-PUB-03 a changed question (other version) → 409; unknown question or foreign option → 404', async () => {
    const question = (await http().get('/api/public/demo-question').expect(200)).body;
    const stale = await http()
      .post('/api/public/demo-answer')
      .send({ questionId: question.id, version: '0000000000000000', optionId: question.options[0].id })
      .expect(409);
    expect(stale.body.code).toBe('CONFLICT');
    await http()
      .post('/api/public/demo-answer')
      .send({
        questionId: '0190a1b2-0000-7000-8000-000000000000',
        version: question.version,
        optionId: question.options[0].id,
      })
      .expect(404);
    const [foreign] = await stack.db
      .select({ id: schema.answerOptions.id })
      .from(schema.answerOptions)
      .where(ne(schema.answerOptions.questionId, question.id))
      .limit(1);
    await http()
      .post('/api/public/demo-answer')
      .send({ questionId: question.id, version: question.version, optionId: foreign!.id })
      .expect(404);
    await http().post('/api/public/demo-answer').send({ questionId: question.id }).expect(400);
  });

  it('API-PUB-03 a non-demo question cannot be checked through the demo endpoint', async () => {
    const [other] = await stack.db
      .select({ id: schema.questions.id })
      .from(schema.questions)
      .where(and(eq(schema.questions.isDemo, false), eq(schema.questions.type, 'single_choice')))
      .limit(1);
    const [option] = await stack.db
      .select({ id: schema.answerOptions.id })
      .from(schema.answerOptions)
      .where(eq(schema.answerOptions.questionId, other!.id));
    await http()
      .post('/api/public/demo-answer')
      .send({ questionId: other!.id, version: 'x', optionId: option!.id })
      .expect(404);
  });

  it('SM-DEMO «Другой вопрос»: with several demo questions `exclude` gives another one', async () => {
    const [second] = await stack.db
      .select({ id: schema.questions.id })
      .from(schema.questions)
      .where(and(eq(schema.questions.quizId, B.quizCardio), eq(schema.questions.isDemo, false)))
      .limit(1);
    await stack.db.update(schema.questions).set({ isDemo: true }).where(eq(schema.questions.id, second!.id));
    try {
      for (let i = 0; i < 5; i++) {
        const res = await http().get(`/api/public/demo-question?exclude=${B.demoQuestion}`).expect(200);
        expect(res.body).toMatchObject({ id: second!.id, hasAnother: true });
      }
    } finally {
      await stack.db
        .update(schema.questions)
        .set({ isDemo: false })
        .where(eq(schema.questions.id, second!.id));
    }
    // Единственный вопрос отдаётся и при exclude — кнопка «Другой вопрос» при этом скрыта (hasAnother = false).
    const only = await http().get(`/api/public/demo-question?exclude=${B.demoQuestion}`).expect(200);
    expect(only.body).toMatchObject({ id: B.demoQuestion, hasAnother: false });
  });

  it('BR-VIS-02 a demo question of an unpublished topic is not shown', async () => {
    await stack.db.update(schema.topics).set({ status: 'draft' }).where(eq(schema.topics.id, B.topicCardio));
    try {
      await http().get('/api/public/demo-question').expect(404);
    } finally {
      await stack.db
        .update(schema.topics)
        .set({ status: 'published' })
        .where(eq(schema.topics.id, B.topicCardio));
    }
  });

  it('API-GEN-01 OpenAPI documents API-PUB-02 and API-PUB-03', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/public/demo-question']?.get).toBeDefined();
    expect(doc.paths['/api/public/demo-answer']?.post).toBeDefined();
  });
});
