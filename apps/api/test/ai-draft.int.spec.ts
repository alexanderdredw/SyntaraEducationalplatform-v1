import request from 'supertest';
import { eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { loadEnv } from '../src/config/env';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

/** AC-TCH-04 (решение Q-13): детерминированный черновик вместо поставщика ИИ; ничего не сохраняется. */
describe('AI draft with the test fixture (integration)', () => {
  let stack: TestStack;
  let teacher: Session;
  const http = () => request(stack.app.getHttpServer());
  const post = (path: string, body: object = {}) =>
    http()
      .post(path)
      .set('Cookie', teacher.cookie)
      .set('X-CSRF-Token', teacher.csrf)
      .set('X-Forwarded-For', freshIp())
      .send(body);

  beforeAll(async () => {
    stack = await startStack('demo', (b) => b, { AI_DRAFT_FIXTURE: 'true' });
    teacher = await login(http, ACCOUNTS.teacher);
  });

  afterAll(() => stack?.stop());

  it('AC-TCH-04, REQ-TCH-TOP-02 the draft fills RU and KK; the topic is neither saved nor published', async () => {
    const subject = await post('/api/teacher/subjects', {
      translations: { ru: { title: 'Биология' } },
      inPublicCatalog: false,
    }).expect(201);
    const topicId = (await post(`/api/teacher/subjects/${subject.body.id}/topics`).expect(201)).body
      .id as string;
    const before = await stack.db.select().from(schema.topics).where(eq(schema.topics.id, topicId));

    const res = await post(`/api/teacher/topics/${topicId}/ai-draft`, {
      title: 'Как работает сердце',
    }).expect(200);
    // Название — на языке черновика (решение владельца 2026-10-16).
    expect(res.body.ru.title).toBe('Как работает сердце');
    expect(res.body.kk.title).toContain('Как работает сердце');
    for (const locale of ['ru', 'kk'] as const) {
      expect(res.body[locale]).toEqual({
        title: expect.any(String),
        description: expect.stringContaining('Как работает сердце'),
        funFact: expect.stringContaining('Как работает сердце'),
        bodyMd: expect.stringContaining('## Как работает сердце'),
      });
    }
    expect(res.body.en).toBeUndefined();

    const after = await stack.db.select().from(schema.topics).where(eq(schema.topics.id, topicId));
    expect(after).toEqual(before);
    expect(after[0]!.status).toBe('draft');
    const translations = await stack.db
      .select()
      .from(schema.topicTranslations)
      .where(eq(schema.topicTranslations.topicId, topicId));
    expect(translations).toEqual([]);
  });

  it('AC-TCH-04 the fixture flag is forbidden in production', () => {
    expect(() =>
      loadEnv({ ...process.env, NODE_ENV: 'production', AI_DRAFT_FIXTURE: 'true' } as NodeJS.ProcessEnv),
    ).toThrow(/AI_DRAFT_FIXTURE/);
  });
});
