// Скриншоты итерации 9 (учебный ИИ) и доработок этапа 8.6 на реальном стеке.
// Запуск: node e2e/scripts/tutor-shots.mjs <каталог> [baseURL] [--mock]
// Без --mock api должен быть запущен с AI_TUTOR_FIXTURE=true (детерминированный поток вместо модели);
// с --mock — в режиме по умолчанию (LLM_PROVIDER=mock, PH-19): снимается только «Учебный ИИ скоро будет доступен».
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mock = process.argv.includes('--mock');
const out = args[0];
const base = args[1] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const guestApi = await request.newContext({ baseURL: base });
const catalog = await (await guestApi.get('/api/public/catalog')).json();
const biology = catalog.sections.find((s) => s.title === 'Биология');
const natural = catalog.sections.find((s) => s.title === 'Естественные науки');
const section = await (await guestApi.get(`/api/public/sections/${biology.id}`)).json();
const anatomy = section.subjects.find((s) => s.title === 'Анатомия человека');
const subject = await (await guestApi.get(`/api/public/subjects/${anatomy.id}`)).json();
const cardio = subject.topics[0].id;

const browser = await chromium.launch();
async function session(cookies = [], width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
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
    await page.waitForTimeout(opts.wait ?? 400);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: opts.fullPage ?? false });
    log('screenshot', name);
  };
async function studentCookies() {
  const api = await request.newContext({ baseURL: base });
  const res = await api.post('/api/auth/register-student', {
    data: { displayName: 'Асель', login: `ai.${randomUUID().slice(0, 8)}`, password: 'student-pass-1' },
  });
  if (res.status() !== 201) throw new Error(`register-student: ${res.status()}`);
  return (await api.storageState()).cookies.map(({ name, value }) => ({ name, value, url: base }));
}

if (mock) {
  // BR-AI-06, PH-19: поставщик не подключён.
  const page = await session(await studentCookies());
  const shot = shotOf(page);
  await page.goto(`${base}/ru/learn/topics/${cardio}?tab=ai`);
  await page.locator('[data-testid="tutor-chat"][data-ready="true"]').waitFor();
  await page.getByPlaceholder('Задайте вопрос наставнику...').fill('Почему у сердца четыре камеры?');
  await page.getByTestId('tutor-ask').click();
  await page.getByTestId('tutor-unavailable').waitFor();
  await page.getByTestId('tutor-chat').scrollIntoViewIfNeeded();
  await shot('ai-10-mock-unavailable');
  await browser.close();
  process.exit(0);
}

// 1. Доработки 8.6 (гость): главная — 6 карточек и «Все предметы →»; «Химия» в «Естественных науках»;
//    приглашение на «Syntara AI»; иллюстрация раздела 336 px.
let page = await session();
let shot = shotOf(page);
await page.goto(`${base}/ru`);
await page.getByTestId('home-subjects').scrollIntoViewIfNeeded();
await shot('s86-01-home-six-subjects');
await page.goto(`${base}/ru/learn/sections/${natural.id}`);
await page.getByTestId('catalog-subject').first().waitFor();
await shot('s86-02-natural-sciences-chemistry');
await page.goto(`${base}/ru/learn/topics/${cardio}?tab=ai`);
await page.getByTestId('guest-invite').waitFor();
await shot('s86-03-guest-ai-invite');
await page.goto(`${base}/ru/learn/topics/${cardio}`);
await page.getByRole('button', { name: /Строение сердца/ }).click();
await page.getByTestId('section-illustration').scrollIntoViewIfNeeded();
await shot('s86-04-illustration-336');
await page.context().close();

// 2. Ученик: вкладка «Syntara AI» (U06–U07).
const cookies = await studentCookies();
page = await session(cookies);
shot = shotOf(page);
await page.goto(`${base}/ru/learn/topics/${cardio}?tab=ai`);
await page.locator('[data-testid="tutor-chat"][data-ready="true"]').waitFor();
await page.getByTestId('tutor-chat').scrollIntoViewIfNeeded();
await shot('ai-01-lesson-tab');
const input = page.getByPlaceholder('Задайте вопрос наставнику...');
await input.fill('Почему у сердца четыре камеры?');
await shot('ai-02-question-typed');
await input.press('Enter');
await page.getByTestId('tutor-assistant-message').last().getByText('word5').waitFor();
await shot('ai-03-streaming-stop');
await page.getByTestId('tutor-stop').click();
await page.getByTestId('tutor-interrupted').waitFor();
await shot('ai-04-interrupted');
await page.reload();
await page.getByTestId('tutor-interrupted').waitFor();
await page.getByTestId('tutor-chat').scrollIntoViewIfNeeded();
await shot('ai-05-after-reload');
await page.getByRole('button', { name: 'Объясни проще' }).click();
await page.locator('[data-testid="tutor-assistant-message"][data-status="complete"]').last().waitFor({
  timeout: 20_000,
});
await page.getByTestId('tutor-assistant-message').last().scrollIntoViewIfNeeded();
await shot('ai-06-quick-action-sanitized');
await page.context().close();

// 3. /learn/assistant (U02).
page = await session(cookies);
shot = shotOf(page);
await page.goto(`${base}/ru/learn/assistant`);
await page.locator('[data-testid="tutor-chat"][data-ready="true"]').waitFor();
await shot('ai-07-assistant');
await page.getByTestId('assistant-how').click();
await page.getByRole('dialog').waitFor();
await shot('ai-08-how-it-works');
await page.keyboard.press('Escape');
await page.getByTestId('assistant-start').click();
await page.keyboard.type('Что такое фотосинтез?');
await page.keyboard.press('Enter');
await page
  .locator('[data-testid="tutor-assistant-message"][data-status="complete"]')
  .waitFor({ timeout: 20_000 });
await shot('ai-09-assistant-answer', { fullPage: true });
await page.context().close();

// 4. Мобильная ширина 320 px.
page = await session(cookies, 320, 640);
shot = shotOf(page);
await page.goto(`${base}/ru/learn/topics/${cardio}?tab=ai`);
await page.locator('[data-testid="tutor-chat"][data-ready="true"]').waitFor();
await page.getByTestId('tutor-chat').scrollIntoViewIfNeeded();
await shot('ai-11-mobile-320', { fullPage: true });
await page.goto(`${base}/ru/learn/topics/${cardio}`);
await page.getByRole('button', { name: /Строение сердца/ }).click();
await page.getByTestId('section-illustration').scrollIntoViewIfNeeded();
await shot('s86-05-illustration-mobile');
await browser.close();
