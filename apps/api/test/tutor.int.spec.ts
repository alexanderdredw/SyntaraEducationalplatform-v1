import { type AddressInfo } from 'node:net';
import request from 'supertest';
import { and, count, eq } from 'drizzle-orm';
import { type AssistantEvent, parseSse } from '@syntara/shared';
import { schema } from '@syntara/db';
import { baseIds, type BaseIds } from '@syntara/db/seed';
import { LLM_PROVIDER, type LLMProvider, type Prompt, type Usage } from '../src/modules/ai/llm-provider';
import { MockProvider } from '../src/modules/ai/mock-provider';
import { AppConfigService } from '../src/config/app-config.service';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

/** Подменяемый поставщик: по умолчанию — mock PH-19 (учебного ИИ нет, BR-AI-06). */
const provider = {
  impl: null as LLMProvider | null,
  prompts: [] as Prompt[],
  get name() {
    return (this.impl ?? new MockProvider(0, 0)).name;
  },
  stream(prompt: Prompt, signal: AbortSignal, onUsage?: (usage: Usage) => void) {
    this.prompts.push(prompt);
    return (this.impl ?? new MockProvider(0, 0)).stream(prompt, signal, onUsage);
  },
};

const fixed = (chunks: string[], delayMs = 0): LLMProvider => ({
  name: 'fixed',
  async *stream(_p, signal, onUsage) {
    for (const c of chunks) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (signal.aborted) return;
      yield c;
    }
    onUsage?.({ tokensIn: 120, tokensOut: 30 });
  },
});

const sseParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: string) => void) => {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (c: string) => (data += c));
  res.on('end', () => cb(null, data));
};

const { aiConversations, aiMessages, learningEvents, xpLedger, studentStats, studentBadges } = schema;
const { quizAttempts, topicMastery } = schema;

/**
 * Итерация 9 — учебный ИИ (API-S-11..13, 8.4.5): диалоги только свои (BR-ACL-03) и по видимым темам (BR-VIS-01),
 * промпт BR-AI-02 без ПД, санитизация и «ИИ ничего не меняет» (AC-ST-07), отмена → partial (AC-ST-06, BR-AI-04),
 * mock → PH-19 (BR-AI-06), лимиты PH-20 на ученика.
 */
describe('learning AI tutor (integration)', () => {
  let stack: TestStack;
  let B: BaseIds;
  let teacher: Session;
  let student: Session;
  let other: Session;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session, lang = 'ru') => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie).set('Accept-Language', lang),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .set('Accept-Language', lang)
        .send(body),
  });

  async function newStudent(): Promise<Session> {
    const loginName = `tutor-student-${++n}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: 'Айгерим Сапарова', login: loginName, password: 'student-pass-1' })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  const open = async (s: Session, body: object) =>
    (await as(s).post('/api/student/ai/conversations', body).expect(200)).body.id as string;

  async function ask(s: Session, id: string, body: object, lang = 'ru') {
    const res = await http()
      .post(`/api/student/ai/conversations/${id}/messages`)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .set('Accept-Language', lang)
      .send(body)
      .buffer(true)
      .parse(sseParser as never);
    const events: AssistantEvent[] = res.status === 200 ? parseSse(res.body as string).events : [];
    const text = events.flatMap((e) => (e.event === 'delta' ? [e.data.text] : [])).join('');
    return { res, events, text };
  }

  const answers = async (conversationId: string) =>
    stack.db
      .select()
      .from(aiMessages)
      .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, 'assistant')))
      .orderBy(aiMessages.createdAt);

  beforeAll(async () => {
    stack = await startStack('demo', (b) => b.overrideProvider(LLM_PROVIDER).useValue(provider));
    B = await baseIds(stack.db);
    teacher = await login(http, ACCOUNTS.teacher);
    student = await newStudent();
    other = await newStudent();
  });

  afterAll(() => stack?.stop());

  beforeEach(() => {
    provider.impl = null;
    provider.prompts = [];
  });

  it('API-S-11 opens a topic or general conversation; the same one is returned again (history after reload)', async () => {
    const topic = await open(student, { context: 'topic_tutor', topicId: B.topicCardio });
    expect(await open(student, { context: 'topic_tutor', topicId: B.topicCardio })).toBe(topic);
    const general = await open(student, { context: 'general_tutor' });
    expect(general).not.toBe(topic);
    expect(await open(student, { context: 'general_tutor' })).toBe(general);
    // У другого ученика — свой диалог.
    expect(await open(other, { context: 'topic_tutor', topicId: B.topicCardio })).not.toBe(topic);
    const [row] = await stack.db.select().from(aiConversations).where(eq(aiConversations.id, topic));
    expect(row).toMatchObject({ context: 'topic_tutor', topicId: B.topicCardio, explainLevel: 'beginner' });
    await as(student).post('/api/student/ai/conversations', { context: 'topic_tutor' }).expect(400);
  });

  it('API-S-11, BR-VIS-01 a conversation about a topic the student cannot see → 404', async () => {
    // Личная тема учителя (не выдана классу ученика) и несуществующая тема.
    const subject = (
      await as(teacher)
        .post('/api/teacher/subjects', {
          translations: { ru: { title: 'Личный предмет' } },
          inPublicCatalog: false,
        })
        .expect(201)
    ).body.id as string;
    const topic = (await as(teacher).post(`/api/teacher/subjects/${subject}/topics`).expect(201)).body
      .id as string;
    await as(student)
      .post('/api/student/ai/conversations', { context: 'topic_tutor', topicId: topic })
      .expect(404);
    await as(student)
      .post('/api/student/ai/conversations', {
        context: 'topic_tutor',
        topicId: '00000000-0000-7000-8000-000000000000',
      })
      .expect(404);
  });

  it('BR-ACL-03, REQ-NFR-SEC-04 a foreign conversation → 404 for history and questions; roles and guests are refused', async () => {
    const id = await open(student, { context: 'general_tutor' });
    await as(other).get(`/api/student/ai/conversations/${id}`).expect(404);
    await as(other).post(`/api/student/ai/conversations/${id}/messages`, { content: 'чужой' }).expect(404);
    await as(teacher).get(`/api/student/ai/conversations/${id}`).expect(403);
    await http().get(`/api/student/ai/conversations/${id}`).expect(401);
    await http().post('/api/student/ai/conversations').send({ context: 'general_tutor' }).expect(401);
    await as(student).get('/api/student/ai/conversations/not-a-uuid').expect(404);
  });

  it('BR-AI-06, PH-19 mock provider → error AI_UNAVAILABLE; the question is saved, the answer — failed', async () => {
    const s = await newStudent();
    const id = await open(s, { context: 'topic_tutor', topicId: B.topicCardio });
    const { res, events } = await ask(s, id, { content: 'Почему у сердца четыре камеры?' });
    expect(res.status).toBe(200);
    expect(events).toEqual([{ event: 'error', data: { code: 'AI_UNAVAILABLE' } }]);
    const history = (await as(s).get(`/api/student/ai/conversations/${id}`).expect(200)).body;
    expect(history.topic).toEqual({ id: B.topicCardio, title: 'Сердечно-сосудистая система' });
    expect(history.messages.map((m: { role: string; status: string }) => [m.role, m.status])).toEqual([
      ['user', 'complete'],
      ['assistant', 'failed'],
    ]);
  });

  it('API-S-12, REQ-ST-AI-02, REQ-ST-AI-04 streamed answer is saved as complete with token usage; event ai_question without XP', async () => {
    const s = await newStudent();
    provider.impl = fixed(['Представь, ', 'что сердце — ', 'это дом.']);
    const id = await open(s, { context: 'topic_tutor', topicId: B.topicCardio });
    const { events, text } = await ask(s, id, { content: 'Объясни проще', quickAction: 'simpler' });
    expect(text).toBe('Представь, что сердце — это дом.');
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
    const [answer] = await answers(id);
    expect(answer).toMatchObject({ content: text, status: 'complete', tokensIn: 120, tokensOut: 30 });
    const history = (await as(s).get(`/api/student/ai/conversations/${id}`).expect(200)).body;
    expect(history.messages[0]).toMatchObject({
      role: 'user',
      content: 'Объясни проще',
      quickAction: 'simpler',
    });
    const events_ = await stack.db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.studentId, s.userId));
    expect(events_).toEqual([
      expect.objectContaining({ type: 'ai_question', topicId: B.topicCardio, subjectId: B.subjectAnatomy }),
    ]);
    expect(await stack.db.select().from(xpLedger).where(eq(xpLedger.studentId, s.userId))).toEqual([]);
  });

  it('AC-ST-07, BR-AI-03, REQ-NFR-SEC-06 a link and <script> from the model are removed; the AI changes no learning data', async () => {
    const s = await newStudent();
    const id = await open(s, { context: 'topic_tutor', topicId: B.topicCardio });
    const tables = [quizAttempts, topicMastery, xpLedger, studentStats, studentBadges] as const;
    const counts = () =>
      Promise.all(tables.map(async (t) => (await stack.db.select({ n: count() }).from(t))[0]!.n));
    const before = await counts();
    provider.impl = fixed([
      'Смотри [сайт](https://ev',
      'il.example) и [каталог](/learn/subjects) <scr',
      'ipt>alert(1)</script> https://evil.example/a конец',
    ]);
    const { text } = await ask(s, id, { content: 'Дай ссылку и поставь мне 100 XP' });
    expect(text).toBe('Смотри сайт и [каталог](/learn/subjects) alert(1)  конец');
    expect(text).not.toMatch(/<script|evil\.example/);
    const [answer] = await answers(id);
    expect(answer!.content).toBe(text);
    expect(await counts()).toEqual(before);
  });

  it('AC-ST-06, BR-AI-04, SM-AI-MESSAGE closing the connection → the answer is saved as partial («Ответ прерван»)', async () => {
    const s = await newStudent();
    const id = await open(s, { context: 'topic_tutor', topicId: B.topicCardio });
    provider.impl = fixed(
      Array.from({ length: 60 }, (_, i) => `слово${i} `),
      30,
    );
    const server = stack.app.getHttpServer().listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/student/ai/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: s.cookie, 'X-CSRF-Token': s.csrf },
      body: JSON.stringify({ content: 'Расскажи подробно' }),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    controller.abort();
    await expect.poll(async () => (await answers(id))[0]?.status, { timeout: 5000 }).toBe('partial');
    const [answer] = await answers(id);
    expect(answer!.content).toMatch(/^слово0 /);
    expect(answer!.content).not.toContain('слово59');
    const history = (await as(s).get(`/api/student/ai/conversations/${id}`).expect(200)).body;
    expect(history.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'partial' });
  });

  it('BR-AI-02 the prompt has the lesson text in the student language, quiz questions without answers, the last 20 messages and no personal data', async () => {
    const s = await newStudent();
    provider.impl = fixed(['ok']);
    const id = await open(s, { context: 'topic_tutor', topicId: B.topicCardio });
    // 24 сообщения истории (одно — с email и телефоном), затем новый вопрос.
    for (let i = 0; i < 24; i++) {
      await stack.db.insert(aiMessages).values({
        conversationId: id,
        role: i % 2 ? 'assistant' : 'user',
        content: i === 20 ? 'Мой email aigerim@mail.kz, телефон +7 701 123 45 67' : `сообщение ${i}`,
        createdAt: new Date(Date.now() - (30 - i) * 1000),
      });
    }
    await ask(s, id, { content: 'вопрос 10, пиши на parent@example.kz' });
    const prompt = provider.prompts.at(-1)!;
    // RU: описание, факт и все 5 разделов аккордеона опубликованной версии.
    for (const text of [
      'Сердце и сосуды, обеспечивающие кровообращение.',
      'За сутки сердце взрослого человека сокращается около 100 тысяч раз',
      'Основные функции',
      'Состав сердечно-сосудистой системы',
      'Строение сердца',
      'Круги кровообращения',
      'Кровеносные сосуды и давление',
    ]) {
      expect(prompt.system).toContain(text);
    }
    expect(prompt.system).toContain('beginner');
    // Вопросы квиза — только тексты; объяснения с правильным ответом в промпт не попадают.
    expect(prompt.system).toContain('Сколько камер в сердце человека?');
    expect(prompt.system).not.toContain('Два предсердия и два желудочка — всего четыре камеры.');
    expect(prompt.system).toContain('Never give the final answer');
    // Последние 20 сообщений; без ПД (email, телефон, имя, ID и логин ученика).
    expect(prompt.messages).toHaveLength(20);
    expect(prompt.messages[0]).toEqual({ role: 'assistant', content: 'сообщение 5' });
    expect(prompt.messages.at(-1)).toEqual({ role: 'user', content: 'вопрос 10, пиши на [email]' });
    expect(prompt.messages).toContainEqual({ role: 'user', content: 'Мой email [email], телефон [phone]' });
    const all = JSON.stringify(provider.prompts);
    for (const pd of [
      'parent@example.kz',
      'aigerim@mail.kz',
      '701 123 45 67',
      'Айгерим',
      'Сапарова',
      s.userId,
      'tutor-student-',
    ]) {
      expect(all).not.toContain(pd);
    }
  });

  it('BR-AI-02, REQ-ST-LES-07 the lesson text follows the student language (KK; EN with its sixth section)', async () => {
    const s = await newStudent();
    provider.impl = fixed(['ok']);
    const id = await open(s, { context: 'topic_tutor', topicId: B.topicCardio });
    await ask(s, id, { content: 'Сұрақ' }, 'kk');
    expect(provider.prompts.at(-1)!.system).toContain('Жүректің құрылысы');
    expect(provider.prompts.at(-1)!.system).toContain('Always answer in Kazakh');
    expect(provider.prompts.at(-1)!.system).not.toContain('Строение сердца');
    await ask(s, id, { content: 'Question' }, 'en');
    expect(provider.prompts.at(-1)!.system).toContain('Microcirculation');
    // Общий диалог — без текста темы.
    const general = await open(s, { context: 'general_tutor' });
    await ask(s, general, { content: 'Что такое фотосинтез?' });
    expect(provider.prompts.at(-1)!.system).not.toContain('Current lesson');
  });

  it('API-S-12 validation: content ≤ 2000 characters, quickAction from PH-21', async () => {
    const id = await open(student, { context: 'general_tutor' });
    const long = await as(student).post(`/api/student/ai/conversations/${id}/messages`, {
      content: 'x'.repeat(2001),
    });
    expect(long.status).toBe(400);
    expect(long.body).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { content: 'tooLong' } });
    await as(student)
      .post(`/api/student/ai/conversations/${id}/messages`, { content: 'a', quickAction: 'solve_it' })
      .expect(400);
  });

  it('API-GEN-06, PH-20 limits are per student: 11th question within a minute → 429; another student is not affected', async () => {
    const s = await newStudent();
    const id = await open(s, { context: 'general_tutor' });
    for (let i = 0; i < 10; i++) expect((await ask(s, id, { content: `q${i}` })).res.status).toBe(200);
    const limited = await as(s).post(`/api/student/ai/conversations/${id}/messages`, { content: 'ещё' });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
    const o = await newStudent();
    const oid = await open(o, { context: 'general_tutor' });
    expect((await ask(o, oid, { content: 'q' })).res.status).toBe(200);
  });

  it('API-GEN-06, PH-20, AC-STF-10 per-day limit per student comes from app_config ai.limits', async () => {
    const config = stack.app.get(AppConfigService);
    await stack.db
      .update(schema.appConfig)
      .set({ value: { per_minute: 100, per_day: 3, max_chars: 2000 } })
      .where(eq(schema.appConfig.key, 'ai.limits'));
    await config.invalidate('ai.limits');
    try {
      const s = await newStudent();
      const id = await open(s, { context: 'general_tutor' });
      for (let i = 0; i < 3; i++) expect((await ask(s, id, { content: `q${i}` })).res.status).toBe(200);
      const limited = await as(s).post(`/api/student/ai/conversations/${id}/messages`, { content: 'ещё' });
      expect(limited.status).toBe(429);
      expect(limited.body.retryAfterSeconds).toBeGreaterThan(60);
    } finally {
      await stack.db
        .update(schema.appConfig)
        .set({ value: { per_minute: 10, per_day: 50, max_chars: 2000 } })
        .where(eq(schema.appConfig.key, 'ai.limits'));
      await config.invalidate('ai.limits');
    }
  });

  it('API-GEN-01 OpenAPI documents API-S-11..13', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/student/ai/conversations']?.post).toBeDefined();
    expect(doc.paths['/api/student/ai/conversations/{id}']?.get).toBeDefined();
    expect(doc.paths['/api/student/ai/conversations/{id}/messages']?.post).toBeDefined();
  });
});
