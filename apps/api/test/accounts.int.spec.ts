import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { passwordResetKey } from '@syntara/shared';
import { schema } from '@syntara/db';
import { DEMO_IDS } from '@syntara/db/seed';
import { REDIS } from '../src/infra/tokens';
import { ACCOUNTS, cookiesOf, freshIp, login, newKey, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

describe('accounts (integration)', () => {
  let stack: TestStack;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body),
  });

  const register = (body: object, locale = 'kk') =>
    http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .set('Accept-Language', locale)
      .send(body);

  beforeAll(async () => {
    stack = await startStack('demo');
  });

  afterAll(() => stack?.stop());

  it('API-AUTH-03 teacher sign-up → 201, signed in; role, preferences, consent and email in one go', async () => {
    const res = await register({
      role: 'teacher',
      email: 'Aigerim.Teacher@example.kz',
      displayName: 'Айгерим Учитель',
      password: 'strong-pass-1',
    }).expect(201);
    expect(res.body.user).toMatchObject({
      displayName: 'Айгерим Учитель',
      roles: ['teacher'],
      activeRole: 'teacher',
      initials: 'АУ',
    });
    expect(cookiesOf(res).sid?.raw).toMatch(/HttpOnly/);
    const id = res.body.user.id as string;

    const [user] = await stack.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(user).toMatchObject({ email: 'Aigerim.Teacher@example.kz', isChildSafe: false, login: null });
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    const [prefs] = await stack.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, id));
    expect(prefs!.locale).toBe('kk');
    const consents = await stack.db.select().from(schema.consents).where(eq(schema.consents.userId, id));
    expect(consents).toEqual([
      expect.objectContaining({ consentType: 'terms_privacy', granted: true, grantedBy: id }),
    ]);
    const emails = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.toEmail, 'Aigerim.Teacher@example.kz'));
    expect(emails).toEqual([expect.objectContaining({ template: 'auth.registered' })]);
    expect(JSON.stringify(emails[0]!.payload)).not.toContain('strong-pass-1');

    // Email без учёта регистра (citext) — повтор занят.
    const dup = await register({
      role: 'teacher',
      email: 'aigerim.teacher@example.kz',
      displayName: 'X',
      password: 'strong-pass-1',
    }).expect(409);
    expect(dup.body.fieldErrors).toEqual({ email: 'emailTaken' });
  });

  it('API-AUTH-03, PH-06, PH-17 only teachers can sign up; password ≥ 8 characters', async () => {
    const student = await register({
      role: 'student',
      email: 's@example.kz',
      displayName: 'S',
      password: 'strong-pass-1',
    }).expect(400);
    expect(student.body.fieldErrors.role).toBeDefined();
    const short = await register({
      role: 'teacher',
      email: 't2@example.kz',
      displayName: 'T',
      password: 'short',
    }).expect(400);
    expect(short.body.fieldErrors).toEqual({ password: 'passwordTooShort' });
  });

  it('API-AUTH-04 forgot: always 204; a reset email is queued only for an existing account', async () => {
    await http()
      .post('/api/auth/password/forgot')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'nobody@example.kz' })
      .expect(204);
    expect(
      await stack.db
        .select()
        .from(schema.emailQueue)
        .where(eq(schema.emailQueue.toEmail, 'nobody@example.kz')),
    ).toEqual([]);

    await http()
      .post('/api/auth/password/forgot')
      .set('X-Forwarded-For', freshIp())
      .set('Accept-Language', 'en')
      .send({ email: ACCOUNTS.teacher })
      .expect(204);
    const [email] = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(
        and(
          eq(schema.emailQueue.toEmail, ACCOUNTS.teacher),
          eq(schema.emailQueue.template, 'auth.password_reset'),
        ),
      );
    expect(email!.payload).toEqual({ locale: 'en', userId: DEMO_IDS.teacher });
  });

  it('API-AUTH-04 reset: one-time token sets a new password and ends all sessions of the user', async () => {
    const res = await register({
      role: 'teacher',
      email: 'reset.me@example.kz',
      displayName: 'R',
      password: 'old-password-1',
    }).expect(201);
    const userId = res.body.user.id as string;
    const oldSession = await login(http, 'reset.me@example.kz', 'old-password-1');

    // Токен, как его создаёт worker: в Redis — только хеш.
    const token = randomBytes(32).toString('base64url');
    const redis = stack.app.get<Redis>(REDIS);
    await redis.set(passwordResetKey(createHash('sha256').update(token).digest('hex')), userId, 'EX', 60);

    await http()
      .post('/api/auth/password/reset')
      .set('X-Forwarded-For', freshIp())
      .send({ token, password: 'new-password-1' })
      .expect(204);
    await http().get('/api/me').set('Cookie', oldSession.cookie).expect(401);
    await login(http, 'reset.me@example.kz', 'new-password-1');
    await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'reset.me@example.kz', password: 'old-password-1' })
      .expect(401);

    const reused = await http()
      .post('/api/auth/password/reset')
      .set('X-Forwarded-For', freshIp())
      .send({ token, password: 'other-password-1' })
      .expect(400);
    expect(reused.body.fieldErrors).toEqual({ token: 'invalidToken' });
  });

  it('API-ME-02 preferences are saved in user_preferences', async () => {
    const s = await login(http, ACCOUNTS.teacher);
    const res = await as(s)
      .patch('/api/me/preferences', { locale: 'en', theme: 'light', dataSaver: true })
      .expect(200);
    expect(res.body.preferences).toEqual({ locale: 'en', theme: 'light', dataSaver: true });
    expect((await as(s).get('/api/me').expect(200)).body.preferences.theme).toBe('light');
    await as(s).patch('/api/me/preferences', { theme: 'neon' }).expect(400);
    await as(s).patch('/api/me/preferences', {}).expect(400);
    await http().patch('/api/me/preferences').send({ theme: 'dark' }).expect(401);
  });

  it('API-ME-03 active role: only a role the user has; the choice is kept per browser', async () => {
    const res = await register({
      role: 'teacher',
      email: 'two.roles@example.kz',
      displayName: 'Two Roles',
      password: 'strong-pass-1',
    }).expect(201);
    const id = res.body.user.id as string;
    let s = await login(http, 'two.roles@example.kz', 'strong-pass-1');
    await as(s).post('/api/me/active-role', { role: 'student' }).expect(403);

    await stack.db.insert(schema.userRoles).values({ userId: id, role: 'student' });
    s = await login(http, 'two.roles@example.kz', 'strong-pass-1');
    expect((await as(s).get('/api/me').expect(200)).body).toMatchObject({
      roles: ['student', 'teacher'],
      activeRole: 'student',
    });
    const switched = await as(s).post('/api/me/active-role', { role: 'teacher' }).expect(200);
    expect(switched.body.activeRole).toBe('teacher');
    const role = cookiesOf(switched).role!;
    expect(role.raw).toMatch(/HttpOnly/);
    const me = await http().get('/api/me').set('Cookie', `${s.cookie}; role=${role.value}`).expect(200);
    expect(me.body.activeRole).toBe('teacher');
    // Подменённая cookie с чужой ролью игнорируется.
    const forged = await http().get('/api/me').set('Cookie', `${s.cookie}; role=support_agent`).expect(200);
    expect(forged.body.activeRole).toBe('student');
  });

  it('API-ME-04 notifications: empty list (Q-20); guest → 401', async () => {
    const s = await login(http, ACCOUNTS.teacher);
    expect((await as(s).get('/api/me/notifications').expect(200)).body).toEqual([]);
    await http().get('/api/me/notifications').expect(401);
  });

  it('API-ME-05, PH-08 data request creates a data_privacy ticket; nothing without a session', async () => {
    const s = await login(http, ACCOUNTS.teacher);
    const res = await as(s).post('/api/me/data-requests', { type: 'export' }).expect(201);
    expect(res.body).toMatchObject({
      type: 'export',
      publicNumber: expect.stringMatching(/^T-\d{6}-\d{4}$/),
    });
    const [ticket] = await stack.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.publicNumber, res.body.publicNumber));
    expect(ticket).toMatchObject({
      category: 'data_privacy',
      email: ACCOUNTS.teacher,
      userId: DEMO_IDS.teacher,
      status: 'new',
    });
    const [dsr] = await stack.db
      .select()
      .from(schema.dataSubjectRequests)
      .where(eq(schema.dataSubjectRequests.id, res.body.id));
    expect(dsr).toMatchObject({ type: 'export', status: 'new', userId: DEMO_IDS.teacher });
    await as(s).post('/api/me/data-requests', { type: 'rectify' }).expect(400);
    await http().post('/api/me/data-requests').send({ type: 'delete' }).expect(401);
  });

  it('API-S-16 stats for students; other roles → 403', async () => {
    const s = await login(http, ACCOUNTS.teacher);
    await as(s).get('/api/me/stats').expect(403);
  });

  it('REQ-NFR-SEC-03 forms of the auth flow never set cookies for guests without a session', async () => {
    const res = await http()
      .post('/api/auth/password/forgot')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'x@example.kz' })
      .expect(204);
    expect(cookiesOf(res).sid).toBeUndefined();
    expect(newKey()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
