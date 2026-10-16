// Скриншоты этапа 8.6 (базовая программа платформы) на реальном стеке: гость, ученик, учитель.
// Запуск: node e2e/scripts/base-content-shots.mjs <каталог> [baseURL]
// Нужны web, api, MinIO и seed `demo` (импорт content/ с картинками).
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const uid = randomUUID().slice(0, 6);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

// ID базовой программы — через гостевой API (API-PUB-10..12).
const guestApi = await request.newContext({ baseURL: base });
const catalog = await (await guestApi.get('/api/public/catalog')).json();
const biology = catalog.sections.find((s) => s.title === 'Биология');
const section = await (await guestApi.get(`/api/public/sections/${biology.id}`)).json();
const anatomy = section.subjects.find((s) => s.title === 'Анатомия человека');
const subject = await (await guestApi.get(`/api/public/subjects/${anatomy.id}`)).json();
const cardio = subject.topics[0].id;

const browser = await chromium.launch();
async function session(cookies = [], width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: 'dark', url: base },
    ...cookies,
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

// 1. Гость: /subjects → каталог → предмет → урок; на «Квиз» — приглашение войти.
let page = await session();
let shot = shotOf(page);
await page.goto(`${base}/ru/subjects`);
await shot('guest-01-subjects', { fullPage: true });
await page.goto(`${base}/ru/learn/subjects`);
await page.getByTestId('catalog-section').first().waitFor();
await shot('guest-02-catalog', { fullPage: true });
await page.goto(`${base}/ru/learn/sections/${biology.id}`);
await page.getByTestId('catalog-subject').first().waitFor();
await shot('guest-03-section-soon');
await page.goto(`${base}/ru/learn/subjects/${anatomy.id}`);
await page.getByTestId('student-topic').first().waitFor();
await shot('guest-04-subject');
await page.goto(`${base}/ru/learn/topics/${cardio}`);
await page.getByTestId('lesson-overview').waitFor();
await page.locator('img').first().waitFor();
await shot('guest-05-lesson-overview');
await page.getByRole('button', { name: /Строение сердца/ }).click();
await page.getByTestId('section-illustration').waitFor();
await page.getByTestId('section-illustration').scrollIntoViewIfNeeded();
await shot('guest-06-section-illustration');
await page.goto(`${base}/ru/learn/topics/${cardio}?tab=quiz`);
await page.getByTestId('guest-invite').waitFor();
await shot('guest-07-quiz-invite');
await page.goto(`${base}/kk/learn/topics/${cardio}`);
await page.getByTestId('lesson-needs-review').waitFor();
await shot('guest-08-kk-needs-review');
await page.goto(`${base}/en/learn/topics/${cardio}`);
await page.getByTestId('lesson-overview').waitFor();
await shot('guest-09-en-six-sections', { fullPage: true });
await page.context().close();

// 2. Ученик: каталог со «Скоро», квиз базового урока и XP.
const studentApi = await request.newContext({ baseURL: base });
await studentApi.post('/api/auth/register-student', {
  data: { displayName: 'Асель', login: `shot.${uid}`, password: 'student-pass-1' },
});
const cookies = (await studentApi.storageState()).cookies.map(({ name, value }) => ({
  name,
  value,
  url: base,
}));
page = await session(cookies);
shot = shotOf(page);
await page.goto(`${base}/ru/learn/subjects`);
await page.getByTestId('catalog-subject').first().waitFor();
await shot('student-01-catalog', { fullPage: true });
await page.goto(`${base}/ru/learn/topics/${cardio}?tab=quiz`);
const next = async () => {
  await page.getByTestId('quiz-feedback').filter({ hasText: /./ }).waitFor();
  await page.getByTestId('quiz-next').click();
};
await page.getByTestId('quiz-option').filter({ hasText: 'Аорта' }).click();
await shot('student-02-quiz-answer');
await next();
await page.locator('input[id^="answer-"]').fill('4');
await page.getByRole('button', { name: 'Ответить' }).click();
await next();
await page.getByTestId('quiz-option').filter({ hasText: 'Левый желудочек' }).click();
await next();
await page.getByTestId('quiz-option').filter({ hasText: 'Неверно' }).click();
await next();
await page.getByTestId('quiz-option').filter({ hasText: 'В малом (лёгочном)' }).click();
await next();
await page.getByTestId('quiz-result').waitFor();
await page.waitForTimeout(800);
await shot('student-03-quiz-result-xp');
await page.goto(`${base}/ru/learn/subjects/${anatomy.id}`);
await page.getByTestId('student-topic').first().waitFor();
await shot('student-04-subject-mastered');
await page.context().close();

// 3. Учитель: базовый предмет в кабинете учителя — 404 (BR-ACL-05).
const teacherApi = await request.newContext({ baseURL: base });
await teacherApi.post('/api/auth/register', {
  data: { role: 'teacher', email: `shot.${uid}@example.kz`, displayName: 'Алия', password: 'teacher-pass-1' },
});
const teacherCookies = (await teacherApi.storageState()).cookies.map(({ name, value }) => ({
  name,
  value,
  url: base,
}));
page = await session(teacherCookies);
shot = shotOf(page);
await page.goto(`${base}/ru/teacher/subjects/${anatomy.id}`);
await shot('teacher-01-base-subject-404');
await browser.close();
