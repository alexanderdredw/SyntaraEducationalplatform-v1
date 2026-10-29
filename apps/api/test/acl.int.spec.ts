import request from 'supertest';
import { buildOpenApi } from '../src/setup';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { startStack, type TestStack } from './support/stack';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Operation {
  method: Method;
  path: string;
}

const UNKNOWN_ID = '0190a1b2-0000-7000-8000-000000000000';

/**
 * REQ-NFR-SEC-04, BR-ACL-04: генерируемый тест прав по реестру маршрутов из OpenAPI.
 * Для каждого /api/teacher/* и /api/student/*: без сессии — 401; служебная роль — 403;
 * чужая учебная роль — 403; маршрут с ID: несуществующий или чужой объект — 404.
 * Новые маршруты следующих итераций попадают в проверку автоматически.
 */
describe('REQ-NFR-SEC-04 generated access checks (integration)', () => {
  let stack: TestStack;
  let operations: Operation[];
  let teacherA: Session;
  let teacherB: Session;
  let student: Session;
  let support: Session;
  let foreignClassId: string;
  /** Объекты учителя A по префиксу маршрута — для проверки «чужое → 404» от имени учителя B. */
  const foreign: Array<{ prefix: string; id: () => string }> = [];
  let foreignSubjectId: string;
  let foreignTopicId: string;
  let foreignQuestionId: string;
  let foreignBattleId: string;
  let foreignSessionId: string;
  const http = () => request(stack.app.getHttpServer());

  const call = (op: Operation, path: string, s?: Session) => {
    let req = http()[op.method](path).set('X-Forwarded-For', freshIp());
    if (s) req = req.set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    return op.method === 'get' || op.method === 'delete' ? req : req.send({});
  };
  const fill = (path: string, id: string) => path.replace(/\{[^}]+\}/g, id);

  beforeAll(async () => {
    stack = await startStack('demo');
    const doc = buildOpenApi(stack.app);
    operations = Object.entries(doc.paths).flatMap(([path, item]) =>
      /^\/api\/(teacher|student)\//.test(path)
        ? (['get', 'post', 'put', 'patch', 'delete'] as const)
            .filter((m) => (item as Record<string, unknown>)[m])
            .map((method) => ({ method, path }))
        : [],
    );

    teacherA = await login(http, ACCOUNTS.teacher);
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({
        role: 'teacher',
        email: 'acl.teacher@example.kz',
        displayName: 'ACL',
        password: 'strong-pass-1',
      })
      .expect(201);
    teacherB = await login(http, 'acl.teacher@example.kz', 'strong-pass-1');
    support = await login(http, ACCOUNTS.support);

    const cls = await http()
      .post('/api/teacher/classes')
      .set('Cookie', teacherA.cookie)
      .set('X-CSRF-Token', teacherA.csrf)
      .send({ name: 'ACL' })
      .expect(201);
    foreignClassId = cls.body.id;
    const code = await http()
      .post(`/api/teacher/classes/${foreignClassId}/invite-codes`)
      .set('Cookie', teacherA.cookie)
      .set('X-CSRF-Token', teacherA.csrf)
      .expect(201);
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ code: code.body.code, displayName: 'ACL', login: 'acl.student', password: 'student-pass-1' })
      .expect(201);
    student = await login(http, 'acl.student', 'student-pass-1');

    const asA = (path: string, body: object = {}) =>
      http().post(path).set('Cookie', teacherA.cookie).set('X-CSRF-Token', teacherA.csrf).send(body);
    foreignSubjectId = (
      await asA('/api/teacher/subjects', {
        translations: { ru: { title: 'ACL' } },
        inPublicCatalog: false,
      }).expect(201)
    ).body.id;
    foreignTopicId = (await asA(`/api/teacher/subjects/${foreignSubjectId}/topics`).expect(201)).body.id;
    foreignQuestionId = (
      await asA(`/api/teacher/topics/${foreignTopicId}/quiz/questions`, {
        type: 'text_input',
        difficulty: 'easy',
        translations: { ru: { text: 'ACL?' } },
        textAnswer: 'да',
      }).expect(201)
    ).body.id;
    // Battle-тест учителя A (итерация 10.5, BR-BTL-12).
    foreignBattleId = (await asA('/api/teacher/battles', { title: 'ACL', locale: 'ru' }).expect(201)).body.id;
    await asA(`/api/teacher/battles/${foreignBattleId}/questions`, {
      type: 'true_false',
      text: 'ACL?',
      timeLimitSec: 20,
      options: [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
      ],
    }).expect(201);
    foreignSessionId = (
      await asA(`/api/teacher/battles/${foreignBattleId}/sessions`, { classId: foreignClassId }).expect(201)
    ).body.sessionId;
    foreign.push(
      { prefix: '/api/teacher/classes/', id: () => foreignClassId },
      { prefix: '/api/teacher/subjects/', id: () => foreignSubjectId },
      { prefix: '/api/teacher/topics/', id: () => foreignTopicId },
      { prefix: '/api/teacher/questions/', id: () => foreignQuestionId },
      { prefix: '/api/teacher/battles/', id: () => foreignBattleId },
      { prefix: '/api/teacher/battle-sessions/', id: () => foreignSessionId },
    );
  });

  afterAll(() => stack?.stop());

  it('REQ-NFR-SEC-04 the registry covers the teacher and student routes of this iteration', () => {
    const keys = operations.map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'GET /api/teacher/classes',
        'POST /api/teacher/classes',
        'POST /api/teacher/classes/{id}/invite-codes',
        'POST /api/student/join',
        'GET /api/student/class',
        'POST /api/student/class/leave',
        'GET /api/teacher/subjects',
        'POST /api/teacher/subjects/{id}/access',
        'PUT /api/teacher/topics/{id}',
        'POST /api/teacher/topics/{id}/publish',
        'PUT /api/teacher/questions/{id}',
        'GET /api/teacher/gallery',
        'GET /api/student/catalog',
        'GET /api/student/topics/{id}',
        'GET /api/teacher/battles',
        'GET /api/teacher/battles/{id}',
        'PATCH /api/teacher/battles/{id}/questions/{qid}',
        'POST /api/teacher/battles/{id}/import',
        'GET /api/teacher/battle-sessions/{sid}',
        'POST /api/teacher/battle-sessions/{sid}/start',
        'POST /api/student/battles/join',
        'POST /api/student/battle-sessions/{sid}/answers',
        // docs/TESTS_TZ.md, REQ-TST-04: подсказка «50/50» теста темы (API-S-28) и квиза атласа (API-S-29).
        'POST /api/student/attempts/{id}/hint',
        'POST /api/student/atlas-quiz/{sid}/hint',
        // docs/SCIENTISTS_TZ.md, REQ-SCI-04: «Изучено» учёных (API-S-31, API-S-32).
        'GET /api/student/subjects/{id}/atlas/scientists-progress',
        'PUT /api/student/subjects/{id}/atlas/scientists/{code}/studied',
      ]),
    );
  });

  it('REQ-NFR-SEC-04 every route: guest → 401, staff → 403', async () => {
    for (const op of operations) {
      const path = fill(op.path, UNKNOWN_ID);
      expect((await call(op, path)).status, `guest ${op.method} ${op.path}`).toBe(401);
      expect((await call(op, path, support)).status, `staff ${op.method} ${op.path}`).toBe(403);
    }
  });

  it('BR-ACL-04 learning roles cannot cross: teacher on /student → 403, student on /teacher → 403', async () => {
    for (const op of operations) {
      const path = fill(op.path, UNKNOWN_ID);
      const other = op.path.startsWith('/api/teacher/') ? student : teacherA;
      expect((await call(op, path, other)).status, `${op.method} ${op.path}`).toBe(403);
    }
  });

  it('REQ-NFR-SEC-04, API-GEN-08 routes with an ID: unknown or foreign object → 404', async () => {
    const withId = operations.filter((o) => o.path.includes('{'));
    expect(withId.length).toBeGreaterThan(0);
    for (const op of withId) {
      const owner = op.path.startsWith('/api/teacher/') ? teacherB : student;
      expect((await call(op, fill(op.path, UNKNOWN_ID), owner)).status, `unknown ${op.path}`).toBe(404);
      const own = foreign.find((f) => op.path.startsWith(f.prefix));
      if (own) {
        expect((await call(op, fill(op.path, own.id()), teacherB)).status, `foreign ${op.path}`).toBe(404);
      }
    }
  });
});
