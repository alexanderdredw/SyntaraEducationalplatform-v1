import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { DEMO_IDS } from '@syntara/db/seed';
import { VisibilityService } from '../src/modules/content/visibility.service';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

describe('classes and joining (integration)', () => {
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

  async function newClass(name: string): Promise<{ id: string; code: string }> {
    const created = await as(teacher).post('/api/teacher/classes', { name }).expect(201);
    const issued = await as(teacher).post(`/api/teacher/classes/${created.body.id}/invite-codes`).expect(201);
    return { id: created.body.id, code: issued.body.code };
  }

  const registerStudent = (body: object) =>
    http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .set('Accept-Language', 'ru')
      .send(body);

  async function studentWithClass(
    loginName: string,
  ): Promise<{ session: Session; userId: string; classId: string; code: string }> {
    const cls = await newClass(`Класс ${loginName}`);
    const res = await registerStudent({
      code: cls.code,
      displayName: 'Ученик',
      login: loginName,
      password: 'student-pass-1',
    }).expect(201);
    const session = await login(http, loginName, 'student-pass-1');
    return { session, userId: res.body.user.id, classId: cls.id, code: cls.code };
  }

  beforeAll(async () => {
    stack = await startStack('demo');
    teacher = await login(http, ACCOUNTS.teacher);
  });

  afterAll(() => stack?.stop());

  it('API-T-05, API-T-04 teacher creates classes and sees only own ones with student counts', async () => {
    const created = await as(teacher).post('/api/teacher/classes', { name: '7 «А»' }).expect(201);
    expect(created.body).toEqual({ id: expect.any(String), name: '7 «А»', studentsCount: 0 });
    const list = await as(teacher).get('/api/teacher/classes').expect(200);
    expect(list.body).toContainEqual({ id: created.body.id, name: '7 «А»', studentsCount: 0 });
    await as(teacher)
      .post('/api/teacher/classes', { name: 'x'.repeat(51) })
      .expect(400);

    const other = await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({
        role: 'teacher',
        email: 'other.teacher@example.kz',
        displayName: 'Other',
        password: 'strong-pass-1',
      })
      .expect(201);
    expect(other.body.user.roles).toEqual(['teacher']);
    const otherSession = await login(http, 'other.teacher@example.kz', 'strong-pass-1');
    expect((await as(otherSession).get('/api/teacher/classes').expect(200)).body).toEqual([]);
  });

  it('API-T-06, BR-CLS-01, REQ-NFR-SEC-02 code: 6 chars of PH-07 alphabet, 30 days, stored only as a hash', async () => {
    const { id, code } = await newClass('8');
    expect(code).toMatch(new RegExp(`^[${ALPHABET}]{6}$`));
    const [row] = await stack.db
      .select()
      .from(schema.classInviteCodes)
      .where(eq(schema.classInviteCodes.classId, id));
    expect(row!.codeHash.length).toBe(32);
    expect(row!.codeHash.toString('utf8')).not.toContain(code);
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('BR-ACL-02, API-GEN-08 a foreign or unknown class → 404', async () => {
    const otherSession = await login(http, 'other.teacher@example.kz', 'strong-pass-1');
    const { id } = await newClass('9');
    await as(otherSession).post(`/api/teacher/classes/${id}/invite-codes`).expect(404);
    await as(teacher)
      .post('/api/teacher/classes/0190a1b2-0000-7000-8000-000000000000/invite-codes')
      .expect(404);
  });

  it('AC-AUTH-01, API-PUB-08 code check: only `valid`, no class data; input is normalized', async () => {
    const { code } = await newClass('10');
    const ok = await http()
      .post('/api/public/join/check')
      .set('X-Forwarded-For', freshIp())
      .send({ code })
      .expect(200);
    expect(ok.body).toEqual({ valid: true });
    const messy = ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3).toLowerCase()} `;
    expect(
      (await http().post('/api/public/join/check').set('X-Forwarded-For', freshIp()).send({ code: messy }))
        .body,
    ).toEqual({ valid: true });
    for (const bad of ['ZZZZZZ', '1111', 'IOIOIO', '']) {
      expect(
        (await http().post('/api/public/join/check').set('X-Forwarded-For', freshIp()).send({ code: bad }))
          .body,
      ).toEqual({ valid: false });
    }
  });

  it('BR-CLS-01 expired and deactivated codes are not valid', async () => {
    const { id, code } = await newClass('11');
    await stack.db
      .update(schema.classInviteCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.classInviteCodes.classId, id));
    expect(
      (await http().post('/api/public/join/check').set('X-Forwarded-For', freshIp()).send({ code })).body,
    ).toEqual({ valid: false });
  });

  it('AC-AUTH-03 11th code check within 15 minutes → 429 with retryAfterSeconds', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++)
      await http()
        .post('/api/public/join/check')
        .set('X-Forwarded-For', ip)
        .send({ code: 'AAAAAA' })
        .expect(200);
    const limited = await http()
      .post('/api/public/join/check')
      .set('X-Forwarded-For', ip)
      .send({ code: 'AAAAAA' })
      .expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(60);
    expect(limited.body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('PH-44 student sign-up with a valid code: child-safe account, consent, active membership; login by login', async () => {
    const { code, id: classId } = await newClass('12');
    const res = await registerStudent({
      code: code.toLowerCase(),
      displayName: 'Асель',
      login: 'Asel.K',
      password: 'student-pass-1',
    }).expect(201);
    expect(res.body.user).toMatchObject({ roles: ['student'], activeRole: 'student', displayName: 'Асель' });
    const id = res.body.user.id as string;
    const [user] = await stack.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(user).toMatchObject({ login: 'asel.k', email: null, isChildSafe: true });
    expect(await stack.db.select().from(schema.consents).where(eq(schema.consents.userId, id))).toHaveLength(
      1,
    );
    const memberships = await stack.db
      .select()
      .from(schema.classMemberships)
      .where(eq(schema.classMemberships.studentId, id));
    expect(memberships).toEqual([expect.objectContaining({ classId, status: 'active' })]);

    const session = await login(http, 'ASEL.K', 'student-pass-1');
    expect((await as(session).get('/api/student/class').expect(200)).body).toEqual({
      classId,
      className: '12',
      teacherName: 'Demo Teacher',
      schoolName: null,
    });
  });

  it('PH-44 invalid or expired code → 404 and no account; taken login → 409; optional email is stored', async () => {
    const before = await stack.db.select().from(schema.users);
    const bad = await registerStudent({
      code: 'ZZZZZZ',
      displayName: 'X',
      login: 'nobody1',
      password: 'student-pass-1',
    }).expect(404);
    expect(bad.body.code).toBe('NOT_FOUND');
    expect(JSON.stringify(bad.body)).not.toMatch(/class/i);
    expect(await stack.db.select().from(schema.users)).toHaveLength(before.length);

    const { code } = await newClass('13');
    await registerStudent({ code, displayName: 'A', login: 'twin', password: 'student-pass-1' }).expect(201);
    const dup = await registerStudent({
      code,
      displayName: 'B',
      login: 'TWIN',
      password: 'student-pass-1',
    }).expect(409);
    expect(dup.body.fieldErrors).toEqual({ login: 'loginTaken' });
    const badLogin = await registerStudent({
      code,
      displayName: 'B',
      login: 'a b',
      password: 'student-pass-1',
    }).expect(400);
    expect(badLogin.body.fieldErrors).toEqual({ login: 'invalidLogin' });

    const withEmail = await registerStudent({
      code,
      displayName: 'C',
      login: 'with.mail',
      password: 'student-pass-1',
      email: 'kid@example.kz',
    }).expect(201);
    const [user] = await stack.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, withEmail.body.user.id));
    expect(user).toMatchObject({ email: 'kid@example.kz', isChildSafe: false });
  });

  it('AC-AUTH-02, BR-CLS-02 confirming twice keeps one active membership', async () => {
    const { session, userId } = await studentWithClass('double');
    const second = await newClass('14');
    const first = await as(session).post('/api/student/join', { code: second.code }).expect(200);
    expect(first.body).toMatchObject({ classId: second.id, className: '14' });
    await as(session).post('/api/student/join', { code: second.code }).expect(200);
    const rows = await stack.db
      .select()
      .from(schema.classMemberships)
      .where(
        and(eq(schema.classMemberships.studentId, userId), eq(schema.classMemberships.classId, second.id)),
      );
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
    await as(session).post('/api/student/join', { code: 'ZZZZZZ' }).expect(404);
  });

  it('AC-AUTH-04, BR-CLS-03 leave: membership left, class subjects closed (BR-VIS-01), results kept, audited', async () => {
    const { session, userId, classId } = await studentWithClass('leaver');
    // Предмет учителя (не в общем каталоге) с опубликованной темой, выданный классу.
    const [subject] = await stack.db
      .insert(schema.subjects)
      .values({ ownerId: DEMO_IDS.teacher, inPublicCatalog: false })
      .returning();
    const [topic] = await stack.db
      .insert(schema.topics)
      .values({ subjectId: subject!.id, position: 1, status: 'published' })
      .returning();
    await stack.db
      .insert(schema.classSubjectAccess)
      .values({ classId, subjectId: subject!.id, grantedBy: DEMO_IDS.teacher });
    await stack.db.insert(schema.studentStats).values({ studentId: userId, xpTotal: 40 });
    const visibility = stack.app.get(VisibilityService);
    expect(await visibility.canStudentSeeTopic(userId, topic!.id)).toBe(true);

    await as(session).post('/api/student/class/leave').expect(204);
    expect((await as(session).get('/api/student/class').expect(200)).body).toBeNull();
    const [membership] = await stack.db
      .select()
      .from(schema.classMemberships)
      .where(eq(schema.classMemberships.studentId, userId));
    expect(membership).toMatchObject({ status: 'left' });
    expect(membership!.leftAt).toBeInstanceOf(Date);
    expect(await visibility.canStudentSeeTopic(userId, topic!.id)).toBe(false);
    const [stats] = await stack.db
      .select()
      .from(schema.studentStats)
      .where(eq(schema.studentStats.studentId, userId));
    expect(stats!.xpTotal).toBe(40);
    await as(session).post('/api/student/class/leave').expect(404);

    const audit = await stack.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, membership!.id));
    expect(audit.map((a) => a.action)).toEqual(['join', 'leave']);
  });

  it('BR-ACL-04 roles: student cannot use teacher routes, teacher/staff cannot use student routes', async () => {
    const { session } = await studentWithClass('roles');
    await as(session).get('/api/teacher/classes').expect(403);
    await as(teacher).get('/api/student/class').expect(403);
    const support = await login(http, ACCOUNTS.support);
    await as(support).get('/api/teacher/classes').expect(403);
    await as(support).get('/api/student/class').expect(403);
    await http().get('/api/teacher/classes').expect(401);
  });
});
