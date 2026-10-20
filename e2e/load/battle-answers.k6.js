/* global __ENV, __VU -- глобальные переменные k6 */
// k6: пропускная способность ответов Battle (SPEC 7.12 «Нагрузочные цели», BATTLE_TZ 6.6). HTTP-часть цели
// «p95 ответ → answer_accepted ≤ 300 мс»: 100 участников одной сессии отвечают в первые 3 с вопроса.
// SSE-части целей (доставка answer_accepted и question_revealed, переподключение) — e2e/load/battle-load.mjs
// (в ядре k6 нет SSE-клиента).
//
//   docker run --rm -i --add-host api:host-gateway -e BASE=http://api:3001 grafana/k6:0.54.0 run - < e2e/load/battle-answers.k6.js
// api — с RATE_LIMITS_DISABLED=true (регистрация 100 учеников с одного IP).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE || 'http://localhost:3001';
const STUDENTS = 100;

export const options = {
  scenarios: {
    answers: { executor: 'per-vu-iterations', vus: STUDENTS, iterations: 1, maxDuration: '60s' },
  },
  thresholds: {
    'http_req_duration{name:answer}': ['p(95)<300'],
    'checks{name:answer}': ['rate==1'],
  },
};

const json = (cookies, extra = {}) => ({
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': cookies.csrf || '', ...extra },
  cookies,
});
const jar = (res) => Object.fromEntries(Object.entries(res.cookies).map(([k, v]) => [k, v[0].value]));
const suffix = () => uuidv4().slice(0, 8);

export function setup() {
  const teacher = http.post(
    `${BASE}/api/auth/register`,
    JSON.stringify({
      role: 'teacher',
      email: `k6.${suffix()}@example.kz`,
      displayName: 'k6',
      password: 'teacher-pass-1',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const t = jar(teacher);
  const post = (path, body) => http.post(`${BASE}${path}`, JSON.stringify(body || {}), json(t)).json();
  const cls = post('/api/teacher/classes', { name: `k6 ${suffix()}` });
  const invite = post(`/api/teacher/classes/${cls.id}/invite-codes`);
  const battle = post('/api/teacher/battles', { title: 'k6', locale: 'ru' });
  post(`/api/teacher/battles/${battle.id}/questions`, {
    type: 'single_choice',
    text: 'k6',
    timeLimitSec: 10,
    options: [1, 2, 3, 4].map((p) => ({ text: `${p}`, isCorrect: p === 1 })),
  });
  const session = post(`/api/teacher/battles/${battle.id}/sessions`, { classId: cls.id });
  const students = [];
  for (let i = 0; i < STUDENTS; i++) {
    const res = http.post(
      `${BASE}/api/auth/register-student`,
      JSON.stringify({
        displayName: `k6 ${i}`,
        login: `k6.${suffix()}${i}`,
        password: 'student-pass-1',
        code: invite.code,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    const s = jar(res);
    http.post(`${BASE}/api/student/battles/join`, JSON.stringify({ code: session.code }), json(s));
    students.push(s);
  }
  const snap = http.get(`${BASE}/api/teacher/battle-sessions/${session.sessionId}`, { cookies: t }).json();
  post(`/api/teacher/battle-sessions/${session.sessionId}/start`, { expectedVersion: snap.version });
  return { sessionId: session.sessionId, students };
}

export default function (data) {
  const s = data.students[__VU - 1];
  sleep(Math.random() * 3);
  const res = http.post(
    `${BASE}/api/student/battle-sessions/${data.sessionId}/answers`,
    JSON.stringify({ questionIndex: 0, optionPosition: 1 + (__VU % 4), clientAnswerId: uuidv4() }),
    { ...json(s), tags: { name: 'answer' } },
  );
  check(res, { accepted: (r) => r.status === 200 && r.json('accepted') === true }, { name: 'answer' });
}
