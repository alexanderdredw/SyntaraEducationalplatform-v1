import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { asc, eq, sql } from 'drizzle-orm';
import { schema } from '@syntara/db';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

const { classes, classInviteCodes, classMemberships, battleSessions, battleParticipants } = schema;

/**
 * Q-BTL-01 (решение владельца 2026-10-20): Battle не зависит от классов. Войти может любой вошедший ученик
 * с действующим кодом (BR-BTL-02); запуск — без класса (API-BTL-20); у старых сессий класс сохраняется и виден
 * в истории. Остальные проверки входа (формат кода, выгон, лимит участников, лимит попыток) действуют.
 */
describe('Battle without classes (integration)', () => {
  let stack: TestStack;
  let teacher: Session;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session, ip = freshIp()) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', ip)
        .send(body),
  });

  async function newStudent(name = 'Асель Каримова', code?: string): Promise<Session> {
    const loginName = `scope.${++n}.${randomUUID().slice(0, 6)}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: name, login: loginName, password: 'student-pass-1', ...(code ? { code } : {}) })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  async function newTeacher(): Promise<Session> {
    const email = `scope.t.${randomUUID().slice(0, 8)}@example.kz`;
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email, displayName: 'Учитель', password: 'strong-pass-1' })
      .expect(201);
    return login(http, email, 'strong-pass-1');
  }

  async function newClass(owner: Session, name: string) {
    const id = (await as(owner).post('/api/teacher/classes', { name }).expect(201)).body.id as string;
    const code = (await as(owner).post(`/api/teacher/classes/${id}/invite-codes`).expect(201)).body
      .code as string;
    return { id, code };
  }

  async function newBattle(owner: Session) {
    const id = (await as(owner).post('/api/teacher/battles', { title: 'Сердце', locale: 'ru' }).expect(201))
      .body.id as string;
    await as(owner)
      .post(`/api/teacher/battles/${id}/questions`, {
        type: 'single_choice',
        text: 'Сколько камер в сердце?',
        timeLimitSec: 30,
        options: ['Четыре', 'Две'].map((text, i) => ({ text, isCorrect: i === 0 })),
      })
      .expect(201);
    return id;
  }

  /** API-BTL-20 без класса. */
  const launch = async (owner: Session, battleId: string, body: object = {}) =>
    (await as(owner).post(`/api/teacher/battles/${battleId}/sessions`, body).expect(201)).body as {
      sessionId: string;
      code: string;
    };

  const step = async (owner: Session, sid: string, action: string) => {
    const snap = (await as(owner).get(`/api/teacher/battle-sessions/${sid}`).expect(200)).body;
    return as(owner)
      .post(`/api/teacher/battle-sessions/${sid}/${action}`, { expectedVersion: snap.version })
      .expect(200);
  };

  const classRows = async () => ({
    classes: await stack.db.select().from(classes).orderBy(asc(classes.id)),
    codes: await stack.db.select().from(classInviteCodes).orderBy(asc(classInviteCodes.id)),
    memberships: await stack.db.select().from(classMemberships).orderBy(asc(classMemberships.id)),
  });

  beforeAll(async () => {
    stack = await startStack('demo');
    teacher = await login(http, ACCOUNTS.teacher);
  });

  afterAll(() => stack?.stop());

  it('BR-BTL-02 Q-BTL-01 API-BTL-20, AC-STF-12 launch without a class; a student without a class joins by code and plays to the podium, no XP', async () => {
    const host = await newTeacher();
    const battleId = await newBattle(host);
    const before = await classRows();
    const game = await launch(host, battleId);
    const [row] = await stack.db.select().from(battleSessions).where(eq(battleSessions.id, game.sessionId));
    expect(row!.classId).toBeNull();

    const student = await newStudent('Асель Каримова');
    expect((await as(student).get('/api/student/class').expect(200)).body).toBeNull();
    const joined = await as(student).post('/api/student/battles/join', { code: game.code.toLowerCase() });
    expect(joined.status).toBe(200);
    expect(joined.body.sessionId).toBe(game.sessionId);

    // Имя в рейтинге — «Имя Ф.» (BR-BTL-07).
    const lobby = (await as(host).get(`/api/teacher/battle-sessions/${game.sessionId}`).expect(200)).body;
    expect(lobby.participants.map((p: { displayName: string }) => p.displayName)).toEqual(['Асель К.']);
    expect(lobby.classId).toBeNull();
    expect(lobby.className).toBeNull();

    await step(host, game.sessionId, 'start');
    await as(student)
      .post(`/api/student/battle-sessions/${game.sessionId}/answers`, {
        questionIndex: 0,
        optionPosition: 1,
        clientAnswerId: randomUUID(),
      })
      .expect(200);
    await step(host, game.sessionId, 'close-question').catch(() => undefined); // мог закрыться досрочно
    await step(host, game.sessionId, 'next');

    const results = (
      await as(student).get(`/api/student/battle-sessions/${game.sessionId}/results`).expect(200)
    ).body;
    expect(results.session.status).toBe('finished');
    expect(results.session.className).toBeNull();
    expect(results.podium[0]).toMatchObject({ displayName: 'Асель К.', rank: 1 });
    const mine = (await as(student).get('/api/student/battle-sessions').expect(200)).body;
    expect(mine.items.map((i: { id: string }) => i.id)).toContain(game.sessionId);
    const history = (await as(host).get('/api/teacher/battle-sessions').expect(200)).body;
    expect(history.items[0]).toMatchObject({ id: game.sessionId, className: null, status: 'finished' });
    // AC-STF-12: XP за Battle не начисляется (7.12; вопрос владельцу — SPEC 8.4.9).
    expect((await as(student).get('/api/me/stats').expect(200)).body.xpTotal).toBe(0);

    // Существующие классы, коды и ученики не меняются.
    expect(await classRows()).toEqual(before);
  });

  it('BR-BTL-02 a student of another teacher’s class joins; a client that still sends classId gets a session without a class', async () => {
    const host = await newTeacher();
    const otherTeacher = await newTeacher();
    const otherClass = await newClass(otherTeacher, '11 «Б»');
    const own = await newClass(host, '5 «А»');
    const game = await launch(host, await newBattle(host), { classId: own.id });
    const [row] = await stack.db.select().from(battleSessions).where(eq(battleSessions.id, game.sessionId));
    expect(row!.classId).toBeNull();

    const outsider = await newStudent('Ержан Сейтов', otherClass.code);
    await as(outsider).post('/api/student/battles/join', { code: game.code }).expect(200);
    const classmate = await newStudent('Дана', own.code);
    await as(classmate).post('/api/student/battles/join', { code: game.code }).expect(200);
    const snap = (await as(host).get(`/api/teacher/battle-sessions/${game.sessionId}`).expect(200)).body;
    expect(snap.participants.map((p: { displayName: string }) => p.displayName).sort()).toEqual([
      'Дана',
      'Ержан С.',
    ]);
  });

  it('BR-CODE-02 a class code still never joins a Battle; unknown code — codeNotFound', async () => {
    const host = await newTeacher();
    const cls = await newClass(host, '7 «В»');
    await launch(host, await newBattle(host));
    const student = await newStudent();
    const wrong = await as(student).post('/api/student/battles/join', { code: cls.code }).expect(422);
    expect(wrong.body.fieldErrors).toEqual({ battle: 'invalidBattleCode' });
    const unknown = await as(student).post('/api/student/battles/join', { code: 'ZZZ999' }).expect(404);
    expect(unknown.body.fieldErrors).toEqual({ battle: 'codeNotFound' });
    expect(
      await stack.db
        .select()
        .from(battleParticipants)
        .where(eq(battleParticipants.studentId, student.userId)),
    ).toHaveLength(0);
  });

  it('BR-BTL-07 AC-BTL-15 the teacher kicks a participant — they cannot return; max participants and late join still apply', async () => {
    const host = await newTeacher();
    const game = await launch(host, await newBattle(host), { settings: { maxParticipants: 2 } });
    const [a, b, c] = [
      await newStudent('Асель Каримова'),
      await newStudent('Ержан'),
      await newStudent('Дана'),
    ];
    await as(a).post('/api/student/battles/join', { code: game.code }).expect(200);
    await as(b).post('/api/student/battles/join', { code: game.code }).expect(200);
    const full = await as(c).post('/api/student/battles/join', { code: game.code }).expect(409);
    expect(full.body.fieldErrors.battle).toBe('full');

    const snap = (await as(host).get(`/api/teacher/battle-sessions/${game.sessionId}`).expect(200)).body;
    const aId = snap.participants.find((p: { displayName: string }) => p.displayName === 'Асель К.').id;
    await as(host)
      .post(`/api/teacher/battle-sessions/${game.sessionId}/participants/${aId}/kick`)
      .expect(200);
    const kicked = await as(a).post('/api/student/battles/join', { code: game.code }).expect(409);
    expect(kicked.body.fieldErrors.battle).toBe('kicked');

    await step(host, game.sessionId, 'start');
    const late = await as(c).post('/api/student/battles/join', { code: game.code }).expect(409);
    expect(late.body.fieldErrors.battle).toBe('alreadyStarted');
  });

  it('API-GEN-06 BR-BTL-01 Battle code attempts: 10 per 10 minutes per student, 30 per IP', async () => {
    const student = await newStudent();
    for (let i = 0; i < 10; i++)
      await as(student).post('/api/student/battles/join', { code: 'ZZZ999' }).expect(404);
    const limited = await as(student).post('/api/student/battles/join', { code: 'ZZZ999' }).expect(429);
    expect(limited.body.retryAfterSeconds).toBeGreaterThan(0);

    const ip = freshIp();
    const students = [await newStudent(), await newStudent(), await newStudent(), await newStudent()];
    for (let i = 0; i < 30; i++)
      await as(students[i % 3]!, ip)
        .post('/api/student/battles/join', { code: 'ZZZ999' })
        .expect(404);
    await as(students[3]!, ip).post('/api/student/battles/join', { code: 'ZZZ999' }).expect(429);
  });

  it('REQ-BTL-T09 old sessions launched for a class keep the class and show it in history and results', async () => {
    const host = await newTeacher();
    const cls = await newClass(host, '8 «Г»');
    const game = await launch(host, await newBattle(host));
    // Имитация сессии, запущенной до решения Q-BTL-01: класс сохранён в строке.
    await stack.db
      .update(battleSessions)
      .set({ classId: cls.id })
      .where(eq(battleSessions.id, game.sessionId));
    await step(host, game.sessionId, 'cancel');

    const history = (await as(host).get('/api/teacher/battle-sessions').expect(200)).body;
    expect(history.items[0]).toMatchObject({ id: game.sessionId, className: '8 «Г»' });
    const snap = (await as(host).get(`/api/teacher/battle-sessions/${game.sessionId}`).expect(200)).body;
    expect(snap).toMatchObject({ classId: cls.id, className: '8 «Г»' });
    const results = (await as(host).get(`/api/teacher/battle-sessions/${game.sessionId}/results`).expect(200))
      .body;
    expect(results.session.className).toBe('8 «Г»');
    // Фильтра по классу больше нет — параметр игнорируется.
    const all = (await as(host).get(`/api/teacher/battle-sessions?classId=${randomUUID()}`).expect(200)).body;
    expect(all.items.map((i: { id: string }) => i.id)).toContain(game.sessionId);
  });

  it('BR-BTL-12 RLS: a student sees a session where they participate, without any class condition', async () => {
    const host = await newTeacher();
    const game = await launch(host, await newBattle(host));
    const [player, stranger] = [await newStudent(), await newStudent()];
    await as(player).post('/api/student/battles/join', { code: game.code }).expect(200);
    const visibleTo = (userId: string) =>
      stack.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE app_user`);
        await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
        const rows = await tx
          .select({ id: battleSessions.id })
          .from(battleSessions)
          .where(eq(battleSessions.id, game.sessionId));
        return rows.length;
      });
    expect(await visibleTo(player.userId)).toBe(1);
    expect(await visibleTo(host.userId)).toBe(1);
    expect(await visibleTo(stranger.userId)).toBe(0);
    // Права ведущего — как раньше: другой учитель получает 404.
    await as(teacher).get(`/api/teacher/battle-sessions/${game.sessionId}`).expect(404);
  });
});
