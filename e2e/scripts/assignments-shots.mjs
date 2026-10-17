// Скриншоты итерации 10 (задания, показатели, аналитика) на реальном стеке: учитель и ученик.
// Запуск: node e2e/scripts/assignments-shots.mjs <каталог> [baseURL]. Нужны web, api и seed `demo`.
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
async function post(ctx, path, data = {}) {
  const res = await ctx.post(path, { data, headers: { 'X-CSRF-Token': await csrf(ctx) } });
  if (res.status() >= 300) throw new Error(`${path}: ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const cookiesOf = async (ctx) =>
  (await ctx.storageState()).cookies.map(({ name, value }) => ({ name, value, url: base }));

// Данные: учитель, класс «9 «А»», два ученика по коду класса (второй — неактивен).
const teacher = await api(
  { role: 'teacher', email: `shots.${uid()}@example.kz`, displayName: 'Учитель', password: 'teacher-pass-1' },
  '/api/auth/register',
);
const cls = await post(teacher, '/api/teacher/classes', { name: '9 «А»' });
const { code } = await post(teacher, `/api/teacher/classes/${cls.id}/invite-codes`);
const student = await api(
  { displayName: 'Асель', login: `shots.${uid()}`, password: 'student-pass-1', code },
  '/api/auth/register-student',
);
await api(
  { displayName: 'Бауыржан', login: `shots.${uid()}`, password: 'student-pass-1', code },
  '/api/auth/register-student',
);

const browser = await chromium.launch();
async function session(ctx, width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: 'dark', url: base },
    ...(await cookiesOf(ctx)),
  ]);
  return context.newPage();
}
const shotOf =
  (page) =>
  async (name, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 500);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: opts.fullPage ?? false });
    log('screenshot', name);
  };
const choose = async (page, label, option) => {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).click();
};

// 1. Учитель: выдача задания (T09).
let tp = await session(teacher);
let shot = shotOf(tp);
await tp.goto(`${base}/ru/teacher/assignments`);
await tp.getByTestId('assignment-form').waitFor();
await shot('t-01-assignments-empty');
await choose(tp, 'Класс', cls.name);
await choose(tp, 'Предмет', 'Анатомия человека');
await choose(tp, 'Тема', 'Сердечно-сосудистая система');
await tp.getByLabel('Срок сдачи').fill('2030-05-20T18:30');
await shot('t-02-assignment-filled');
await tp.getByTestId('assignment-submit').click();
await tp.getByTestId('assignment-card').first().waitFor();
await shot('t-03-assignment-issued', { fullPage: true });

// 2. Ученик: «Мои задания» → квиз из задания → «Оценено».
const sp = await session(student);
const sshot = shotOf(sp);
await sp.goto(`${base}/ru/learn/assignments`);
await sp.getByTestId('student-assignment').waitFor();
await sshot('s-01-my-assignments-not-started');
await sp.getByTestId('student-assignment').click();
await sp.getByTestId('quiz-option').first().waitFor();
await sshot('s-02-quiz-from-assignment');
const next = async () => {
  await sp.getByTestId('quiz-feedback').waitFor();
  await sp.getByTestId('quiz-next').click();
};
await sp.getByTestId('quiz-option').filter({ hasText: 'Аорта' }).click();
await next();
await sp.getByLabel('Твой ответ').fill('4');
await sp.getByRole('button', { name: 'Ответить' }).click();
await next();
await sp.getByTestId('quiz-option').filter({ hasText: 'Левый желудочек' }).click();
await next();
await sp.getByTestId('quiz-option').filter({ hasText: 'Неверно' }).click();
await next();
await sp.getByTestId('quiz-option').filter({ hasText: 'В малом (лёгочном)' }).click();
await next();
await sshot('s-03-quiz-result');
await sp.goto(`${base}/ru/learn/assignments`);
await sp.locator('[data-status="graded"]').waitFor();
await sshot('s-04-my-assignments-graded');

// 3. Ученик: «Мои показатели» (U08) и «Достижения» (U10).
await sp.goto(`${base}/ru/learn/progress`);
await sp.getByTestId('progress-card').waitFor();
await sshot('s-05-progress-30d', { fullPage: true });
await sp.getByRole('radio', { name: '7 дней' }).click();
await sp.getByTestId('progress-range').getByText('7 дней').waitFor();
await sshot('s-06-progress-7d');
await sp.getByTestId('streak-card').getByRole('button', { name: 'Как считается' }).click();
await sp.getByTestId('progress-help').waitFor();
await sshot('s-07-progress-how-counted');
await sp.keyboard.press('Escape');
await sp.goto(`${base}/ru/learn/achievements`);
await sp.getByTestId('badge').first().waitFor();
await sshot('s-08-achievements', { fullPage: true });

// 4. Учитель: счётчики обновлены, аналитика класса (T10), вкладки.
await tp.goto(`${base}/ru/teacher/assignments`);
await tp.getByTestId('assignment-counts').getByText('Оценено: 1').waitFor();
await shot('t-04-assignment-counts-updated');
await tp.goto(`${base}/ru/teacher/classes`);
await tp.getByTestId('teacher-class').first().waitFor();
await shot('t-05-classes-analytics-link');
await tp.goto(`${base}/ru/teacher/classes/${cls.id}/analytics`);
await tp.getByTestId('class-analytics').waitFor();
await shot('t-06-class-analytics', { fullPage: true });
await tp.getByRole('link', { name: 'Ростер' }).click();
await tp.getByTestId('class-roster-tab').getByText('Асель').waitFor();
await shot('t-07-class-roster');
await tp.getByRole('link', { name: 'Карта освоения' }).click();
await tp.getByTestId('mastery-stub').waitFor();
await shot('t-08-class-mastery-stub');

// 5. Мобильная ширина 320 px.
const mp = await session(student, 320, 640);
await mp.goto(`${base}/ru/learn/progress`);
await mp.getByTestId('progress-card').waitFor();
await shotOf(mp)('s-09-progress-mobile-320', { fullPage: true });
const mt = await session(teacher, 320, 640);
await mt.goto(`${base}/ru/teacher/classes/${cls.id}/analytics`);
await mt.getByTestId('class-analytics').waitFor();
await shotOf(mt)('t-09-analytics-mobile-320', { fullPage: true });
await browser.close();
