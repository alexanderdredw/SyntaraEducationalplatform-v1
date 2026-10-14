import { type AddressInfo } from 'node:net';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { parseSse, type AssistantEvent } from '@syntara/shared';
import { schema } from '@syntara/db';
import { AppConfigService } from '../src/config/app-config.service';
import { LLM_PROVIDER, type LLMProvider, type Prompt } from '../src/modules/ai/llm-provider';
import { MockProvider } from '../src/modules/ai/mock-provider';
import { freshIp } from './support/session';
import { startStack, type TestStack } from './support/stack';

/** Подменяемый поставщик: по умолчанию — быстрый mock PH-19. */
const provider = {
  name: 'test',
  impl: null as LLMProvider | null,
  prompts: [] as Prompt[],
  aborted: 0,
  stream(prompt: Prompt, signal: AbortSignal) {
    this.prompts.push(prompt);
    signal.addEventListener('abort', () => (this.aborted += 1));
    return (this.impl ?? new MockProvider(0, 0)).stream(prompt, signal);
  },
};

const fixed = (chunks: string[], delayMs = 0): LLMProvider => ({
  name: 'fixed',
  async *stream(_p, signal) {
    for (const c of chunks) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (signal.aborted) return;
      yield c;
    }
  },
});

const sseParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: string) => void) => {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (c: string) => (data += c));
  res.on('end', () => cb(null, data));
};

describe('public assistant (integration)', () => {
  let stack: TestStack;
  const http = () => request(stack.app.getHttpServer());

  async function ask(body: object, { ip = freshIp(), locale = 'ru' } = {}) {
    const res = await http()
      .post('/api/public/assistant')
      .set('X-Forwarded-For', ip)
      .set('Accept-Language', locale)
      .send(body)
      .buffer(true)
      .parse(sseParser as never);
    const events: AssistantEvent[] = res.status === 200 ? parseSse(res.body as string).events : [];
    const text = events.flatMap((e) => (e.event === 'delta' ? [e.data.text] : [])).join('');
    return { res, events, text };
  }

  beforeAll(async () => {
    stack = await startStack('demo', (b) => b.overrideProvider(LLM_PROVIDER).useValue(provider));
  });

  afterAll(() => stack?.stop());

  beforeEach(() => {
    provider.impl = null;
    provider.prompts = [];
    provider.aborted = 0;
  });

  it('AC-PUB-06, API-PUB-06 quick question → SSE stream with the PH-19 answer, then done', async () => {
    const { res, events, text } = await ask({ message: 'Что это за платформа?' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(text).toBe('Syntara — учебная платформа: уроки, квизы и ИИ-наставник на казахском и русском.');
    expect(events.filter((e) => e.event === 'delta').length).toBeGreaterThan(1);
    expect(events.at(-1)).toEqual({ event: 'done', data: {} });
  });

  it('AC-PUB-06, API-GEN-03 the answer follows the interface language', async () => {
    const { text } = await ask({ message: 'Тілді қалай ауыстыруға болады?' }, { locale: 'kk' });
    expect(text).toBe('Жоғарғы панельдегі тіл ауыстырғышты басыңыз.');
  });

  it('AC-PUB-06, REQ-PUB-AI-05 own question in mock mode → «Помощник пока недоступен…» with a link to /support', async () => {
    const { text } = await ask({ message: 'Как получить сертификат?' });
    expect(text).toBe('Помощник пока недоступен. [Напишите в поддержку](/support)');
  });

  it('API-PUB-06 message ≤ 2000 characters and history ≤ 20 → otherwise 400 JSON', async () => {
    const long = await http()
      .post('/api/public/assistant')
      .set('X-Forwarded-For', freshIp())
      .send({ message: 'x'.repeat(2001) });
    expect(long.status).toBe(400);
    expect(long.body).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { message: 'tooLong' } });
    const history = Array.from({ length: 21 }, () => ({ role: 'user', content: 'a' }));
    const many = await http()
      .post('/api/public/assistant')
      .set('X-Forwarded-For', freshIp())
      .send({ message: 'a', history });
    expect(many.status).toBe(400);
    const empty = await http()
      .post('/api/public/assistant')
      .set('X-Forwarded-For', freshIp())
      .send({ message: '  ' });
    expect(empty.status).toBe(400);
  });

  it('API-GEN-06, PH-20 11th question within a minute → 429 with retryAfterSeconds', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++)
      expect((await ask({ message: 'Как сменить язык?' }, { ip })).res.status).toBe(200);
    const limited = await http()
      .post('/api/public/assistant')
      .set('X-Forwarded-For', ip)
      .send({ message: 'Ещё' });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
    expect(limited.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect((await ask({ message: 'Как сменить язык?' })).res.status).toBe(200);
  });

  it('API-GEN-06, PH-20 per-day limit comes from app_config ai.limits', async () => {
    const config = stack.app.get(AppConfigService);
    await stack.db
      .update(schema.appConfig)
      .set({ value: { per_minute: 100, per_day: 3, max_chars: 2000 } })
      .where(eq(schema.appConfig.key, 'ai.limits'));
    await config.invalidate('ai.limits');
    try {
      const ip = freshIp();
      for (let i = 0; i < 3; i++)
        expect((await ask({ message: 'Как сменить язык?' }, { ip })).res.status).toBe(200);
      const limited = await http()
        .post('/api/public/assistant')
        .set('X-Forwarded-For', ip)
        .send({ message: 'Ещё' });
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

  it('BR-AI-02 the prompt has the knowledge base and the last 20 messages without emails and phones', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      content: i === 19 ? 'мой email aigerim@mail.kz, телефон +7 701 123 45 67' : `сообщение ${i}`,
    }));
    await ask({ message: 'Пишите на parent@example.kz', history });
    const [prompt] = provider.prompts;
    expect(prompt!.messages).toHaveLength(20);
    expect(prompt!.messages.at(-1)).toEqual({ role: 'user', content: 'Пишите на [email]' });
    const all = JSON.stringify(prompt);
    expect(all).not.toContain('aigerim@mail.kz');
    expect(all).not.toContain('parent@example.kz');
    expect(all).not.toContain('701 123 45 67');
    expect(prompt!.system).toContain('Нужна ли регистрация?');
    expect(prompt!.system).toContain('Не могу точно ответить. Напишите в поддержку');
  });

  it('BR-AI-07, REQ-NFR-SEC-06 external links and HTML from the model are removed, internal links kept', async () => {
    provider.impl = fixed([
      'Смотри [сайт](https://ev',
      'il.example) и [предметы](/subjects) <scr',
      'ipt>x</script> https://evil.example/a конец',
    ]);
    const { text } = await ask({ message: 'ссылки' });
    expect(text).toBe('Смотри сайт и [предметы](/subjects) x  конец');
  });

  it('BR-AI-06 provider failure → event error AI_UNAVAILABLE', async () => {
    provider.impl = {
      name: 'broken',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('provider down');
      },
    };
    const { events } = await ask({ message: 'Что это за платформа?' });
    expect(events.at(-1)).toEqual({ event: 'error', data: { code: 'AI_UNAVAILABLE' } });
  });

  it('REQ-PUB-AI-03 closing the connection cancels generation', async () => {
    provider.impl = fixed(
      Array.from({ length: 50 }, (_, i) => `слово${i} `),
      30,
    );
    // Сервер остаётся слушать до stack.stop(): supertest переиспользует его адрес.
    const server = stack.app.getHttpServer().listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/public/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp() },
      body: JSON.stringify({ message: 'долгий ответ' }),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await expect.poll(() => provider.aborted, { timeout: 3000 }).toBeGreaterThan(0);
  });

  it('BR-AI-05 nothing is stored on the server', async () => {
    await ask({ message: 'Что это за платформа?' });
    const [conversations] = await stack.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.aiConversations);
    const [messages] = await stack.db.select({ n: sql<number>`count(*)::int` }).from(schema.aiMessages);
    expect([conversations!.n, messages!.n]).toEqual([0, 0]);
  });

  it('API-GEN-01 OpenAPI documents API-PUB-06', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/public/assistant']?.post).toBeDefined();
  });
});
