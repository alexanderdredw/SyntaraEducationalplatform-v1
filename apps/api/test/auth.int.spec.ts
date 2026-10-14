import request from 'supertest';
import { eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { DEMO_IDS } from '@syntara/db/seed';
import { ACCOUNTS, cookiesOf, DEV_PASSWORD, freshIp, login } from './support/session';
import { startStack, type TestStack } from './support/stack';

describe('auth core (integration)', () => {
  let stack: TestStack;
  const http = () => request(stack.app.getHttpServer());

  beforeAll(async () => {
    stack = await startStack('demo');
  });

  afterAll(() => stack?.stop());

  it('API-AUTH-01, REQ-NFR-SEC-03 login sets sid (HttpOnly, Secure, SameSite=Lax, ≤ 14 days) and csrf cookies', async () => {
    const res = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: ACCOUNTS.support, password: DEV_PASSWORD })
      .expect(200);
    expect(res.body.user).toMatchObject({
      id: DEMO_IDS.support,
      displayName: 'Demo Support',
      initials: 'DS',
      roles: ['support_agent'],
      activeRole: 'support_agent',
      preferences: { locale: 'ru', theme: 'system', dataSaver: false },
    });
    const { sid, csrf } = cookiesOf(res);
    expect(sid!.raw).toMatch(/HttpOnly/i);
    expect(sid!.raw).toMatch(/Secure/i);
    expect(sid!.raw).toMatch(/SameSite=Lax/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(sid!.raw)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(14 * 24 * 60 * 60);
    expect(csrf!.raw).not.toMatch(/HttpOnly/i);
    expect(csrf!.raw).toMatch(/SameSite=Lax/i);
  });

  it('REQ-NFR-SEC-02 session tokens are stored only as hashes; passwords are Argon2id', async () => {
    const session = await login(http, ACCOUNTS.support);
    const token = /sid=([^;]+)/.exec(session.cookie)![1]!;
    const rows = await stack.db.select().from(schema.authSessions);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenHash.length).toBe(32);
      expect(row.tokenHash.toString('base64url')).not.toBe(token);
      expect(row.tokenHash.toString('utf8')).not.toContain(token);
    }
    const [user] = await stack.db.select().from(schema.users).where(eq(schema.users.id, DEMO_IDS.support));
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user!.lastLoginAt).toBeInstanceOf(Date);
  });

  it('API-AUTH-01 wrong password and unknown email give the same 401', async () => {
    const wrong = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: ACCOUNTS.support, password: 'nope-nope-nope' })
      .expect(401);
    const unknown = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'nobody@syntara.local', password: 'nope-nope-nope' })
      .expect(401);
    expect(wrong.body).toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(cookiesOf(wrong).sid).toBeUndefined();
  });

  it('API-AUTH-01 invalid body → 400 VALIDATION_FAILED with i18n keys', async () => {
    const res = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'x' })
      .expect(400);
    expect(res.body.fieldErrors).toEqual({ email: 'email', password: expect.any(String) });
  });

  it('API-ME-01 returns MeDto for a session (positive) and 401 without one (negative)', async () => {
    const session = await login(http, ACCOUNTS.onboarding);
    const me = await http().get('/api/me').set('Cookie', session.cookie).expect(200);
    expect(me.body).toMatchObject({
      roles: ['onboarding_agent'],
      activeRole: 'onboarding_agent',
      initials: 'DO',
    });
    const guest = await http().get('/api/me').expect(401);
    expect(guest.body.code).toBe('UNAUTHORIZED');
    const forged = await http().get('/api/me').set('Cookie', 'sid=forged-token').expect(401);
    expect(cookiesOf(forged).sid?.raw).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('API-GEN-02, REQ-NFR-SEC-03 state-changing requests with a session require X-CSRF-Token = csrf cookie', async () => {
    const session = await login(http, ACCOUNTS.teacher);
    const missing = await http().post('/api/auth/logout').set('Cookie', session.cookie).expect(403);
    expect(missing.body.code).toBe('FORBIDDEN');
    await http()
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', 'wrong')
      .expect(403);
    // Сессия всё ещё действует — запрос без токена отклонён до выполнения.
    await http().get('/api/me').set('Cookie', session.cookie).expect(200);
  });

  it('API-AUTH-02 logout revokes the session and clears cookies', async () => {
    const session = await login(http, ACCOUNTS.teacher);
    const res = await http()
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(204);
    expect(cookiesOf(res).sid?.raw).toMatch(/Expires=Thu, 01 Jan 1970/);
    await http().get('/api/me').set('Cookie', session.cookie).expect(401);
    await http().post('/api/auth/logout').expect(401);
  });

  it('API-GEN-06 login: 10 attempts per 15 minutes per IP+email, then 429 with retryAfterSeconds', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: ACCOUNTS.teacher, password: 'wrong-password' })
        .expect(401);
    }
    const limited = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: ACCOUNTS.teacher, password: DEV_PASSWORD })
      .expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(limited.headers['retry-after']).toBe(String(limited.body.retryAfterSeconds));
    // Другой email с того же IP не ограничен.
    await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: ACCOUNTS.support, password: DEV_PASSWORD })
      .expect(200);
  });

  it('API-GEN-01 OpenAPI documents API-AUTH-01, API-AUTH-02 and API-ME-01', async () => {
    const { buildOpenApi } = await import('../src/setup');
    const doc = buildOpenApi(stack.app);
    expect(doc.paths['/api/auth/login']?.post).toBeDefined();
    expect(doc.paths['/api/auth/logout']?.post).toBeDefined();
    expect(doc.paths['/api/me']?.get).toBeDefined();
  });
});
