// Нагрузка и надёжность Battle (SPEC 7.12 «Нагрузочные цели», BATTLE_TZ 6.6, этап B6; AC-BTL-11, AC-BTL-17).
// Реальные SSE-клиенты (fetch-поток), ответы — POST, всё через публичное API.
//
//   node e2e/load/battle-load.mjs one       [--base=http://localhost:3001] — 1 сессия × 100, вопрос 10 с, ответы за 3 с
//   node e2e/load/battle-load.mjs many      — 20 сессий × 40 одновременно, полная игра из 3 вопросов
//   node e2e/load/battle-load.mjs restart   — перезапуск api посреди вопроса (api запускает сам скрипт)
//
// Нужны: инфраструктура (pnpm infra:up), seed demo, собранные api и worker; api — с RATE_LIMITS_DISABLED=true
// (сотни регистраций с одного IP). Для `restart` скрипт сам запускает и перезапускает api (порт из --base).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(3).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const scenario = process.argv[2] ?? 'one';
const BASE = args.base ?? 'http://localhost:3001';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p95 = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};
const errors = [];

// ---- HTTP-клиент с cookie-сессией ----
class Client {
  constructor() {
    this.cookies = {};
  }
  header() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  async req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.header(),
        ...(this.cookies.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.cookies.csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
}

/** SSE-поток с переподключением 1, 2, 4, 8, 10 с (как у клиента, 6.9); `on(type, data, at)`. */
function stream(client, path, on) {
  const state = { closed: false, connects: 0, controller: null };
  const BACKOFF = [1000, 2000, 4000, 8000, 10000];
  (async () => {
    let failures = 0;
    while (!state.closed) {
      try {
        state.controller = new AbortController();
        const res = await fetch(`${BASE}${path}`, {
          headers: { Cookie: client.header(), Accept: 'text/event-stream' },
          signal: state.controller.signal,
        });
        if (res.status !== 200) throw new Error(`stream ${res.status}`);
        state.connects += 1;
        failures = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let i;
          while ((i = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            let type = null;
            let data = null;
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) type = line.slice(7);
              else if (line.startsWith('data: ')) data = JSON.parse(line.slice(6));
            }
            if (type) on(type, data, Date.now());
          }
        }
      } catch {
        // обрыв — переподключение
      }
      if (state.closed) return;
      await sleep(BACKOFF[Math.min(failures, BACKOFF.length - 1)]);
      failures += 1;
    }
  })();
  return {
    state,
    close: () => {
      state.closed = true;
      state.controller?.abort();
    },
  };
}

// ---- Подготовка: учитель, класс, ученики, тест ----
async function teacher() {
  const t = new Client();
  await t.req('POST', '/api/auth/register', {
    role: 'teacher',
    email: `load.${randomUUID().slice(0, 8)}@example.kz`,
    displayName: 'Нагрузка',
    password: 'teacher-pass-1',
  });
  return t;
}

async function classWithStudents(t, count) {
  const cls = await t.req('POST', '/api/teacher/classes', { name: `L${randomUUID().slice(0, 6)}` });
  const { code } = await t.req('POST', `/api/teacher/classes/${cls.id}/invite-codes`);
  const students = [];
  // Регистрация пачками по 20 (argon2 на сервере).
  for (let i = 0; i < count; i += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, count - i) }, async (_, j) => {
        const s = new Client();
        await s.req('POST', '/api/auth/register-student', {
          displayName: `Бот${i + j} Нагрузка`,
          login: `load.${randomUUID().slice(0, 12)}`,
          password: 'student-pass-1',
          code,
        });
        return s;
      }),
    );
    students.push(...batch);
  }
  return { classId: cls.id, students };
}

async function battle(t, questions, timeLimitSec) {
  const { id } = await t.req('POST', '/api/teacher/battles', { title: 'Нагрузка', locale: 'ru' });
  for (let q = 1; q <= questions; q++) {
    await t.req('POST', `/api/teacher/battles/${id}/questions`, {
      type: 'single_choice',
      text: `Вопрос ${q}`,
      timeLimitSec,
      options: [1, 2, 3, 4].map((p) => ({ text: `Ответ ${p}`, isCorrect: p === 1 })),
    });
  }
  return id;
}

async function step(t, sid, action) {
  const snap = await t.req('GET', `/api/teacher/battle-sessions/${sid}`);
  return t.req('POST', `/api/teacher/battle-sessions/${sid}/${action}`, { expectedVersion: snap.version });
}

/** Игра: все ученики входят, подключают SSE; возвращает метрики раунда. */
async function game({ t, battleId, classId, students, questions, answerWindowMs, onQuestion }) {
  const { sessionId, code } = await t.req('POST', `/api/teacher/battles/${battleId}/sessions`, {
    classId,
    settings: { leaderboard: false, maxParticipants: 100 },
  });
  await Promise.all(students.map((s) => s.req('POST', '/api/student/battles/join', { code })));
  const events = students.map(() => []);
  const streams = students.map((s, i) =>
    stream(s, `/api/student/battle-sessions/${sessionId}/events`, (type, data, at) =>
      events[i].push({ type, data, at }),
    ),
  );
  const waitFor = async (i, pred, timeoutMs = 15000) => {
    const start = Date.now();
    for (;;) {
      const e = events[i].find(pred);
      if (e) return e;
      if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting event for student ${i}`);
      await sleep(20);
    }
  };
  await Promise.all(students.map((_, i) => waitFor(i, (e) => e.type === 'snapshot')));
  const accepted = [];
  const reveal = [];
  let lost = 0;
  await step(t, sessionId, 'start');
  for (let q = 0; q < questions; q++) {
    await Promise.all(
      students.map((_, i) => waitFor(i, (e) => e.type === 'question_started' && e.data.index === q)),
    );
    if (onQuestion) await onQuestion({ q, sessionId, streams, events });
    // Все отвечают в окне answerWindowMs; время «ответ → answer_accepted».
    let lastAnswerAt = 0;
    await Promise.all(
      students.map(async (s, i) => {
        await sleep(Math.random() * answerWindowMs);
        const sent = Date.now();
        const clientAnswerId = randomUUID();
        const body = { questionIndex: q, optionPosition: 1 + (i % 4), clientAnswerId };
        // Повтор с тем же clientAnswerId при обрыве — идемпотентен (BR-BTL-03).
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            await s.req('POST', `/api/student/battle-sessions/${sessionId}/answers`, body);
            break;
          } catch (err) {
            if (err.status === 409) {
              lost += 1;
              errors.push(err.message);
              return;
            }
            await sleep(500);
          }
        }
        lastAnswerAt = Math.max(lastAnswerAt, Date.now());
        const e = await waitFor(i, (x) => x.type === 'answer_accepted' && x.data.index === q);
        accepted.push(e.at - sent);
      }),
    );
    // Все ответили — вопрос закрывается досрочно; «закрытие → question_revealed у всех».
    const revealed = await Promise.all(
      students.map((_, i) => waitFor(i, (e) => e.type === 'question_revealed' && e.data.index === q)),
    );
    for (const e of revealed) reveal.push(Math.max(0, e.at - lastAnswerAt));
    await step(t, sessionId, 'next');
  }
  await Promise.all(students.map((_, i) => waitFor(i, (e) => e.type === 'finished')));
  const results = await t.req('GET', `/api/teacher/battle-sessions/${sessionId}/results`);
  const stored = results.questions.reduce((n, q) => n + q.answered, 0);
  for (const s of streams) s.close();
  return { sessionId, accepted, reveal, lost, stored, expected: students.length * questions, streams };
}

// ---- Управление процессом api (сценарий restart) ----
function startApi() {
  const port = new URL(BASE).port || '3001';
  const child = spawn(process.execPath, ['--env-file-if-exists=../../.env', 'dist/main.js'], {
    cwd: resolve(root, 'apps/api'),
    env: { ...process.env, API_PORT: port, RATE_LIMITS_DISABLED: 'true' },
    stdio: 'ignore',
  });
  return child;
}
async function waitHealthy(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // ещё не поднялся
    }
    await sleep(200);
  }
  throw new Error('api did not start');
}

const report = (name, r) =>
  log(
    `${name}: p95 ответ→answer_accepted ${p95(r.accepted)} мс; p95 закрытие→question_revealed ${p95(r.reveal)} мс; ` +
      `ответов в БД ${r.stored} из ${r.expected}; отклонено ${r.lost}`,
  );

if (scenario === 'one') {
  const t = await teacher();
  const { classId, students } = await classWithStudents(t, 100);
  const battleId = await battle(t, 1, 10);
  const r = await game({ t, battleId, classId, students, questions: 1, answerWindowMs: 3000 });
  report('1 сессия × 100', r);
  const ok = p95(r.accepted) <= 300 && p95(r.reveal) <= 1000 && r.stored === r.expected;
  log(ok ? 'ЦЕЛИ ВЫПОЛНЕНЫ' : 'ЦЕЛИ НЕ ВЫПОЛНЕНЫ');
  process.exit(ok ? 0 : 1);
}

if (scenario === 'many') {
  const t = await teacher();
  // У учителя не больше 3 активных сессий (BR-BTL-05) — 20 сессий ведут 7 учителей.
  const hosts = [t, ...(await Promise.all(Array.from({ length: 6 }, () => teacher())))];
  const prepared = [];
  for (let i = 0; i < 20; i++) {
    const host = hosts[i % hosts.length];
    const { classId, students } = await classWithStudents(host, 40);
    prepared.push({ t: host, classId, students, battleId: await battle(host, 3, 10) });
  }
  log('подготовлено: 20 сессий × 40 учеников');
  const started = Date.now();
  const results = await Promise.allSettled(
    prepared.map((p) => game({ ...p, questions: 3, answerWindowMs: 3000 })),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected');
  const all = {
    accepted: ok.flatMap((r) => r.accepted),
    reveal: ok.flatMap((r) => r.reveal),
    lost: ok.reduce((n, r) => n + r.lost, 0),
    stored: ok.reduce((n, r) => n + r.stored, 0),
    expected: 20 * 40 * 3,
  };
  report(`20 × 40 (${Math.round((Date.now() - started) / 1000)} с)`, all);
  log(`сессий без ошибок: ${ok.length} из 20; ошибок запросов: ${errors.length}`);
  for (const f of failed) log('  ошибка:', f.reason?.message);
  const pass = failed.length === 0 && errors.length === 0 && all.stored === all.expected;
  log(pass ? 'ЦЕЛИ ВЫПОЛНЕНЫ' : 'ЦЕЛИ НЕ ВЫПОЛНЕНЫ');
  process.exit(pass ? 0 : 1);
}

if (scenario === 'restart') {
  let api = startApi();
  await waitHealthy();
  const t = await teacher();
  const { classId, students } = await classWithStudents(t, 30);
  const battleId = await battle(t, 2, 30);
  let reconnectMs = null;
  const r = await game({
    t,
    battleId,
    classId,
    students,
    questions: 2,
    answerWindowMs: 3000,
    onQuestion: async ({ q, streams }) => {
      if (q !== 0) return;
      // Половина успевает ответить, затем api перезапускается посреди вопроса (AC-BTL-11).
      const before = streams.map((s) => s.state.connects);
      api.kill('SIGKILL');
      const killedAt = Date.now();
      api = startApi();
      await waitHealthy();
      for (;;) {
        if (streams.every((s, i) => s.state.connects > before[i])) break;
        if (Date.now() - killedAt > 30000) throw new Error('clients did not reconnect');
        await sleep(50);
      }
      reconnectMs = Date.now() - killedAt;
      log(`перезапуск api: все ${streams.length} клиентов переподключились за ${reconnectMs} мс`);
    },
  });
  report('после перезапуска', r);
  api.kill();
  const ok = reconnectMs !== null && reconnectMs <= 10000 && r.stored === r.expected && r.lost === 0;
  log(ok ? 'ЦЕЛИ ВЫПОЛНЕНЫ' : 'ЦЕЛИ НЕ ВЫПОЛНЕНЫ');
  process.exit(ok ? 0 : 1);
}
