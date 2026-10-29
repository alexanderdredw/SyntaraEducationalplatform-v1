/* global document */
// Снимки T1 (docs/TESTS_TZ.md, этап T1c): тест темы платформы, тест элемента атласа, квиз «Проверь знания» —
// вопрос, ответ с объяснением, результат; 1440 и 390 px; тёмная тема (платформа — и светлая).
// → docs/media/tests/*.webp (WebP q85, ширина ≤ 1600 px). Нужны запущенные web и api (сид demo с content/).
// Объяснения тестов элементов ещё не в content/ (ждут утверждения, REQ-TST-09.2): для снимка теста атласа объяснение
// вопроса берётся из docs/TEST_EXPLANATIONS.md и подставляется в ответ API только в браузере съёмки.
// Запуск из папки e2e: node scripts/tests-shots.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, request } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const out = `${root}docs/media/tests/`;
mkdirSync(out, { recursive: true });
const MAX_H = 3200;
const uid = () => randomUUID().slice(0, 8);

/** Черновик объяснения из docs/TEST_EXPLANATIONS.md по тексту вопроса. */
const drafts = new Map();
{
  const lines = readFileSync(`${root}docs/TEST_EXPLANATIONS.md`, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const q = /^- \*\*[\w-]+\.\*\* (.+) — \*\*.+\*\*$/.exec(lines[i]);
    const e = /^\s+Объяснение: (.+)$/.exec(lines[i + 1] ?? '');
    if (q && e) drafts.set(q[1], e[1]);
  }
}

async function json(ctx, method, path, data) {
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'csrf')?.value;
  const res = await ctx[method](path, { data, headers: csrf ? { 'X-CSRF-Token': csrf } : {} });
  if (res.status() >= 300) throw new Error(`${path} ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Тема платформы с объяснениями: 4 вопроса выбора, «Верно/Неверно», ввод; ученик в классе. */
async function platformTopic() {
  const teacher = await request.newContext({ baseURL: base });
  await json(teacher, 'post', '/api/auth/register', {
    role: 'teacher',
    email: `shots.${uid()}@example.kz`,
    displayName: 'Учитель',
    password: 'teacher-pass-1',
  });
  const cls = await json(teacher, 'post', '/api/teacher/classes', { name: '7 «А»' });
  const { code } = await json(teacher, 'post', `/api/teacher/classes/${cls.id}/invite-codes`);
  const subject = await json(teacher, 'post', '/api/teacher/subjects', {
    translations: { ru: { title: 'Физика' } },
    inPublicCatalog: false,
  });
  await json(teacher, 'post', `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
  const topic = await json(teacher, 'post', `/api/teacher/subjects/${subject.id}/topics`);
  await json(teacher, 'put', `/api/teacher/topics/${topic.id}`, {
    translations: {
      ru: { title: 'Свет и оптика', description: 'Как распространяется свет', bodyMd: '## Свет' },
    },
    materialIds: [],
  });
  const choice = (text, options, explanation, difficulty) => ({
    type: 'single_choice',
    difficulty,
    translations: { ru: { text, explanation } },
    options: options.map((o, i) => ({ translations: { ru: o }, isCorrect: i === 0 })),
  });
  const qs = [
    choice(
      'С какой скоростью свет распространяется в вакууме?',
      ['Около 300 000 км/с', 'Около 300 км/с', 'Около 30 000 км/с', 'Около 3 000 000 км/с'],
      'Скорость света в вакууме — около 300 000 км/с; быстрее в природе ничто не движется.',
      'easy',
    ),
    choice(
      'Как называется отклонение света при переходе из одной среды в другую?',
      ['Преломление', 'Отражение', 'Дифракция', 'Поглощение'],
      'При переходе в другую среду скорость света меняется, и луч отклоняется — это преломление.',
      'medium',
    ),
    choice(
      'Какой цвет видимого света имеет наибольшую длину волны?',
      ['Красный', 'Фиолетовый', 'Зелёный', 'Синий'],
      'Красный свет — самый длинноволновый в видимом спектре, фиолетовый — самый коротковолновый.',
      'hard',
    ),
    choice(
      'Из чего состоит белый свет?',
      ['Из смеси всех цветов спектра', 'Только из жёлтого', 'Из красного и синего', 'Ни из каких цветов'],
      'Призма раскладывает белый свет на цвета радуги — значит, он состоит из всех цветов спектра.',
      'medium',
    ),
  ];
  for (const q of qs) await json(teacher, 'post', `/api/teacher/topics/${topic.id}/quiz/questions`, q);
  await json(teacher, 'post', `/api/teacher/topics/${topic.id}/quiz/questions`, {
    type: 'true_false',
    difficulty: 'easy',
    translations: {
      ru: {
        text: 'Свет — это электромагнитная волна?',
        explanation: 'Да: видимый свет — часть электромагнитного спектра.',
      },
    },
    options: [
      { translations: {}, isCorrect: true },
      { translations: {}, isCorrect: false },
    ],
  });
  await json(teacher, 'post', `/api/teacher/topics/${topic.id}/publish`, {});
  const students = [];
  for (let i = 0; i < 4; i++) {
    const s = await request.newContext({ baseURL: base });
    await json(s, 'post', '/api/auth/register-student', {
      displayName: 'Айгерим',
      login: `shots.${uid()}`,
      password: 'student-pass-1',
      code,
    });
    students.push((await s.storageState()).cookies);
  }
  return { topicId: topic.id, students };
}

async function atlasStudent() {
  const ctx = await request.newContext({ baseURL: base });
  await json(ctx, 'post', '/api/auth/register-student', {
    displayName: 'Айдана Атлас',
    login: `shots.${uid()}`,
    password: 'student-pass-1',
  });
  return (await ctx.storageState()).cookies;
}

const api = await request.newContext({ baseURL: base });
const catalog = await (await api.get('/api/public/catalog')).json();
const natural = catalog.sections.find((s) => s.title === 'Естественные науки');
const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
const chemistry = section.subjects.find((s) => s.title === 'Химия').id;
const atlas = await (await api.get(`/api/public/subjects/${chemistry}/atlas`)).json();
const S = `/ru/learn/subjects/${chemistry}`;

/** Правильный вариант загадки квиза: «___» — любое слово, совпадение с описанием или фактом. */
function solve(text, options) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(text.split('___').map(escape).join('.+?'), 'i');
  return options.find((title) => {
    const e = atlas.elements.find((x) => x.title === title);
    return e && [e.description, e.funFact].some((s) => s && pattern.test(s));
  });
}

const browser = await chromium.launch();
async function shot(page, name, { full = false } = {}) {
  const vw = page.viewportSize().width;
  await page.waitForTimeout(700);
  let png;
  if (full) {
    const height = Math.min(MAX_H, await page.evaluate(() => document.documentElement.scrollHeight));
    png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vw, height } });
  } else png = await page.screenshot();
  await sharp(png)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${name}.webp`);
  console.warn('saved', name);
}

async function context(cookies, width, theme) {
  const ctx = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await ctx.addCookies([
    ...cookies.map(({ name, value }) => ({ name, value, url: base })),
    { name: 'theme', value: theme, url: base },
    { name: 'consent', value: 'necessary', url: base },
  ]);
  return ctx;
}

/* ---------- Тест темы платформы ---------- */
const platform = await platformTopic();
let n = 0;
for (const width of [1440, 390]) {
  for (const theme of ['dark', 'light']) {
    const ctx = await context(platform.students[n++], width, theme);
    const page = await ctx.newPage();
    await page.goto(`${base}/ru/learn/topics/${platform.topicId}?tab=quiz`, { waitUntil: 'networkidle' });
    const option = (text) => page.getByTestId('quiz-option').filter({ hasText: text });
    // Вопрос: первый — верно (серия, полоса), второй — «50/50».
    await option('Около 300 000 км/с').click();
    await page.getByTestId('quiz-next').click();
    await page.getByTestId('quiz-hint').click();
    await page.locator('[data-testid="quiz-option"][data-state="removed"]').first().waitFor();
    await page.getByTestId('student-quiz').scrollIntoViewIfNeeded();
    await shot(page, `platform-question-${width}-${theme}`);
    // Ответ: неверно — правильный вариант, объяснение, «Открыть урок →».
    await page
      .locator('[data-testid="quiz-option"][data-state="idle"]')
      .filter({ hasNotText: 'Преломление' })
      .first()
      .click();
    await page.getByTestId('quiz-feedback').locator('p').first().waitFor();
    await page.getByTestId('quiz-next').scrollIntoViewIfNeeded();
    await shot(page, `platform-answer-${width}-${theme}`);
    await page.getByTestId('quiz-next').click();
    for (const text of ['Красный', 'Из смеси всех цветов спектра']) {
      await option(text).click();
      await page.getByTestId('quiz-next').click();
    }
    await page.getByTestId('quiz-option').first().click();
    await page.getByTestId('quiz-next').click();
    await page.getByTestId('quiz-result').waitFor();
    await page.getByTestId('quiz-mistakes').locator('summary').first().click();
    await page.evaluate(() => document.defaultView.scrollTo(0, 0));
    await shot(page, `platform-result-${width}-${theme}`, { full: true });
    await ctx.close();
  }
}

/* ---------- Тест элемента атласа (кислород) ---------- */
for (const width of [1440, 390]) {
  const ctx = await context(await atlasStudent(), width, 'dark');
  const page = await ctx.newPage();
  await page.route('**/api/student/attempts/*/answers', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const question = JSON.parse(route.request().postData() ?? '{}').questionId;
    const text = await page.evaluate(
      (id) => document.querySelector(`[data-testid="atest-question"]`)?.textContent ?? id,
      question,
    );
    await route.fulfill({
      response: res,
      json: { ...body, explanation: body.explanation ?? drafts.get(text) ?? null },
    });
  });
  await page.goto(`${base}${S}/explore/oxygen/test`, { waitUntil: 'networkidle' });
  const test = page.getByTestId('atlas-test');
  await test.waitFor();
  await page.getByTestId('atest-hint').click();
  await page.locator('[data-testid="atest-option"][data-state="removed"]').first().waitFor();
  await page.getByTestId('atest-panel').scrollIntoViewIfNeeded();
  await shot(page, `atlas-test-question-${width}-dark`);
  // Ответ «8» — верно, свечение цветом элемента, объяснение.
  const right = page.locator('[data-testid="atest-option"]').filter({ hasText: /^A?B?C?D?8$/ });
  if (await right.count()) await right.first().click();
  else await page.locator('[data-testid="atest-option"]:not([aria-disabled])').first().click();
  await page.getByTestId('atest-feedback').locator('p').first().waitFor();
  await page.getByTestId('atest-next').scrollIntoViewIfNeeded();
  await shot(page, `atlas-test-answer-${width}-dark`);
  for (let i = 0; i < 5; i++) {
    const next = page.getByTestId('atest-next');
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    const opt = page.locator('[data-testid="atest-option"]:not([aria-disabled])').first();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click();
      await page.getByTestId('atest-feedback').locator('p').first().waitFor();
    }
  }
  await page.getByTestId('atlas-test-result').waitFor();
  await page.getByTestId('atlas-test-result').scrollIntoViewIfNeeded();
  await shot(page, `atlas-test-result-${width}-dark`);
  await ctx.close();
}

/* ---------- Квиз «Проверь знания» ---------- */
for (const width of [1440, 390]) {
  const ctx = await context(await atlasStudent(), width, 'dark');
  const page = await ctx.newPage();
  await page.goto(`${base}${S}/quiz`, { waitUntil: 'networkidle' });
  await page.getByTestId('atlas-quiz-start').click();
  await page.getByTestId('atest-question').waitFor();
  const options = async () =>
    (
      await page
        .locator('[data-testid="atest-option"]:not([aria-disabled]) .atest-opt-text')
        .allTextContents()
    ).map((s) => s.trim());
  const pick = (title) =>
    page.locator('[data-testid="atest-option"]').filter({ has: page.getByText(title, { exact: true }) });
  // Два верных — серия; третий вопрос — снимок вопроса с «50/50».
  for (let i = 0; i < 2; i++) {
    const right = solve(await page.getByTestId('atest-question').textContent(), await options());
    await pick(right ?? (await options())[0]).click();
    await page.getByTestId('atest-next').click();
  }
  await page.getByTestId('atest-hint').click();
  await page.locator('[data-testid="atest-option"][data-state="removed"]').first().waitFor();
  await shot(page, `atlas-quiz-question-${width}-dark`);
  const right = solve(await page.getByTestId('atest-question').textContent(), await options());
  await pick(right ?? (await options())[0]).click();
  await page
    .getByTestId('atest-explanation')
    .waitFor()
    .catch(() => {});
  await page.getByTestId('atest-next').scrollIntoViewIfNeeded();
  await shot(page, `atlas-quiz-answer-${width}-dark`);
  await page.getByTestId('atest-next').click();
  // Остальные: через один — верно и неверно, чтобы в результате были ошибки и семейства.
  for (let i = 4; i <= 10; i++) {
    const all = await options();
    const r = solve(await page.getByTestId('atest-question').textContent(), all);
    await pick(i % 2 ? (all.find((o) => o !== r) ?? all[0]) : (r ?? all[0])).click();
    await page.getByTestId('atest-next').click();
  }
  await page.getByTestId('atlas-quiz-result').waitFor();
  await page.evaluate(() => document.defaultView.scrollTo(0, 0));
  await shot(page, `atlas-quiz-result-${width}-dark`, { full: true });
  await ctx.close();
}

await browser.close();
