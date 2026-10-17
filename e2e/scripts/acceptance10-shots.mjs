// Скриншоты доработок итерации 10: «Карта освоения», период «Четверть», «Сдано после срока».
// Запуск: node e2e/scripts/acceptance10-shots.mjs <каталог> [baseURL]. Нужны web, api и seed `config` + `demo`.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const uid = () => randomUUID().slice(0, 6);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

async function api(body, path) {
  const ctx = await request.newContext({ baseURL: base });
  const res = await ctx.post(path, { data: body });
  if (res.status() >= 300) throw new Error(`${path}: ${res.status()} ${await res.text()}`);
  return ctx;
}
const csrf = async (ctx) => (await ctx.storageState()).cookies.find((c) => c.name === 'csrf').value;
async function send(ctx, method, path, data = {}) {
  const res = await ctx.fetch(path, { method, data, headers: { 'X-CSRF-Token': await csrf(ctx) } });
  if (res.status() >= 300) throw new Error(`${path}: ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const post = (ctx, path, data) => send(ctx, 'POST', path, data);

// Учитель, класс, свой предмет «Экология» (выдан классу) с темой и квизом из 4 вопросов.
const teacher = await api(
  { role: 'teacher', email: `acc.${uid()}@example.kz`, displayName: 'Учитель', password: 'teacher-pass-1' },
  '/api/auth/register',
);
const cls = await post(teacher, '/api/teacher/classes', { name: '9 «А»' });
const { code } = await post(teacher, `/api/teacher/classes/${cls.id}/invite-codes`);
const subject = await post(teacher, '/api/teacher/subjects', {
  translations: { ru: { title: 'Экология' } },
  inPublicCatalog: false,
});
await post(teacher, `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
const topics = [];
for (const title of ['Экосистемы', 'Пищевые цепи', 'Охрана природы']) {
  const topic = await post(teacher, `/api/teacher/subjects/${subject.id}/topics`);
  await send(teacher, 'PUT', `/api/teacher/topics/${topic.id}`, {
    translations: { ru: { title } },
    materialIds: [],
  });
  for (let q = 1; q <= 4; q++) {
    await post(teacher, `/api/teacher/topics/${topic.id}/quiz/questions`, {
      type: 'single_choice',
      difficulty: 'easy',
      translations: { ru: { text: `Вопрос ${q}` } },
      options: [0, 1].map((i) => ({ translations: { ru: `Ответ ${q}.${i}` }, isCorrect: i === 0 })),
    });
  }
  await post(teacher, `/api/teacher/topics/${topic.id}/publish`);
  topics.push(topic.id);
}

const students = [];
for (const name of ['Асель', 'Бауыржан', 'Дана', 'Ерлан']) {
  students.push(
    await api(
      { displayName: name, login: `acc.${uid()}`, password: 'student-pass-1', code },
      '/api/auth/register-student',
    ),
  );
}
async function quiz(s, topicId, correct) {
  const lesson = await (await s.get(`/api/student/topics/${topicId}`)).json();
  const attempt = await post(s, `/api/student/quizzes/${lesson.quizId}/attempts`);
  for (const [i, q] of attempt.questions.entries()) {
    const pick = q.options.find((o) => o.text.endsWith(i < correct ? '.0' : '.1'));
    await post(s, `/api/student/attempts/${attempt.attemptId}/answers`, {
      questionId: q.id,
      optionId: pick.id,
    });
  }
  await post(s, `/api/student/attempts/${attempt.attemptId}/finish`);
}
await quiz(students[0], topics[0], 4);
await quiz(students[0], topics[1], 4);
await quiz(students[0], topics[2], 2);
await quiz(students[1], topics[0], 3);
await quiz(students[2], topics[0], 1);

// Задание со сроком в прошлом — сдача после срока.
await post(teacher, '/api/teacher/assignments', {
  classId: cls.id,
  subjectId: subject.id,
  topicId: topics[1],
  dueAt: new Date(Date.now() - 86_400_000).toISOString(),
});
await quiz(students[1], topics[1], 4);

const browser = await chromium.launch();
async function session(ctx, width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: 'dark', url: base },
    ...(await ctx.storageState()).cookies.map(({ name, value }) => ({ name, value, url: base })),
  ]);
  return context.newPage();
}
const shotOf =
  (page) =>
  async (name, opts = {}) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: opts.fullPage ?? false });
    log('screenshot', name);
  };

// «Карта освоения»: базовый предмет (по умолчанию), затем фильтр — «Экология».
const tp = await session(teacher);
let shot = shotOf(tp);
await tp.goto(`${base}/ru/teacher/classes/${cls.id}/mastery`);
await tp.getByTestId('mastery-table').waitFor();
await shot('m-01-mastery-base-subject');
await tp.getByRole('combobox', { name: 'Предмет' }).click();
await tp.getByRole('option', { name: 'Экология' }).click();
await tp.getByTestId('mastery-table').getByText('Экосистемы').waitFor();
await shot('m-02-mastery-own-subject-filter');
const mp = await session(teacher, 320, 640);
await mp.goto(`${base}/ru/teacher/classes/${cls.id}/mastery`);
await mp.getByTestId('mastery-table').waitFor();
await shotOf(mp)('m-03-mastery-mobile-320', { fullPage: true });
await mp.getByTestId('mastery-table').evaluate((el) => el.scrollBy({ left: 400 }));
await shotOf(mp)('m-04-mastery-mobile-320-scrolled');

// Ученик: «Четверть» и «Учебный год», пометка «Сдано после срока».
const sp = await session(students[1]);
shot = shotOf(sp);
await sp.goto(`${base}/ru/learn/progress`);
await sp.getByTestId('progress-card').waitFor();
await sp.getByRole('radio', { name: 'Четверть', exact: true }).click();
await sp.getByTestId('progress-range').getByText('Четверть').waitFor();
await shot('q-01-progress-quarter', { fullPage: true });
await sp.getByRole('radio', { name: 'Учебный год' }).click();
await sp.getByTestId('progress-range').getByText('Учебный год').waitFor();
await shot('q-02-progress-school-year');
await sp.goto(`${base}/ru/learn/assignments`);
await sp.getByTestId('assignment-late').waitFor();
await shot('l-01-submitted-late');
await browser.close();
