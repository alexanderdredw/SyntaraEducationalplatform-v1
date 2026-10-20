import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { asc, eq } from 'drizzle-orm';
import { BATTLE_CODE_RE } from '@syntara/shared';
import { schema } from '@syntara/db';
import { anonymizeStudentBattles, expireSessions } from '@syntara/db/battle';
import { generateBattleCode } from '../src/modules/battle/battle-code';
import { ClassCodesService } from '../src/modules/classes/class-codes.service';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

// Генератор кода Battle подменяется только там, где тест задаёт код явно (принудительное совпадение).
vi.mock('../src/modules/battle/battle-code', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/modules/battle/battle-code')>();
  return { ...original, generateBattleCode: vi.fn(original.generateBattleCode) };
});

const {
  classes,
  classInviteCodes,
  classMemberships,
  battleQuizzes,
  battleQuestions,
  battleOptions,
  battleSessions,
  battleParticipants,
  battleAnswers,
} = schema;

/**
 * CODES_TZ (BR-CODE-01…06, AC-CODE-01…08): код класса и код Battle — независимые подсистемы. Вход принимает только
 * свой тип кода, «не туда» — подсказка без данных; активные коды не совпадают; операции одной подсистемы не меняют
 * строк другой; лимиты попыток раздельные.
 */
describe('Class codes and Battle codes are independent (integration)', () => {
  let stack: TestStack;
  let teacher: Session;
  let n = 0;
  let seeded: Awaited<ReturnType<typeof classRows>>;
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

  async function newClass(name: string) {
    const id = (await as(teacher).post('/api/teacher/classes', { name }).expect(201)).body.id as string;
    const code = (await as(teacher).post(`/api/teacher/classes/${id}/invite-codes`).expect(201)).body
      .code as string;
    return { id, code };
  }

  async function newStudent(code?: string): Promise<Session> {
    const loginName = `codes.${++n}.${randomUUID().slice(0, 6)}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({
        displayName: 'Асель Каримова',
        login: loginName,
        password: 'student-pass-1',
        ...(code ? { code } : {}),
      })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  async function newBattle() {
    const id = (await as(teacher).post('/api/teacher/battles', { title: 'Коды', locale: 'ru' }).expect(201))
      .body.id as string;
    await as(teacher)
      .post(`/api/teacher/battles/${id}/questions`, {
        type: 'single_choice',
        text: 'Вопрос',
        timeLimitSec: 30,
        options: [1, 2].map((p) => ({ text: `Ответ ${p}`, isCorrect: p === 1 })),
      })
      .expect(201);
    return id;
  }

  const launch = (battleId: string, classId: string) =>
    as(teacher).post(`/api/teacher/battles/${battleId}/sessions`, { classId });

  const step = async (sid: string, action: string) => {
    const snap = (await as(teacher).get(`/api/teacher/battle-sessions/${sid}`).expect(200)).body;
    return as(teacher)
      .post(`/api/teacher/battle-sessions/${sid}/${action}`, { expectedVersion: snap.version })
      .expect(200);
  };

  const memberships = (studentId: string) =>
    stack.db.select().from(classMemberships).where(eq(classMemberships.studentId, studentId));

  /** Снимок всех строк подсистемы классов (BR-CODE-01.2). */
  const classRows = async () => ({
    classes: await stack.db.select().from(classes).orderBy(asc(classes.id)),
    codes: await stack.db.select().from(classInviteCodes).orderBy(asc(classInviteCodes.id)),
    memberships: await stack.db.select().from(classMemberships).orderBy(asc(classMemberships.id)),
  });

  /** Снимок всех строк подсистемы Battle (BR-CODE-01.3). */
  const battleRows = async () => ({
    quizzes: await stack.db.select().from(battleQuizzes).orderBy(asc(battleQuizzes.id)),
    questions: await stack.db.select().from(battleQuestions).orderBy(asc(battleQuestions.id)),
    options: await stack.db.select().from(battleOptions).orderBy(asc(battleOptions.id)),
    sessions: await stack.db.select().from(battleSessions).orderBy(asc(battleSessions.id)),
    participants: await stack.db.select().from(battleParticipants).orderBy(asc(battleParticipants.id)),
    answers: await stack.db.select().from(battleAnswers).orderBy(asc(battleAnswers.id)),
  });

  /** Код класса, вставленный напрямую (имитация старого кода, выпущенного до BR-CODE-03). */
  async function legacyClassCode(classId: string, code: string) {
    await stack.db.insert(classInviteCodes).values({
      classId,
      codeHash: stack.app.get(ClassCodesService).hash(code),
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      createdBy: teacher.userId,
    });
  }

  beforeAll(async () => {
    stack = await startStack('demo');
    // Уже существующие данные: класс с учениками и кодом — до всех проверок (BR-CODE-05).
    teacher = await login(http, ACCOUNTS.teacher);
    const existing = await newClass('Существующий класс');
    await newStudent(existing.code);
    await newStudent(existing.code);
    seeded = await classRows();
  });

  // Отдельный учитель на каждый тест: не больше 3 активных сессий у учителя (BR-BTL-05).
  beforeEach(async () => {
    const email = `codes.t.${randomUUID().slice(0, 8)}@example.kz`;
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ role: 'teacher', email, displayName: 'Учитель', password: 'strong-pass-1' })
      .expect(201);
    teacher = await login(http, email, 'strong-pass-1');
  });

  afterAll(() => stack?.stop());

  afterEach(() => vi.mocked(generateBattleCode).mockReset());

  it('BR-CODE-02 BR-CODE-04 AC-CODE-01 AC-CODE-07 a Battle code never joins a class: isBattleCode on every class entry', async () => {
    const cls = await newClass('Коды 1');
    const { code } = (await launch(await newBattle(), cls.id).expect(201)).body;
    const student = await newStudent();

    const joined = await as(student).post('/api/student/join', { code }).expect(404);
    expect(joined.body.fieldErrors).toEqual({ code: 'isBattleCode' });
    // Подсказка не раскрывает данных о классе или сессии (BR-CODE-04.3).
    expect(JSON.stringify(joined.body)).not.toContain(cls.id);
    expect(JSON.stringify(joined.body)).not.toContain('Коды');
    expect(await memberships(student.userId)).toHaveLength(0);

    const checked = await http()
      .post('/api/public/join/check')
      .set('X-Forwarded-For', freshIp())
      .send({ code: code.toLowerCase() })
      .expect(404);
    expect(checked.body.fieldErrors).toEqual({ code: 'isBattleCode' });

    const loginName = `codes.reg.${randomUUID().slice(0, 6)}`;
    const registered = await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: 'Ержан', login: loginName, password: 'student-pass-1', code })
      .expect(400);
    expect(registered.body.fieldErrors).toEqual({ code: 'isBattleCode' });
    expect(await stack.db.select().from(schema.users).where(eq(schema.users.login, loginName))).toHaveLength(
      0,
    );
  });

  it('BR-CODE-02 BR-CODE-04 AC-CODE-02 a class code never joins a Battle: invalidBattleCode before the DB, isClassCode for an LLLDDD class code', async () => {
    const cls = await newClass('Коды 2');
    await launch(await newBattle(), cls.id).expect(201);
    const student = await newStudent(cls.code);

    // Обычный код класса (PH-07) — не формат Battle: 422 без поиска сессии.
    const wrongFormat = await as(student).post('/api/student/battles/join', { code: cls.code }).expect(422);
    expect(wrongFormat.body.fieldErrors).toEqual({ battle: 'invalidBattleCode' });
    const dashed = await as(student).post('/api/student/battles/join', { code: 'ab-12' }).expect(422);
    expect(dashed.body.fieldErrors).toEqual({ battle: 'invalidBattleCode' });

    // Старый код класса вида LLLDDD — подсказка isClassCode без данных класса.
    await legacyClassCode(cls.id, 'QWE234');
    const hint = await as(student).post('/api/student/battles/join', { code: 'qwe-234' }).expect(404);
    expect(hint.body.fieldErrors).toEqual({ battle: 'isClassCode' });
    expect(JSON.stringify(hint.body)).not.toContain(cls.id);
    expect(
      await stack.db
        .select()
        .from(battleParticipants)
        .where(eq(battleParticipants.studentId, student.userId)),
    ).toHaveLength(0);
  });

  it('BR-CODE-03 BR-CODE-05 AC-CODE-04 AC-CODE-06 forced collision: an old class code KTR583 is never issued to Battle, still joins the class', async () => {
    const cls = await newClass('Коды 3');
    await legacyClassCode(cls.id, 'KTR583');
    const battleId = await newBattle();

    // Генератор Battle выдаёт KTR583 — код отбрасывается, сессия получает другой код.
    vi.mocked(generateBattleCode).mockReturnValueOnce('KTR583');
    const created = (await launch(battleId, cls.id).expect(201)).body;
    expect(created.code).not.toBe('KTR583');
    expect(created.code).toMatch(BATTLE_CODE_RE);
    await step(created.sessionId, 'cancel');

    // Генератор всё время выдаёт KTR583 — 10 попыток, затем 503 (BR-CODE-03.2).
    vi.mocked(generateBattleCode).mockReturnValue('KTR583');
    const exhausted = await launch(battleId, cls.id).expect(503);
    expect(exhausted.body.fieldErrors).toEqual({ battle: 'codeUnavailable' });
    expect(vi.mocked(generateBattleCode).mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(
      await stack.db.select().from(battleSessions).where(eq(battleSessions.code, 'KTR583')),
    ).toHaveLength(0);

    // Вступление по KTR583 идёт в класс; подключение к Battle по KTR583 — подсказка isClassCode.
    const student = await newStudent();
    const joined = await as(student).post('/api/student/join', { code: 'ktr583' }).expect(200);
    expect(joined.body.classId).toBe(cls.id);
    const battle = await as(student).post('/api/student/battles/join', { code: 'KTR583' }).expect(404);
    expect(battle.body.fieldErrors).toEqual({ battle: 'isClassCode' });
  });

  it('BR-CODE-01 AC-CODE-05 a full Battle cycle (create → game → finish, cancel, expiry, anonymization) changes no class rows', async () => {
    const cls = await newClass('Коды 4');
    const [a, b] = [await newStudent(cls.code), await newStudent(cls.code)];
    const battleId = await newBattle();
    const before = await classRows();

    const game = (await launch(battleId, cls.id).expect(201)).body;
    await as(a).post('/api/student/battles/join', { code: game.code }).expect(200);
    await as(b).post('/api/student/battles/join', { code: game.code.toLowerCase() }).expect(200);
    await step(game.sessionId, 'start');
    await as(a)
      .post(`/api/student/battle-sessions/${game.sessionId}/answers`, {
        questionIndex: 0,
        optionPosition: 1,
        clientAnswerId: randomUUID(),
      })
      .expect(200);
    await step(game.sessionId, 'close-question');
    await step(game.sessionId, 'finish');

    const cancelled = (await launch(battleId, cls.id).expect(201)).body;
    await step(cancelled.sessionId, 'cancel');

    const stale = (await launch(battleId, cls.id).expect(201)).body;
    await stack.db
      .update(battleSessions)
      .set({ createdAt: new Date(Date.now() - 61 * 60_000) })
      .where(eq(battleSessions.id, stale.sessionId));
    const expired = await expireSessions(stack.db);
    expect(expired.some((r) => r.session?.id === stale.sessionId)).toBe(true);
    await anonymizeStudentBattles(stack.db, a.userId);

    expect(await classRows()).toEqual(before);
  });

  it('BR-CODE-01 AC-CODE-05 issuing a class code, joining and leaving a class change no battle_* rows', async () => {
    const cls = await newClass('Коды 5');
    const game = (await launch(await newBattle(), cls.id).expect(201)).body;
    const player = await newStudent(cls.code);
    await as(player).post('/api/student/battles/join', { code: game.code }).expect(200);
    const before = await battleRows();

    const code = (await as(teacher).post(`/api/teacher/classes/${cls.id}/invite-codes`).expect(201)).body
      .code;
    expect(code).not.toMatch(BATTLE_CODE_RE);
    const student = await newStudent();
    await as(student).post('/api/student/join', { code }).expect(200);
    await as(student).post('/api/student/class/leave').expect(204);
    await as(player).post('/api/student/class/leave').expect(204);

    expect(await battleRows()).toEqual(before);
  });

  it('BR-CODE-06 AC-CODE-08 rate limits are separate: an exhausted class-code limit does not block Battle codes and vice versa', async () => {
    const cls = await newClass('Коды 6');
    const game = (await launch(await newBattle(), cls.id).expect(201)).body;

    // Лимит кода класса (10 за 15 минут на IP) исчерпан — ввод кода Battle с того же IP работает.
    const ip = freshIp();
    const student = await newStudent(cls.code);
    for (let i = 0; i < 10; i++)
      await http()
        .post('/api/public/join/check')
        .set('X-Forwarded-For', ip)
        .send({ code: 'AAAAAA' })
        .expect(200);
    await as(student, ip).post('/api/student/join', { code: 'AAAAAA' }).expect(429);
    await as(student, ip).post('/api/student/battles/join', { code: game.code }).expect(200);

    // Лимит кода Battle (10 за 10 минут на ученика) исчерпан — ввод кода класса работает.
    const other = await newStudent();
    for (let i = 0; i < 10; i++)
      await as(other).post('/api/student/battles/join', { code: 'ZZZ999' }).expect(404);
    await as(other).post('/api/student/battles/join', { code: game.code }).expect(429);
    const joined = await as(other).post('/api/student/join', { code: cls.code }).expect(200);
    expect(joined.body.classId).toBe(cls.id);
  });

  it('BR-CODE-05 AC-CODE-06 seeded classes, their codes and memberships are untouched after all tests', async () => {
    expect(seeded.classes.length).toBeGreaterThan(0);
    expect(seeded.memberships.length).toBeGreaterThan(0);
    const now = await classRows();
    expect(now.classes).toEqual(expect.arrayContaining(seeded.classes));
    expect(now.codes).toEqual(expect.arrayContaining(seeded.codes));
    expect(now.memberships).toEqual(expect.arrayContaining(seeded.memberships));
  });
});
