import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { EMAIL_TEMPLATES, emailChangeKey } from '@syntara/shared';
import { schema } from '@syntara/db';
import { REDIS } from '../src/infra/tokens';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const { users, emailQueue, auditLog, mediaFiles, userProfiles, supportTickets } = schema;

/**
 * docs/PROFILE_TZ.md, раздел 5; SPEC 7.15: смена email (API-ME-10, API-AUTH-06), пароль (API-AUTH-05),
 * «Выйти на всех других устройствах» (API-ME-11), сброс картинки поддержкой (API-SUP-09).
 */
describe('account settings (integration)', () => {
  let stack: TestStack;
  let redis: Redis;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie),
    send: (method: 'post' | 'patch' | 'put' | 'delete', path: string, body: object = {}) =>
      http()
        [method](path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .send(body),
  });

  async function newTeacher(): Promise<Session & { email: string }> {
    const email = `set.teacher.${++n}@example.com`;
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email, displayName: 'Алия Нурланова', password: 'teacher-pass-1' })
      .expect(201);
    return { ...(await login(http, email, 'teacher-pass-1')), email };
  }

  async function newStudent(email?: string): Promise<Session & { login: string }> {
    const loginName = `set.student.${++n}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({
        displayName: 'Асель',
        login: loginName,
        password: 'student-pass-1',
        ...(email ? { email } : {}),
      })
      .expect(201);
    return { ...(await login(http, loginName, 'student-pass-1')), login: loginName };
  }

  /** Ссылку создаёт worker при отправке письма (как в processors/email.ts); здесь — тот же ключ Redis. */
  async function changeToken(userId: string, email: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await redis.set(emailChangeKey(hash), JSON.stringify({ userId, email }), 'EX', 86_400);
    return token;
  }

  const emails = (to: string) => stack.db.select().from(emailQueue).where(eq(emailQueue.toEmail, to));

  beforeAll(async () => {
    stack = await startStack('demo');
    redis = stack.app.get(REDIS);
    if (redis.status === 'wait') await redis.connect();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('AC-PRF-06 a student without email adds one: link to the new address; nothing changes until it is confirmed', async () => {
    const student = await newStudent();
    await as(student)
      .send('post', '/api/me/email', { email: 'Asel.New@Example.com', currentPassword: 'student-pass-1' })
      .expect(202);
    const sent = await emails('asel.new@example.com');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: EMAIL_TEMPLATES.emailChange });
    expect(sent[0]!.payload).toMatchObject({ userId: student.userId, email: 'asel.new@example.com' });
    expect((await as(student).get('/api/me/profile').expect(200)).body.email).toBeNull();

    const token = await changeToken(student.userId, 'asel.new@example.com');
    await http().post('/api/auth/email/verify').set('X-Forwarded-For', freshIp()).send({ token }).expect(204);
    expect((await as(student).get('/api/me/profile').expect(200)).body).toMatchObject({
      email: 'asel.new@example.com',
      emailVerified: true,
      canRemoveEmail: true,
    });
    // Прежнего адреса не было — уведомления «Ваш email изменён» нет; ссылка одноразовая.
    await http().post('/api/auth/email/verify').set('X-Forwarded-For', freshIp()).send({ token }).expect(400);
    await login(http, 'asel.new@example.com', 'student-pass-1');
  });

  it('AC-PRF-06 BR-PRF-07 a teacher changes email: the old one works until confirmation, then a notice goes to the old address', async () => {
    const teacher = await newTeacher();
    const next = `set.next.${++n}@example.com`;
    await as(teacher)
      .send('post', '/api/me/email', { email: next, currentPassword: 'teacher-pass-1' })
      .expect(202);
    // До подтверждения действует прежний адрес.
    await login(http, teacher.email, 'teacher-pass-1');
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.email).toBe(teacher.email);

    await http()
      .post('/api/auth/email/verify')
      .set('X-Forwarded-For', freshIp())
      .send({ token: await changeToken(teacher.userId, next) })
      .expect(204);
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.email).toBe(next);
    const notice = await emails(teacher.email);
    expect(notice.map((e) => e.template)).toContain(EMAIL_TEMPLATES.emailChanged);
    await login(http, next, 'teacher-pass-1');
    const audit = await stack.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, teacher.userId), eq(auditLog.action, 'account.email')));
    expect(audit[0]).toMatchObject({ before: { email: teacher.email }, after: { email: next } });
  });

  it('BR-PRF-07 the current password is required; a taken or the same address — «Этот адрес нельзя использовать»', async () => {
    const teacher = await newTeacher();
    const other = await newTeacher();
    const post = (body: object) => as(teacher).send('post', '/api/me/email', body);
    expect(
      (await post({ email: 'x@example.com', currentPassword: 'wrong-pass' }).expect(400)).body.fieldErrors,
    ).toEqual({
      currentPassword: 'invalidPassword',
    });
    expect(
      (await post({ email: other.email, currentPassword: 'teacher-pass-1' }).expect(400)).body.fieldErrors,
    ).toEqual({
      email: 'emailUnavailable',
    });
    expect(
      (await post({ email: teacher.email.toUpperCase(), currentPassword: 'teacher-pass-1' }).expect(400)).body
        .fieldErrors,
    ).toEqual({ email: 'emailUnavailable' });
    expect(await emails(other.email)).toHaveLength(1); // только письмо о регистрации

    // Адрес заняли, пока ссылка ждала подтверждения.
    const free = `set.race.${++n}@example.com`;
    const token = await changeToken(teacher.userId, free);
    await stack.db.update(users).set({ email: free }).where(eq(users.id, other.userId));
    expect(
      (
        await http()
          .post('/api/auth/email/verify')
          .set('X-Forwarded-For', freshIp())
          .send({ token })
          .expect(400)
      ).body.fieldErrors,
    ).toEqual({ email: 'emailUnavailable' });
  });

  it('BR-PRF-07 only a student with a login removes the email (confirmed by password); a teacher cannot', async () => {
    const student = await newStudent(`set.kid.${++n}@example.com`);
    await as(student).send('delete', '/api/me/email', { currentPassword: 'wrong-pass' }).expect(400);
    await as(student).send('delete', '/api/me/email', { currentPassword: 'student-pass-1' }).expect(204);
    expect((await as(student).get('/api/me/profile').expect(200)).body).toMatchObject({
      email: null,
      emailVerified: null,
    });
    await login(http, student.login, 'student-pass-1');

    const teacher = await newTeacher();
    await as(teacher).send('delete', '/api/me/email', { currentPassword: 'teacher-pass-1' }).expect(403);
    expect((await as(teacher).get('/api/me/profile').expect(200)).body.email).toBe(teacher.email);
  });

  it('AC-PRF-07 BR-PRF-08 password change needs the current one, not equal to it; other sessions end, this one stays; a notice email', async () => {
    const teacher = await newTeacher();
    const other = await login(http, teacher.email, 'teacher-pass-1');
    const change = (body: object) => as(teacher).send('post', '/api/auth/password/change', body);
    expect((await change({ password: 'new-pass-123' }).expect(400)).body.fieldErrors).toEqual({
      currentPassword: 'required',
    });
    expect(
      (await change({ currentPassword: 'nope-nope', password: 'new-pass-123' }).expect(400)).body.fieldErrors,
    ).toEqual({
      currentPassword: 'invalidPassword',
    });
    expect(
      (await change({ currentPassword: 'teacher-pass-1', password: 'teacher-pass-1' }).expect(400)).body
        .fieldErrors,
    ).toEqual({ password: 'samePassword' });
    await change({ currentPassword: 'teacher-pass-1', password: 'new-pass-123' }).expect(204);

    await as(teacher).get('/api/me').expect(200);
    await as(other).get('/api/me').expect(401);
    expect((await emails(teacher.email)).map((e) => e.template)).toContain(EMAIL_TEMPLATES.passwordChanged);
    await login(http, teacher.email, 'new-pass-123');
    // 5 попыток за 15 минут: пятая ещё проходит (неверный пароль), шестая — 429.
    await change({ currentPassword: 'x', password: 'y-y-y-y-y-y' }).expect(400);
    const limited = await change({ currentPassword: 'x', password: 'y-y-y-y-y-y' }).expect(429);
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('AC-PRF-08 «Выйти на всех других устройствах» ends every other session and keeps the current one', async () => {
    const student = await newStudent();
    const phone = await login(http, student.login, 'student-pass-1');
    const tablet = await login(http, student.login, 'student-pass-1');
    await as(student).send('post', '/api/me/sessions/revoke-others').expect(204);
    await as(student).get('/api/me').expect(200);
    await as(phone).get('/api/me').expect(401);
    await as(tablet).get('/api/me').expect(401);
    expect((await as(student).get('/api/me/profile').expect(200)).body.lastLoginAt).not.toBeNull();
  });

  it('AC-PRF-05 BR-PRF-06 support resets a teacher picture from a ticket; others cannot', async () => {
    const teacher = await newTeacher();
    const [photo] = await stack.db
      .insert(mediaFiles)
      .values({
        ownerId: teacher.userId,
        kind: 'avatar',
        originalName: 'me.jpg',
        mime: 'image/webp',
        sizeBytes: 100,
        storageKey: `avatar/${crypto.randomUUID()}`,
        scanStatus: 'clean',
      })
      .returning();
    await as(teacher).send('put', '/api/me/avatar', { kind: 'photo', mediaId: photo!.id }).expect(200);
    // Обращение пользователя (API-ME-05 создаёт обращение с userId).
    const request_ = await as(teacher).send('post', '/api/me/data-requests', { type: 'export' }).expect(201);
    const [ticket] = await stack.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.publicNumber, request_.body.publicNumber));

    const support = await login(http, ACCOUNTS.support);
    expect((await as(support).get(`/api/staff/tickets/${ticket!.id}`).expect(200)).body.user).toEqual({
      id: teacher.userId,
      hasPhotoAvatar: true,
    });
    await as(teacher).send('post', `/api/staff/tickets/${ticket!.id}/user-avatar/reset`).expect(403);
    const student = await newStudent();
    await as(student).send('post', `/api/staff/tickets/${ticket!.id}/user-avatar/reset`).expect(403);

    const reset = await as(support)
      .send('post', `/api/staff/tickets/${ticket!.id}/user-avatar/reset`)
      .expect(200);
    expect(reset.body.user.hasPhotoAvatar).toBe(false);
    expect((await as(teacher).get('/api/me').expect(200)).body.avatar).toMatchObject({
      kind: 'initials',
      photoUrl: null,
    });
    const [profile] = await stack.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, teacher.userId));
    expect(profile).toMatchObject({ avatarKind: 'initials', avatarMediaId: null });
    expect(await stack.db.select().from(mediaFiles).where(eq(mediaFiles.id, photo!.id))).toHaveLength(0);
    const audit = await stack.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, teacher.userId), eq(auditLog.action, 'profile.avatar_reset')));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(support.userId);
    // Картинки больше нет — повторный сброс: 404.
    await as(support).send('post', `/api/staff/tickets/${ticket!.id}/user-avatar/reset`).expect(404);
  });

  const CHROME_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0';

  /** Вход с заданным User-Agent (устройство). */
  async function loginAs(identifier: string, password: string, ua: string): Promise<Session> {
    const res = await http()
      .post('/api/auth/login')
      .set('X-Forwarded-For', freshIp())
      .set('User-Agent', ua)
      .send({ email: identifier, password })
      .expect(200);
    const cookies = Object.fromEntries(
      (res.headers['set-cookie'] as unknown as string[]).map((line) => {
        const [pair] = line.split(';');
        const [name, ...value] = pair!.split('=');
        return [name!.trim(), value.join('=')];
      }),
    );
    return {
      cookie: `sid=${cookies.sid}; csrf=${cookies.csrf}`,
      csrf: cookies.csrf!,
      userId: res.body.user.id,
    };
  }

  it('AC-PRF-28 REQ-PRF-32 sessions: devices by name, «Это устройство», sign out one (not the current), no IP', async () => {
    const student = await newStudent();
    const phone = await loginAs(student.login, 'student-pass-1', SAFARI_IPHONE);
    const desk = await loginAs(student.login, 'student-pass-1', CHROME_WIN);
    const list = (await as(desk).get('/api/me/sessions').expect(200)).body as Array<{
      id: string;
      device: { browser: string | null; os: string | null };
      current: boolean;
      lastActiveAt: string;
    }>;
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]).toMatchObject({ current: true, device: { browser: 'Chrome', os: 'Windows' } });
    expect(list.filter((x) => x.current)).toHaveLength(1);
    const phoneRow = list.find((x) => x.device.os === 'iPhone')!;
    expect(phoneRow.device.browser).toBe('Safari');
    // IP-адреса не отдаются: только устройство и время.
    expect(Object.keys(list[0]!).sort()).toEqual(['createdAt', 'current', 'device', 'id', 'lastActiveAt']);

    await as(desk).send('delete', `/api/me/sessions/${list[0]!.id}`).expect(404);
    await as(desk).send('delete', `/api/me/sessions/${phoneRow.id}`).expect(204);
    await as(phone).get('/api/me').expect(401);
    await as(desk).get('/api/me').expect(200);
    await as(desk).send('delete', `/api/me/sessions/${phoneRow.id}`).expect(404);
    // Чужую сессию завершить нельзя.
    const other = await newStudent();
    const otherList = (await as(other).get('/api/me/sessions').expect(200)).body as Array<{ id: string }>;
    await as(desk).send('delete', `/api/me/sessions/${otherList[0]!.id}`).expect(404);
    await as(other).get('/api/me').expect(200);
  });

  it('AC-PRF-29 BR-PRF-20 a teacher signing in from a new device gets one email; the same device again — none; a student — none', async () => {
    const email = `set.device.${++n}@example.com`;
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .set('User-Agent', CHROME_WIN)
      .send({ role: 'teacher', email, displayName: 'Алия Нурланова', password: 'teacher-pass-1' })
      .expect(201);
    await stack.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, email));
    const notices = async () => (await emails(email)).filter((e) => e.template === EMAIL_TEMPLATES.newDevice);

    // Устройство регистрации уже известно.
    await loginAs(email, 'teacher-pass-1', CHROME_WIN);
    expect(await notices()).toHaveLength(0);
    // Новое устройство — одно письмо с устройством и временем (Алматы).
    await loginAs(email, 'teacher-pass-1', FIREFOX_MAC);
    const first = await notices();
    expect(first).toHaveLength(1);
    expect(first[0]!.payload).toMatchObject({
      device: 'Firefox · macOS',
      at: expect.stringMatching(/^\d\d\.\d\d\.\d{4} \d\d:\d\d$/),
    });
    // Тот же браузер и ОС (другая версия) — то же устройство, писем больше нет.
    await loginAs(email, 'teacher-pass-1', FIREFOX_MAC.replace('131.0', '132.0'));
    expect(await notices()).toHaveLength(1);
    const devices = await stack.db.select().from(schema.knownDevices);
    expect(JSON.stringify(devices)).not.toContain('Firefox');

    // Ученику с подтверждённым email писем о новых устройствах нет.
    const kidEmail = `set.kid.dev.${++n}@example.com`;
    const kid = await newStudent(kidEmail);
    await stack.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, kidEmail));
    await loginAs(kid.login, 'student-pass-1', SAFARI_IPHONE);
    expect((await emails(kidEmail)).filter((e) => e.template === EMAIL_TEMPLATES.newDevice)).toHaveLength(0);
  });
});
