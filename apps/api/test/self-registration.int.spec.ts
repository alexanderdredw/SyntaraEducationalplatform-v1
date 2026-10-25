import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { emailVerifyKey } from '@syntara/shared';
import { schema } from '@syntara/db';
import { DEMO_IDS, demoSchoolId } from '@syntara/db/seed';
import { REDIS } from '../src/infra/tokens';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

describe('student self-registration, schools, temporary password, email verification (integration)', () => {
  let stack: TestStack;
  let teacher: Session;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .send(body),
  });
  const register = (body: object) =>
    http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .set('Accept-Language', 'ru')
      .send(body);
  const studentRole = async (userId: string) =>
    (
      await stack.db
        .select()
        .from(schema.userRoles)
        .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.role, 'student')))
    )[0]!;

  async function classWithCode(name: string, schoolId: string | null = null) {
    const created = await as(teacher).post('/api/teacher/classes', { name }).expect(201);
    if (schoolId)
      await stack.db.update(schema.classes).set({ schoolId }).where(eq(schema.classes.id, created.body.id));
    const code = await as(teacher).post(`/api/teacher/classes/${created.body.id}/invite-codes`).expect(201);
    return { id: created.body.id as string, code: code.body.code as string };
  }

  beforeAll(async () => {
    stack = await startStack('demo');
    teacher = await login(http, ACCOUNTS.teacher);
  });

  afterAll(() => stack?.stop());

  it('API-PUB-09 school search: confirmed schools only, by name or city, ≥ 2 characters', async () => {
    const byName = await http().get('/api/public/schools?q=гимназ').expect(200);
    expect(byName.body.map((s: { name: string }) => s.name)).toEqual(
      expect.arrayContaining(['Школа-гимназия №1', 'Гимназия №7']),
    );
    const byCity = await http().get('/api/public/schools?q=Талгар').expect(200);
    expect(byCity.body).toEqual([
      { id: demoSchoolId('talgar-2'), name: 'Средняя школа №2', city: 'Талгар', region: 'Алматинская обл.' },
    ]);
    await http().get('/api/public/schools?q=a').expect(400);
    await stack.db.insert(schema.schools).values({ name: 'Непроверенная гимназия', status: 'unverified' });
    const hidden = await http().get('/api/public/schools?q=Непроверенная').expect(200);
    expect(hidden.body).toEqual([]);
  });

  it('AC-AUTH-05, BR-CLS-04 sign-up without code and email → child-safe account, no class, sign-in by login', async () => {
    const res = await register({ displayName: 'Дана', login: 'dana.s', password: 'student-pass-1' }).expect(
      201,
    );
    expect(res.body.user).toMatchObject({
      roles: ['student'],
      emailVerified: null,
      mustChangePassword: false,
    });
    const id = res.body.user.id as string;
    const [user] = await stack.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(user).toMatchObject({ login: 'dana.s', email: null, isChildSafe: true });
    expect((await studentRole(id)).schoolId).toBeNull();
    const s = await login(http, 'dana.s', 'student-pass-1');
    const cls = await http().get('/api/student/class').set('Cookie', s.cookie).expect(200);
    expect(cls.body).toBeNull();
  });

  it('REQ-GEN-AUTH-02 school: from the list → linked; typed manually → new school «unverified»; unknown id → 400', async () => {
    const listed = await register({
      displayName: 'A',
      login: 'listed.school',
      password: 'student-pass-1',
      schoolId: demoSchoolId('astana-12'),
    }).expect(201);
    expect((await studentRole(listed.body.user.id)).schoolId).toBe(demoSchoolId('astana-12'));

    const manual = await register({
      displayName: 'B',
      login: 'manual.school',
      password: 'student-pass-1',
      schoolName: 'Сельская школа, с. Каскелен',
    }).expect(201);
    const role = await studentRole(manual.body.user.id);
    const [school] = await stack.db
      .select()
      .from(schema.schools)
      .where(eq(schema.schools.id, role.schoolId!));
    expect(school).toMatchObject({ name: 'Сельская школа, с. Каскелен', status: 'unverified' });

    const bad = await register({
      displayName: 'C',
      login: 'bad.school',
      password: 'student-pass-1',
      schoolId: '0190a1b2-0000-7000-8000-000000000000',
    }).expect(400);
    expect(bad.body.fieldErrors).toEqual({ schoolId: 'invalidSchool' });
  });

  it('AC-AUTH-06 sign-up with a valid code → member of the class at once; school comes from the class', async () => {
    const { id: classId, code } = await classWithCode('6 «В»', demoSchoolId('shymkent-7'));
    const res = await register({
      displayName: 'Ерлан',
      login: 'erlan.k',
      password: 'student-pass-1',
      code,
      schoolId: demoSchoolId('almaty-1'),
    }).expect(201);
    const id = res.body.user.id as string;
    expect((await studentRole(id)).schoolId).toBe(demoSchoolId('shymkent-7'));
    const memberships = await stack.db
      .select()
      .from(schema.classMemberships)
      .where(eq(schema.classMemberships.studentId, id));
    expect(memberships).toEqual([expect.objectContaining({ classId, status: 'active' })]);
  });

  it('REQ-GEN-AUTH-02 login that looks like an email → loginIsEmail', async () => {
    const res = await register({
      displayName: 'D',
      login: 'kid@example.kz',
      password: 'student-pass-1',
    }).expect(400);
    expect(res.body.fieldErrors).toEqual({ login: 'loginIsEmail' });
  });

  it('PH-17 with self-registration off, a class code is required', async () => {
    const config = stack.app.get((await import('../src/config/app-config.service')).AppConfigService);
    await stack.db
      .update(schema.appConfig)
      .set({ value: false })
      .where(eq(schema.appConfig.key, 'auth.student_self_registration'));
    await config.invalidate('auth.student_self_registration');
    try {
      const res = await register({ displayName: 'E', login: 'no.code', password: 'student-pass-1' }).expect(
        400,
      );
      expect(res.body.fieldErrors).toEqual({ code: 'required' });
    } finally {
      await stack.db
        .update(schema.appConfig)
        .set({ value: true })
        .where(eq(schema.appConfig.key, 'auth.student_self_registration'));
      await config.invalidate('auth.student_self_registration');
    }
  });

  it('AC-AUTH-07, API-T-26/27 teacher sets a temporary password; the student must change it; sessions end', async () => {
    const { id: classId, code } = await classWithCode('Временный');
    const reg = await register({
      displayName: 'Мадина',
      login: 'madina.t',
      password: 'student-pass-1',
      code,
    }).expect(201);
    const studentId = reg.body.user.id as string;
    const oldSession = await login(http, 'madina.t', 'student-pass-1');

    const roster = await as(teacher).get(`/api/teacher/classes/${classId}/roster`).expect(200);
    expect(roster.body).toEqual([
      {
        id: studentId,
        displayName: 'Мадина',
        login: 'madina.t',
        hasEmail: false,
        // REQ-PRF-11: аватар ученика в «Ростере» (PROFILE_TZ).
        avatar: expect.objectContaining({ kind: 'initials', initials: 'М', photoUrl: null }),
      },
    ]);

    const temp = await as(teacher)
      .post(`/api/teacher/classes/${classId}/students/${studentId}/temporary-password`)
      .expect(201);
    expect(temp.body.temporaryPassword).toMatch(/^[a-z2-9]{10}$/);
    await http().get('/api/me').set('Cookie', oldSession.cookie).expect(401);

    const s = await login(http, 'madina.t', temp.body.temporaryPassword);
    expect((await as(s).get('/api/me').expect(200)).body.mustChangePassword).toBe(true);
    await as(s).post('/api/auth/password/change', { password: 'brand-new-pass-1' }).expect(204);
    expect((await as(s).get('/api/me').expect(200)).body.mustChangePassword).toBe(false);
    await login(http, 'madina.t', 'brand-new-pass-1');

    const audit = await stack.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, studentId));
    expect(audit.map((a) => a.action)).toContain('temporary_password_set');
    expect(JSON.stringify(audit)).not.toContain(temp.body.temporaryPassword);
  });

  it('API-T-27 only for own class members without email; foreign class → 404', async () => {
    const { id: classId, code } = await classWithCode('С почтой');
    const withEmail = await register({
      displayName: 'F',
      login: 'with.email.kid',
      password: 'student-pass-1',
      email: 'kid.mail@example.kz',
      code,
    }).expect(201);
    const res = await as(teacher)
      .post(`/api/teacher/classes/${classId}/students/${withEmail.body.user.id}/temporary-password`)
      .expect(409);
    expect(res.body.fieldErrors).toEqual({ studentId: 'studentHasEmail' });

    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email: 'stranger@example.kz', displayName: 'S', password: 'strong-pass-1' })
      .expect(201);
    const stranger = await login(http, 'stranger@example.kz', 'strong-pass-1');
    await as(stranger)
      .post(`/api/teacher/classes/${classId}/students/${withEmail.body.user.id}/temporary-password`)
      .expect(404);
    await as(stranger).get(`/api/teacher/classes/${classId}/roster`).expect(404);
  });

  it('API-AUTH-05 without a temporary password the current password is required', async () => {
    await register({ displayName: 'G', login: 'changer', password: 'student-pass-1' }).expect(201);
    const s = await login(http, 'changer', 'student-pass-1');
    const wrong = await as(s)
      .post('/api/auth/password/change', { currentPassword: 'nope-nope-1', password: 'next-pass-123' })
      .expect(400);
    expect(wrong.body.fieldErrors).toEqual({ currentPassword: 'invalidPassword' });
    await as(s)
      .post('/api/auth/password/change', { currentPassword: 'student-pass-1', password: 'next-pass-123' })
      .expect(204);
    await http()
      .post('/api/auth/password/change')
      .send({ password: 'x'.repeat(10) })
      .expect(401);
  });

  it('AC-AUTH-08, API-AUTH-06 teacher email: unverified after sign-up; link confirms; resend queues a new email', async () => {
    const reg = await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email: 'verify.me@example.kz', displayName: 'V', password: 'strong-pass-1' })
      .expect(201);
    expect(reg.body.user.emailVerified).toBe(false);
    const [mail] = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.toEmail, 'verify.me@example.kz'));
    expect(mail!.payload).toMatchObject({ userId: reg.body.user.id });

    const s = await login(http, 'verify.me@example.kz', 'strong-pass-1');
    await as(s).post('/api/auth/email/resend').expect(204);
    const mails = await stack.db
      .select()
      .from(schema.emailQueue)
      .where(eq(schema.emailQueue.toEmail, 'verify.me@example.kz'));
    expect(mails.map((m) => m.template).sort()).toEqual(['auth.email_verify', 'auth.registered']);

    const token = randomBytes(32).toString('base64url');
    await stack.app
      .get<Redis>(REDIS)
      .set(emailVerifyKey(createHash('sha256').update(token).digest('hex')), reg.body.user.id, 'EX', 60);
    await http().post('/api/auth/email/verify').set('X-Forwarded-For', freshIp()).send({ token }).expect(204);
    expect((await as(s).get('/api/me').expect(200)).body.emailVerified).toBe(true);
    await as(s).post('/api/auth/email/resend').expect(409);
    const reused = await http()
      .post('/api/auth/email/verify')
      .set('X-Forwarded-For', freshIp())
      .send({ token })
      .expect(400);
    expect(reused.body.fieldErrors).toEqual({ token: 'invalidToken' });

    // Демо-учитель из seed подтверждён.
    const demo = await login(http, ACCOUNTS.teacher);
    expect((await as(demo).get('/api/me').expect(200)).body).toMatchObject({
      id: DEMO_IDS.teacher,
      emailVerified: true,
    });
  });
});
