import request from 'supertest';
import { schema } from '@syntara/db';
import { ACCOUNTS, cookiesOf, DEV_PASSWORD, freshIp } from './support/session';
import { startStack, type TestStack } from './support/stack';

/**
 * BR-AUTH-01 (API-AUTH-01): вход привязан к форме роли. Сначала логин и пароль (общий 401 и прежний лимит), затем
 * роль: не та форма — 403 wrongRoleForLogin + expectedEntry, сессия не создаётся. Аккаунт с двумя ролями входит
 * через любую форму, активной становится роль формы. Без роли — служебный вход, как раньше.
 */
describe('login by role form (integration)', () => {
  let stack: TestStack;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const loginAs = (body: object, ip = freshIp()) =>
    http().post('/api/auth/login').set('X-Forwarded-For', ip).send(body);

  async function newStudent(): Promise<{ login: string; id: string }> {
    const login = `role.student.${++n}`;
    const res = await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: 'Ученик', login, password: 'student-pass-1' })
      .expect(201);
    return { login, id: res.body.user.id as string };
  }

  beforeAll(async () => {
    stack = await startStack('demo');
  });

  afterAll(() => stack?.stop());

  it('BR-AUTH-01 a student in the teacher form → 403 wrongRoleForLogin (expectedEntry student), no session', async () => {
    const { login } = await newStudent();
    const res = await loginAs({ email: login, password: 'student-pass-1', role: 'teacher' }).expect(403);
    expect(res.body).toMatchObject({
      code: 'FORBIDDEN',
      fieldErrors: { login: 'wrongRoleForLogin' },
      expectedEntry: 'student',
    });
    const cookies = cookiesOf(res);
    expect(cookies.sid).toBeUndefined();
    expect(cookies.role).toBeUndefined();
  });

  it('BR-AUTH-01 a teacher in the student form → 403 wrongRoleForLogin (expectedEntry teacher), no session', async () => {
    const res = await loginAs({ email: ACCOUNTS.teacher, password: DEV_PASSWORD, role: 'student' }).expect(
      403,
    );
    expect(res.body).toMatchObject({ fieldErrors: { login: 'wrongRoleForLogin' }, expectedEntry: 'teacher' });
    expect(cookiesOf(res).sid).toBeUndefined();
  });

  it('BR-AUTH-01 matching pairs sign in; the active role is the form role', async () => {
    const { login } = await newStudent();
    const student = await loginAs({ email: login, password: 'student-pass-1', role: 'student' }).expect(200);
    expect(student.body.user).toMatchObject({ roles: ['student'], activeRole: 'student' });
    expect(cookiesOf(student).sid).toBeDefined();
    expect(cookiesOf(student).role?.value).toBe('student');
    const teacher = await loginAs({
      email: ACCOUNTS.teacher,
      password: DEV_PASSWORD,
      role: 'teacher',
    }).expect(200);
    expect(teacher.body.user.activeRole).toBe('teacher');
  });

  it('BR-AUTH-01 an account with both roles signs in through either form; the active role is the form role', async () => {
    const { login, id } = await newStudent();
    await stack.db.insert(schema.userRoles).values({ userId: id, role: 'teacher' });
    for (const role of ['teacher', 'student'] as const) {
      const res = await loginAs({ email: login, password: 'student-pass-1', role }).expect(200);
      expect(res.body.user.activeRole).toBe(role);
      expect(cookiesOf(res).role?.value).toBe(role);
      // Сессия рабочая: /api/me с cookie этой сессии — та же активная роль.
      const cookie = Object.entries(cookiesOf(res))
        .map(([name, c]) => `${name}=${c.value}`)
        .join('; ');
      expect((await http().get('/api/me').set('Cookie', cookie).expect(200)).body.activeRole).toBe(role);
    }
  });

  it('BR-AUTH-01 a wrong password gives the same 401 in every form (role and existence are not revealed)', async () => {
    const { login } = await newStudent();
    const bodies: unknown[] = [];
    for (const body of [
      { email: login, password: 'wrong-pass-1', role: 'teacher' },
      { email: login, password: 'wrong-pass-1', role: 'student' },
      { email: 'nobody@example.kz', password: 'wrong-pass-1', role: 'teacher' },
      { email: ACCOUNTS.teacher, password: 'wrong-pass-1', role: 'student' },
    ]) {
      const res = await loginAs(body).expect(401);
      expect(res.body.expectedEntry).toBeUndefined();
      bodies.push({ code: res.body.code, message: res.body.message, fieldErrors: res.body.fieldErrors });
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('API-GEN-06 the login limit (10 per 15 min per IP + email) still applies, including wrong-form attempts', async () => {
    const { login } = await newStudent();
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await loginAs(
        { email: login, password: i % 2 ? 'wrong-pass-1' : 'student-pass-1', role: 'teacher' },
        ip,
      );
      expect([401, 403]).toContain(res.status);
    }
    const limited = await loginAs({ email: login, password: 'student-pass-1', role: 'student' }, ip).expect(
      429,
    );
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
  });

  it('API-AUTH-01 without a role — staff sign-in as before; a staff-only account in a role form gets the general 401', async () => {
    const support = await loginAs({ email: ACCOUNTS.support, password: DEV_PASSWORD }).expect(200);
    expect(support.body.user.activeRole).toBe('support_agent');
    const res = await loginAs({ email: ACCOUNTS.support, password: DEV_PASSWORD, role: 'teacher' }).expect(
      401,
    );
    expect(res.body.expectedEntry).toBeUndefined();
    await loginAs({ email: ACCOUNTS.support, password: DEV_PASSWORD, role: 'staff' }).expect(400);
  });
});
