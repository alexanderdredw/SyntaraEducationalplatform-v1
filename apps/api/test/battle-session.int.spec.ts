import { randomUUID } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import request from 'supertest';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { and, eq, sql } from 'drizzle-orm';
import { BATTLE_CODE_RE, rankBattle, scoreBattleAnswers } from '@syntara/shared';
import { schema } from '@syntara/db';
import {
  BATTLE_QUEUE,
  battleChannel,
  type BattleTimer,
  battleTimerJob,
  expireSessions,
  runBattleTimer,
} from '@syntara/db/battle';
import { ACCOUNTS, freshIp, login, type Session } from './support/session';
import { openSse, type SseClient, type SseEvent } from './support/sse';
import { startStack, type TestStack } from './support/stack';

const { battleAnswers, battleParticipants, battleSessions, auditLog } = schema;

/**
 * Итерация 10.5, этап B2 — движок и реальное время (SM-BTL, BR-BTL-01…08, API-BTL-20…31, 40…46, 6.9):
 * «1 ведущий + 30 ботов» проходят полную игру через SSE; рейтинг совпадает с эталонным расчётом по battle_answers;
 * идемпотентность, поздние ответы, staleState, kicked / full / alreadyStarted, чужой класс, таймер worker.
 */
describe('Battle engine and realtime (integration)', () => {
  let stack: TestStack;
  let base: string;
  let teacher: Session;
  let other: Session;
  let worker: Worker;
  let workerRedis: Redis;
  let publisher: Redis;
  let n = 0;
  const http = () => request(stack.app.getHttpServer());
  const as = (s: Session) => ({
    get: (path: string) => http().get(path).set('Cookie', s.cookie).set('Accept-Language', 'ru'),
    post: (path: string, body: object = {}) =>
      http()
        .post(path)
        .set('Cookie', s.cookie)
        .set('X-CSRF-Token', s.csrf)
        .set('X-Forwarded-For', freshIp())
        .set('Accept-Language', 'ru')
        .send(body),
  });
  const streams: SseClient[] = [];
  const sse = (s: Session, path: string) => {
    const client = openSse(`${base}${path}`, s.cookie);
    streams.push(client);
    return client;
  };
  const ofType =
    (type: string, pred: (d: Record<string, unknown>) => boolean = () => true) =>
    (e: SseEvent) =>
      e.type === type && pred(e.data as Record<string, unknown>);

  async function newStudent(code: string | undefined, name: string): Promise<Session> {
    const loginName = `btl.${++n}.${randomUUID().slice(0, 6)}`;
    await http()
      .post('/api/auth/register-student')
      .set('X-Forwarded-For', freshIp())
      .send({ displayName: name, login: loginName, password: 'student-pass-1', ...(code ? { code } : {}) })
      .expect(201);
    return login(http, loginName, 'student-pass-1');
  }

  async function newClass(owner: Session, name: string) {
    const id = (await as(owner).post('/api/teacher/classes', { name }).expect(201)).body.id as string;
    const code = (await as(owner).post(`/api/teacher/classes/${id}/invite-codes`).expect(201)).body
      .code as string;
    return { id, code };
  }

  /** Тест из `count` вопросов «выбор варианта»; правильный — вариант 1 (позиция 1). */
  async function newBattle(owner: Session, count: number, timeLimitSec = 30) {
    const id = (await as(owner).post('/api/teacher/battles', { title: 'Сердце', locale: 'ru' }).expect(201))
      .body.id;
    for (let i = 1; i <= count; i++) {
      await as(owner)
        .post(`/api/teacher/battles/${id}/questions`, {
          type: 'single_choice',
          text: `Вопрос ${i}`,
          timeLimitSec,
          options: [1, 2, 3, 4].map((p) => ({ text: `Ответ ${i}.${p}`, isCorrect: p === 1 })),
        })
        .expect(201);
    }
    return id as string;
  }

  const snapshot = async (sid: string) =>
    (await as(teacher).get(`/api/teacher/battle-sessions/${sid}`).expect(200)).body;
  const go = async (sid: string, action: string, owner = teacher) => {
    const s = (await as(owner).get(`/api/teacher/battle-sessions/${sid}`).expect(200)).body;
    return as(owner).post(`/api/teacher/battle-sessions/${sid}/${action}`, { expectedVersion: s.version });
  };
  const goOk = async (sid: string, action: string) => {
    const res = await go(sid, action);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    return res;
  };
  const answer = (
    s: Session,
    sid: string,
    questionIndex: number,
    optionPosition: number,
    clientAnswerId = randomUUID(),
  ) =>
    as(s).post(`/api/student/battle-sessions/${sid}/answers`, {
      questionIndex,
      optionPosition,
      clientAnswerId,
    });

  beforeAll(async () => {
    stack = await startStack('demo');
    await stack.app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(stack.app.getHttpServer().address() as AddressInfo).port}`;
    teacher = await login(http, ACCOUNTS.teacher);
    await http()
      .post('/api/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({
        role: 'teacher',
        email: 'btl.other@example.kz',
        displayName: 'Другой',
        password: 'strong-pass-1',
      })
      .expect(201);
    other = await login(http, 'btl.other@example.kz', 'strong-pass-1');
    // Worker очереди battle (как apps/worker): тот же идемпотентный переход и публикация в Redis.
    workerRedis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    publisher = new Redis(process.env.REDIS_URL!);
    const { Queue } = await import('bullmq');
    const queue = new Queue(BATTLE_QUEUE, { connection: workerRedis });
    worker = new Worker(
      BATTLE_QUEUE,
      async (job) => {
        const result = await runBattleTimer(stack.db, job.data as BattleTimer);
        if (!result.changed) return;
        for (const e of result.events) await publisher.publish(battleChannel(e.sessionId), JSON.stringify(e));
        for (const t of result.timers) {
          const next = battleTimerJob(t);
          await queue.add(next.name, next.data, next.opts);
        }
      },
      { connection: workerRedis },
    );
  });

  afterAll(async () => {
    for (const s of streams) s.close();
    await worker?.close();
    await Promise.allSettled([workerRedis?.quit(), publisher?.quit()]);
    await stack?.stop();
  });

  it('AC-BTL-02..07, AC-BTL-09, AC-BTL-12, AC-BTL-13: 1 host + 30 bots play a full game; ranking matches the reference', async () => {
    const cls = await newClass(teacher, '8 «Б»');
    const bots: Session[] = [];
    for (let i = 0; i < 30; i++) bots.push(await newStudent(cls.code, `Бот${i} Тестов`));
    const battleId = await newBattle(teacher, 3);

    const created = await as(teacher)
      .post(`/api/teacher/battles/${battleId}/sessions`, { classId: cls.id, settings: { leaderboard: true } })
      .expect(201);
    const sid = created.body.sessionId as string;
    expect(created.body.code).toMatch(BATTLE_CODE_RE); // AC-BTL-02
    const code = created.body.code as string;

    const host = sse(teacher, `/api/teacher/battle-sessions/${sid}/events`);
    expect(await host.status).toBe(200);
    await host.next(ofType('snapshot'));

    // AC-BTL-03: код в нижнем регистре с пробелом; ведущий видит вход без перезагрузки ≤ 1 с.
    const spaced = `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
    const t0 = Date.now();
    expect(
      (await as(bots[0]!).post('/api/student/battles/join', { code: spaced }).expect(200)).body.sessionId,
    ).toBe(sid);
    const joined = await host.next(ofType('participant_joined'));
    expect(joined.at - t0).toBeLessThanOrEqual(1000);
    expect((joined.data as { participant: { displayName: string } }).participant.displayName).toBe('Бот0 Т.');
    for (const b of bots.slice(1)) await as(b).post('/api/student/battles/join', { code }).expect(200);
    // Повторный вход — та же строка.
    await as(bots[1]!).post('/api/student/battles/join', { code }).expect(200);
    expect((await snapshot(sid)).participantsCount).toBe(30);

    // Три бота смотрят игру через SSE.
    const watchers = bots.slice(0, 3).map((b) => sse(b, `/api/student/battle-sessions/${sid}/events`));
    for (const w of watchers) await w.next(ofType('snapshot'));

    // staleState: устаревшая версия → 409 и свежий снимок.
    const stale = await as(teacher)
      .post(`/api/teacher/battle-sessions/${sid}/start`, { expectedVersion: 999 })
      .expect(409);
    expect(stale.body.fieldErrors.battle).toBe('staleState');
    expect(stale.body.snapshot).toMatchObject({ id: sid, phase: 'lobby' });

    // AC-BTL-05: вопрос появляется у всех одновременно (разница ≤ 1 с), дедлайн один.
    await await goOk(sid, 'start');
    const started = await Promise.all(
      watchers.map((w) => w.next(ofType('question_started', (d) => d.index === 0))),
    );
    const times = started.map((e) => e.at);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(1000);
    expect(new Set(started.map((e) => (e.data as { deadlineAt: string }).deadlineAt)).size).toBe(1);
    // AC-BTL-06: ни в событии, ни в снимке ученика нет правильности.
    for (const e of started) expect(JSON.stringify(e.data)).not.toMatch(/isCorrect|correctPosition/);
    const studentSnap = await as(bots[0]!).get(`/api/student/battle-sessions/${sid}`).expect(200);
    expect(JSON.stringify(studentSnap.body)).not.toMatch(/isCorrect|correctPosition/);
    expect(studentSnap.body.question).toMatchObject({ index: 0, total: 3 });
    // У ведущего — правильный вариант.
    expect((await snapshot(sid)).question.correctPosition).toBe(1);

    // Вопрос 1: боты 0–19 правильно, остальные — неверно; отвечают по очереди (время растёт).
    const pattern = (i: number, q: number) => (q === 2 ? (i < 10 ? 1 : 2) : i < 20 ? 1 : 3);
    for (const [i, b] of bots.entries()) {
      const id = randomUUID();
      const res = await answer(b, sid, 0, pattern(i, 0), id).expect(200);
      expect(res.body).toEqual({ accepted: true }); // AC-BTL-06
      if (i === 0) {
        // AC-BTL-09: повтор сети — 200 и один ответ; другой вариант — 409.
        await answer(b, sid, 0, pattern(i, 0), id).expect(200);
        const again = await answer(b, sid, 0, 2).expect(409);
        expect(again.body.fieldErrors.battle).toBe('alreadyAnswered');
        await watchers[0]!.next(ofType('answer_accepted'));
      }
    }
    expect(
      (
        await stack.db
          .select()
          .from(battleAnswers)
          .where(and(eq(battleAnswers.sessionId, sid), eq(battleAnswers.questionIndex, 0)))
      ).length,
    ).toBe(30);
    // AC-BTL-07: все ответили — вопрос закрыт досрочно, раскрытие у всех.
    const hostReveal = await host.next(ofType('question_revealed', (d) => d.index === 0));
    expect(hostReveal.data).toMatchObject({ correctPosition: 1 });
    const dist = (hostReveal.data as { distribution: Array<{ position: number; count: number }> })
      .distribution;
    expect(dist).toEqual([
      { position: 1, count: 20 },
      { position: 2, count: 0 },
      { position: 3, count: 10 },
      { position: 4, count: 0 },
    ]);
    const myReveal = await watchers[0]!.next(ofType('question_revealed'));
    expect(myReveal.data).toMatchObject({
      correctPosition: 1,
      myPosition: 1,
      isCorrect: true,
      myCorrectCount: 1,
      myRank: 1,
    });
    expect(myReveal.data).not.toHaveProperty('distribution');
    await host.next(ofType('answer_progress'));

    // Промежуточный рейтинг: топ-5 и «моё место».
    await await goOk(sid, 'next');
    const board = await watchers[2]!.next(ofType('leaderboard'));
    expect((board.data as { top: unknown[] }).top).toHaveLength(5);
    expect((board.data as { me: { rank: number } }).me.rank).toBe(3);

    // Вопрос 2: отвечают не все; ведущий закрывает вопрос; поздний ответ — 409 questionClosed (AC-BTL-08).
    await await goOk(sid, 'next');
    await watchers[0]!.next(ofType('question_started', (d) => d.index === 1));
    for (const [i, b] of bots.slice(0, 25).entries()) await answer(b, sid, 1, pattern(i, 1)).expect(200);
    await await goOk(sid, 'close-question');
    const late = await answer(bots[29]!, sid, 1, 1).expect(409);
    expect(late.body.fieldErrors.battle).toBe('questionClosed');
    // Ответ на уже закрытый (не текущий) вопрос — тоже questionClosed.
    await answer(bots[29]!, sid, 0, 1).expect(409);

    // Вопрос 3 — последний; на последнем вопросе «Далее» после раскрытия → finished (без рейтинга).
    await await goOk(sid, 'next');
    await await goOk(sid, 'next');
    for (const [i, b] of bots.entries()) await answer(b, sid, 2, pattern(i, 2)).expect(200);
    await host.next(ofType('question_revealed', (d) => d.index === 2));
    await await goOk(sid, 'next');
    const fin = await watchers[1]!.next(ofType('finished'));
    const final = fin.data as {
      podium: Array<{ rank: number }>;
      table: unknown[];
      me: { rank: number; me: boolean };
    };
    expect(final.table).toHaveLength(30);
    expect(final.podium.every((r) => r.rank <= 3)).toBe(true);
    expect(final.me).toMatchObject({ me: true });

    // AC-BTL-12: итоги в battle_participants совпадают с эталонным расчётом по battle_answers.
    const answers = await stack.db.select().from(battleAnswers).where(eq(battleAnswers.sessionId, sid));
    const participants = await stack.db
      .select()
      .from(battleParticipants)
      .where(eq(battleParticipants.sessionId, sid));
    const reference = rankBattle(
      participants.map((p) => ({
        id: p.id,
        ...scoreBattleAnswers(answers.filter((a) => a.participantId === p.id)),
      })),
    );
    for (const r of reference) {
      const p = participants.find((x) => x.id === r.id)!;
      expect([p.finalRank, p.correctCount, p.correctTimeMs]).toEqual([
        r.rank,
        r.correctCount,
        r.correctTimeMs,
      ]);
    }
    // Порядок: больше правильных — выше; при равенстве — меньше время.
    const sorted = [...participants].sort((a, b) => a.finalRank! - b.finalRank!);
    expect(sorted[0]!.correctCount).toBe(3);
    for (let i = 1; i < sorted.length; i++) {
      const [prev, cur] = [sorted[i - 1]!, sorted[i]!];
      expect(prev.correctCount! > cur.correctCount! || prev.correctTimeMs! <= cur.correctTimeMs!).toBe(true);
    }

    // Итоги и CSV у ведущего; итоги ученика — свои ответы; история обеих ролей (API-BTL-29/30/31/45/46).
    const results = await as(teacher).get(`/api/teacher/battle-sessions/${sid}/results`).expect(200);
    expect(results.body.questions).toHaveLength(3);
    expect(results.body.questions[0]).toMatchObject({ correctPercent: 67, answered: 30 });
    expect(results.body.students).toHaveLength(30);
    const csv = await as(teacher).get(`/api/teacher/battle-sessions/${sid}/results.csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text.split('\r\n')[0]!.split(';').length).toBe(8);
    const mine = await as(bots[0]!).get(`/api/student/battle-sessions/${sid}/results`).expect(200);
    expect(mine.body.students).toHaveLength(1);
    expect(mine.body.me).toMatchObject({ me: true });
    expect(mine.body.students[0].answers[0]).toMatchObject({ optionPosition: 1, isCorrect: true });
    const hostHistory = await as(teacher)
      .get(`/api/teacher/battle-sessions?battleId=${battleId}`)
      .expect(200);
    expect(hostHistory.body.items[0]).toMatchObject({
      id: sid,
      status: 'finished',
      participantsCount: 30,
      questionsCount: 3,
    });
    const studentHistory = await as(bots[0]!).get('/api/student/battle-sessions').expect(200);
    expect(studentHistory.body.items[0]).toMatchObject({ id: sid, participantsCount: 30, questionsCount: 3 });

    // Аудит: создание, запуск, завершение.
    const audit = await stack.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, sid));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['battle_session.created', 'battle_session.started']),
    );
    // Код освобождается после завершения (частичный индекс).
    const [row] = await stack.db.select().from(battleSessions).where(eq(battleSessions.id, sid));
    expect(row!.status).toBe('finished');
  });

  it('BR-BTL-02, AC-BTL-04, AC-BTL-15 other class → «код не найден»; kicked cannot return; full; alreadyStarted; leave and re-join', async () => {
    const cls = await newClass(teacher, '9 «В»');
    const otherCls = await newClass(teacher, '10 «Г»');
    const [a, b, c] = [
      await newStudent(cls.code, 'Асель Каримова'),
      await newStudent(cls.code, 'Ержан'),
      await newStudent(cls.code, 'Дана'),
    ];
    const outsider = await newStudent(otherCls.code, 'Чужой');
    const battleId = await newBattle(teacher, 1);
    const { sessionId: sid, code } = (
      await as(teacher)
        .post(`/api/teacher/battles/${battleId}/sessions`, {
          classId: cls.id,
          settings: { maxParticipants: 2 },
        })
        .expect(201)
    ).body;

    const notFound = await as(outsider).post('/api/student/battles/join', { code }).expect(404);
    expect(notFound.body.fieldErrors.battle).toBe('codeNotFound');
    const unknown = await as(outsider).post('/api/student/battles/join', { code: 'ZZZ999' }).expect(404);
    expect(unknown.body.fieldErrors).toEqual(notFound.body.fieldErrors);

    await as(a).post('/api/student/battles/join', { code }).expect(200);
    await as(b).post('/api/student/battles/join', { code }).expect(200);
    const full = await as(c).post('/api/student/battles/join', { code }).expect(409);
    expect(full.body.fieldErrors.battle).toBe('full');

    // Выход и повторный вход (BR-BTL-07).
    await as(b).post(`/api/student/battle-sessions/${sid}/leave`).expect(204);
    await as(c).post('/api/student/battles/join', { code }).expect(200);
    const fullAgain = await as(b).post('/api/student/battles/join', { code }).expect(409);
    expect(fullAgain.body.fieldErrors.battle).toBe('full');

    // Выгон (AC-BTL-15): сообщение по SSE, вернуться нельзя, в рейтинг не входит.
    const stream = sse(a, `/api/student/battle-sessions/${sid}/events`);
    await stream.next(ofType('snapshot'));
    const snap = await snapshot(sid);
    const aId = snap.participants.find((p: { displayName: string }) => p.displayName === 'Асель К.').id;
    await as(teacher).post(`/api/teacher/battle-sessions/${sid}/participants/${aId}/kick`).expect(200);
    await stream.next(ofType('kicked'));
    await stream.closed;
    const kicked = await as(a).post('/api/student/battles/join', { code }).expect(409);
    expect(kicked.body.fieldErrors.battle).toBe('kicked');
    expect((await as(a).get(`/api/student/battle-sessions/${sid}`).expect(200)).body.kicked).toBe(true);
    expect((await snapshot(sid)).participants.map((p: { id: string }) => p.id)).not.toContain(aId);

    // После старта без «позднего подключения» — alreadyStarted.
    await await goOk(sid, 'start');
    await as(b).post(`/api/student/battle-sessions/${sid}/leave`).expect(204);
    const d = await newStudent(cls.code, 'Поздний');
    const late = await as(d).post('/api/student/battles/join', { code }).expect(409);
    expect(late.body.fieldErrors.battle).toBe('alreadyStarted');
    // Выгнанный и чужой не отвечают.
    await answer(a, sid, 0, 1).expect(409);
    await answer(outsider, sid, 0, 1).expect(404);
    await await goOk(sid, 'finish');
    const [kickedRow] = await stack.db
      .select()
      .from(battleParticipants)
      .where(eq(battleParticipants.id, aId));
    expect(kickedRow!.finalRank).toBeNull();
  });

  it('BR-BTL-08 worker timer closes the question at deadline + 500 ms; auto-advance moves on', async () => {
    const cls = await newClass(teacher, '5 «А»');
    const s1 = await newStudent(cls.code, 'Таймер');
    const s2 = await newStudent(cls.code, 'Второй');
    const battleId = await newBattle(teacher, 2, 5);
    const { sessionId: sid, code } = (
      await as(teacher)
        .post(`/api/teacher/battles/${battleId}/sessions`, {
          classId: cls.id,
          settings: { autoAdvance: true, leaderboard: false },
        })
        .expect(201)
    ).body;
    await as(s1).post('/api/student/battles/join', { code }).expect(200);
    await as(s2).post('/api/student/battles/join', { code }).expect(200);
    const host = sse(teacher, `/api/teacher/battle-sessions/${sid}/events`);
    await host.next(ofType('snapshot'));
    await await goOk(sid, 'start');
    const started = await host.next(ofType('question_started', (d) => d.index === 0));
    await answer(s1, sid, 0, 1).expect(200); // второй не отвечает — ждём таймер
    const reveal = await host.next(
      ofType('question_revealed', (d) => d.index === 0),
      9_000,
    );
    const deadline = new Date((started.data as { deadlineAt: string }).deadlineAt).getTime();
    expect(reveal.at).toBeGreaterThanOrEqual(deadline + 400);
    // Автопереход через 5 с: следующий вопрос без нажатия.
    await host.next(
      ofType('question_started', (d) => d.index === 1),
      9_000,
    );
  }, 30_000);

  it('BR-BTL-05, BR-BTL-06, AC-BTL-16 limits, expiry and access', async () => {
    // Сессии прежних сценариев не мешают лимиту активных (BR-BTL-05).
    await stack.db
      .update(battleSessions)
      .set({ status: 'finished', phase: 'finished' })
      .where(eq(battleSessions.hostId, teacher.userId));
    const cls = await newClass(teacher, '6 «А»');
    await newStudent(cls.code, 'Один');
    const battleId = await newBattle(teacher, 1);
    // Тест без вопросов — 422; чужой класс — 404.
    const empty = (
      await as(teacher).post('/api/teacher/battles', { title: 'Пусто', locale: 'ru' }).expect(201)
    ).body.id;
    const noQ = await as(teacher)
      .post(`/api/teacher/battles/${empty}/sessions`, { classId: cls.id })
      .expect(422);
    expect(noQ.body.fieldErrors.battle).toBe('noQuestions');
    const foreignClass = await newClass(other, 'Чужой');
    await as(teacher)
      .post(`/api/teacher/battles/${battleId}/sessions`, { classId: foreignClass.id })
      .expect(404);
    // Без участников «Начать» — 422.
    const lonely = (
      await as(teacher).post(`/api/teacher/battles/${battleId}/sessions`, { classId: cls.id }).expect(201)
    ).body.sessionId;
    const noP = await go(lonely, 'start');
    expect(noP.status).toBe(422);
    expect(noP.body.fieldErrors.battle).toBe('noParticipants');
    // AC-BTL-16: чужой учитель → 404 на снимке, потоке и переходах.
    await as(other).get(`/api/teacher/battle-sessions/${lonely}`).expect(404);
    await as(other).get(`/api/teacher/battle-sessions/${lonely}/results`).expect(404);
    await as(other).post(`/api/teacher/battle-sessions/${lonely}/cancel`, { expectedVersion: 0 }).expect(404);
    const foreignStream = sse(other, `/api/teacher/battle-sessions/${lonely}/events`);
    expect(await foreignStream.status).toBe(404);
    // Не больше 3 активных сессий у учителя (с учётом прежних тестов — завершаем лишние).
    await stack.db
      .update(battleSessions)
      .set({ status: 'finished', phase: 'finished' })
      .where(and(eq(battleSessions.hostId, teacher.userId), sql`${battleSessions.id} <> ${lonely}`));
    await as(teacher).post(`/api/teacher/battles/${battleId}/sessions`, { classId: cls.id }).expect(201);
    await as(teacher).post(`/api/teacher/battles/${battleId}/sessions`, { classId: cls.id }).expect(201);
    const tooMany = await as(teacher)
      .post(`/api/teacher/battles/${battleId}/sessions`, { classId: cls.id })
      .expect(409);
    expect(tooMany.body.fieldErrors.battle).toBe('tooManyActiveSessions');
    // Отмена — только из лобби.
    await await goOk(lonely, 'cancel');
    const again = await go(lonely, 'cancel');
    expect(again.status).toBe(409);
    // BR-BTL-06: лобби старше 60 минут закрывается (cancelled, expired).
    await stack.db
      .update(battleSessions)
      .set({ createdAt: new Date(Date.now() - 61 * 60_000) })
      .where(and(eq(battleSessions.hostId, teacher.userId), eq(battleSessions.status, 'lobby')));
    const expired = await expireSessions(stack.db);
    expect(expired.length).toBeGreaterThanOrEqual(2);
    expect(
      expired.every((r) => r.session?.status === 'cancelled' && r.session.cancelReason === 'expired'),
    ).toBe(true);
  });
});
