import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { answerAny, answerAtlas, type QuizElement } from './atlas-solver';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const st = ru.student;
const T = ru.test;
const uid = () => randomUUID().slice(0, 8);
const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((acc, [k, x]) => acc.replace(`{${k}}`, String(x)), s);

async function apiAs(baseURL: string, body: object, path = '/api/auth/register'): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post(path, { data: body });
  expect(res.status(), `${path} ${await res.text()}`).toBeLessThan(300);
  return ctx;
}
const csrfOf = async (ctx: APIRequestContext) =>
  (await ctx.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
async function post(ctx: APIRequestContext, path: string, data: object = {}) {
  const res = await ctx.post(path, { data, headers: { 'X-CSRF-Token': await csrfOf(ctx) } });
  expect(res.status(), `${path} ${await res.text()}`).toBeLessThan(300);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function put(ctx: APIRequestContext, path: string, data: object) {
  const res = await ctx.put(path, { data, headers: { 'X-CSRF-Token': await csrfOf(ctx) } });
  expect(res.status()).toBeLessThan(300);
}
async function signIn(page: Page, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

const choice = (n: number) => ({
  type: 'single_choice',
  difficulty: n === 1 ? 'easy' : n === 4 ? 'hard' : 'medium',
  translations: { ru: { text: `Вопрос ${n}?`, explanation: `Объяснение ${n}` } },
  options: [0, 1, 2, 3].map((i) => ({ translations: { ru: `Ответ ${n}.${i}` }, isCorrect: i === 0 })),
});

/** Тема с 4 вопросами выбора, «Верно/Неверно» и вводом ответа; ученик в классе. */
async function setup(baseURL: string) {
  const teacher = await apiAs(baseURL, {
    role: 'teacher',
    email: `t1.${uid()}@example.kz`,
    displayName: 'Учитель',
    password: 'teacher-pass-1',
  });
  const cls = await post(teacher, '/api/teacher/classes', { name: '7 «В»' });
  const { code } = await post(teacher, `/api/teacher/classes/${cls.id}/invite-codes`);
  const subject = await post(teacher, '/api/teacher/subjects', {
    translations: { ru: { title: `Физика ${uid()}` } },
    inPublicCatalog: false,
  });
  await post(teacher, `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
  const topic = await post(teacher, `/api/teacher/subjects/${subject.id}/topics`);
  await put(teacher, `/api/teacher/topics/${topic.id}`, {
    translations: { ru: { title: 'Свет', description: 'Оптика', bodyMd: '## Свет\n\nТекст урока' } },
    materialIds: [],
  });
  for (let n = 1; n <= 4; n++)
    await post(teacher, `/api/teacher/topics/${topic.id}/quiz/questions`, choice(n));
  await post(teacher, `/api/teacher/topics/${topic.id}/quiz/questions`, {
    type: 'true_false',
    difficulty: 'easy',
    translations: { ru: { text: 'Свет — это волна?', explanation: 'Свет — электромагнитная волна.' } },
    options: [
      { translations: {}, isCorrect: true },
      { translations: {}, isCorrect: false },
    ],
  });
  await post(teacher, `/api/teacher/topics/${topic.id}/quiz/questions`, {
    type: 'text_input',
    difficulty: 'medium',
    translations: { ru: { text: 'Как называется наука о свете?' } },
    textAnswer: 'Оптика',
  });
  await post(teacher, `/api/teacher/topics/${topic.id}/publish`);
  const student = await apiAs(
    baseURL,
    { displayName: 'Ерлан', login: `t1s.${uid()}`, password: 'student-pass-1', code },
    '/api/auth/register-student',
  );
  return { student, topicId: topic.id as string };
}

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const option = (page: Page, text: string) => page.getByTestId('quiz-option').filter({ hasText: text });
const segment = (page: Page, i: number) => page.getByTestId('quiz-segments').locator('li').nth(i);

/** Пройти тест темы целиком: верно — «….0», «Верно», «Оптика». */
async function passAllCorrect(page: Page) {
  for (let n = 1; n <= 4; n++) {
    await option(page, `Ответ ${n}.0`).click();
    await page.getByTestId('quiz-next').click();
  }
  await page
    .getByTestId('quiz-option')
    .filter({ has: page.getByRole('radio', { name: st.quiz.correct, exact: true }) })
    .click();
  await page.getByTestId('quiz-next').click();
  await page.getByLabel(st.quiz.answerLabel).fill('оптика');
  await page.keyboard.press('Enter');
  await page.getByTestId('quiz-next').click();
}

test.describe('Тестирование T1 (docs/TESTS_TZ.md)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-TST-01, AC-TST-02, AC-TST-04, AC-TST-05, AC-TST-06 the topic test: keys, feedback, «50/50», segments, streak, result, «Повторить ошибки»', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const { student, topicId } = await setup(baseURL!);
    await signIn(page, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);

    // «Ход попытки»: 6 делений, «Вопрос 1 из 6», сложность (REQ-TST-02).
    const panel = page.getByTestId('quiz-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('quiz-segments').locator('li')).toHaveCount(6);
    await expect(segment(page, 0)).toHaveAttribute('data-state', 'current');
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      fill(st.quiz.progress, { index: 1, count: 6 }),
    );
    await expect(page.getByTestId('quiz-difficulty')).toHaveText(st.quiz.difficulty.easy);
    await expect(page.getByTestId('quiz-hint')).toHaveText(fill(T.hintLeft, { count: 3 }));

    // Клавиша «2» выбирает B, Enter отвечает (REQ-TST-03.1); неверно: правильный подсвечен, объяснение, урок.
    await blur(page);
    await page.keyboard.press('2');
    await expect(option(page, 'Ответ 1.1').getByRole('radio')).toBeChecked();
    await page.keyboard.press('Enter');
    const feedback = page.getByTestId('quiz-feedback');
    await expect(feedback).toContainText(st.quiz.incorrect);
    await expect(feedback).toContainText('Объяснение 1');
    await expect(option(page, 'Ответ 1.0')).toHaveAttribute('data-state', 'correct');
    await expect(option(page, 'Ответ 1.1')).toHaveAttribute('data-state', 'wrong');
    await expect(page.getByTestId('quiz-open-lesson')).toHaveAttribute(
      'href',
      new RegExp(`${topicId}\\?tab=overview`),
    );
    await expect(segment(page, 0)).toHaveAttribute('data-state', 'wrong');
    // Без автоперехода: Enter — «Далее» (REQ-TST-01.2).
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      fill(st.quiz.progress, { index: 1, count: 6 }),
    );
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      fill(st.quiz.progress, { index: 2, count: 6 }),
    );

    // «50/50»: два неверных варианта убраны сервером, осталось 2 (REQ-TST-04).
    await page.getByTestId('quiz-hint').click();
    await expect(page.locator('[data-testid="quiz-option"][data-state="removed"]')).toHaveCount(2);
    await expect(option(page, 'Ответ 2.0')).not.toHaveAttribute('data-state', 'removed');
    await expect(page.getByTestId('quiz-hint')).toHaveText(fill(T.hintLeft, { count: 2 }));
    await expect(page.getByTestId('quiz-hint')).toBeDisabled();
    await expectNoSeriousA11yViolations(page);
    await option(page, 'Ответ 2.0').click();
    await expect(segment(page, 1)).toHaveAttribute('data-state', 'hinted');
    await page.getByTestId('quiz-next').click();

    // Клавиша «A» и Enter; серия появляется от 2 (REQ-TST-02.2).
    await expect(page.getByTestId('quiz-streak')).toHaveCount(0);
    await blur(page);
    await page.keyboard.press('a');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText(st.quiz.correct);
    await expect(page.getByTestId('quiz-streak')).toHaveText(fill(T.streak, { count: 2 }));
    await page.getByTestId('quiz-next').click();
    await expect(page.getByTestId('quiz-difficulty')).toHaveText(st.quiz.difficulty.hard);
    await option(page, 'Ответ 4.0').click();
    await page.getByTestId('quiz-next').click();

    // «Верно/Неверно» — две крупные кнопки, клавиши 1/2, без «50/50» (REQ-TST-03.4, REQ-TST-04.4).
    await expect(page.getByTestId('quiz-option')).toHaveCount(2);
    await expect(page.getByTestId('quiz-hint')).toHaveCount(0);
    await blur(page);
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('Свет — электромагнитная волна.');
    await page.getByTestId('quiz-next').click();

    // Ввод ответа: Enter — проверить (REQ-TST-03.3).
    await page.getByLabel(st.quiz.answerLabel).fill('  оптика ');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText(st.quiz.correct);
    await expect(page.getByTestId('quiz-streak')).toHaveText(fill(T.streak, { count: 5 }));
    await page.getByTestId('quiz-next').click();

    // Результат (REQ-TST-05): 5 из 6 = 83 %, с подсказкой 1, XP = round(20 × (4 + 0,5) / 6) = 15, ошибки.
    const result = page.getByTestId('quiz-result');
    await expect(result).toContainText(fill(st.quiz.result, { score: 83 }));
    await expect(page.getByTestId('quiz-ring')).toHaveAttribute(
      'aria-label',
      fill(T.result.chart, { percent: 83 }),
    );
    await expect(page.getByTestId('quiz-hinted')).toHaveText(fill(T.result.hinted, { count: 1 }));
    await expect(page.getByTestId('quiz-xp')).toHaveText(fill(st.quiz.xp, { xp: 15 }));
    await expect(page.getByTestId('quiz-compare')).toHaveText(fill(T.result.best, { percent: 83 }));
    const mistakes = page.getByTestId('quiz-mistakes');
    await expect(mistakes.locator('li')).toHaveCount(1);
    await expect(mistakes).toContainText('Вопрос 1?');
    await expect(mistakes).toContainText(fill(T.result.yours, { answer: 'Ответ 1.1' }));
    await expect(mistakes).toContainText(fill(T.result.right, { answer: 'Ответ 1.0' }));
    await mistakes.getByText(T.result.explanation, { exact: true }).click();
    await expect(mistakes).toContainText('Объяснение 1');
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // «Повторить ошибки» — новая попытка той же темы; всё верно → «+17 к прошлой попытке», лучший — 100 %.
    await page.getByTestId('quiz-retry-mistakes').click();
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      fill(st.quiz.progress, { index: 1, count: 6 }),
    );
    await passAllCorrect(page);
    await expect(page.getByTestId('quiz-compare')).toContainText(fill(T.result.best, { percent: 100 }));
    await expect(page.getByTestId('quiz-compare')).toContainText(fill(T.result.delta, { delta: '+17' }));
    // Прирост XP: 20 − 15 = 5.
    await expect(page.getByTestId('quiz-xp')).toHaveText(fill(st.quiz.xp, { xp: 5 }));
    await expect(page.getByTestId('quiz-mistakes')).toHaveCount(0);
    await page.getByTestId('quiz-to-lesson').click();
    await expect(page).toHaveURL(/\?tab=overview$/);
  });

  test('REQ-TST-06 layout: two columns on a computer, «Ход попытки» on top on a phone; «× Завершить» asks and keeps the answers', async ({
    page,
    baseURL,
  }, info) => {
    const { student, topicId } = await setup(baseURL!);
    await signIn(page, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    const panel = await page.getByTestId('quiz-panel').boundingBox();
    const question = await page.getByTestId('quiz-question-text').boundingBox();
    if (info.project.name === 'desktop-1440') {
      expect(panel!.x).toBeGreaterThan(question!.x + question!.width - 1);
      expect((await page.getByTestId('student-quiz').boundingBox())!.width).toBeGreaterThan(1000);
    } else {
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(question!.y + 1);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await option(page, 'Ответ 1.0').click();
    await page.getByTestId('quiz-exit').click();
    const dialog = page.getByRole('dialog', { name: T.exitTitle });
    await expect(dialog).toContainText(T.exitSaved);
    await dialog.getByRole('button', { name: T.exitCancel }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByTestId('quiz-exit').click();
    await page.getByTestId('quiz-exit-confirm').click();
    await expect(page).toHaveURL(/\?tab=overview$/);
    // Незавершённая попытка продолжается (BR-QZ-06).
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      fill(st.quiz.progress, { index: 2, count: 6 }),
    );
    await expect(segment(page, 0)).toHaveAttribute('data-state', 'correct');
  });
});

/* ---------------- Атлас ---------------- */

async function chemistry(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const atlas = await (await api.get(`/api/public/subjects/${id}/atlas`)).json();
  return {
    id,
    base: `/ru/learn/subjects/${id}`,
    elements: atlas.elements as QuizElement[],
  };
}

async function atlasStudent(page: Page, baseURL: string) {
  const api = await apiAs(
    baseURL,
    { displayName: 'Айдана Тест', login: `t1a.${uid()}`, password: 'student-pass-1' },
    '/api/auth/register-student',
  );
  await signIn(page, api, baseURL);
  return api;
}

test.describe('Тестирование T1 в атласе (docs/TESTS_TZ.md)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-TST-03, AC-TST-01, AC-TST-06 the atlas quiz: difficulty dots, a level-up message, the explanation, «50/50», families, «Повторить ошибки»', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await atlasStudent(page, baseURL!);
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atest-difficulty')).toContainText(T.difficulty.medium);
    await expect(page.getByTestId('atest-panel')).toContainText(T.difficulty.adaptive);

    // «50/50» — на первом из трёх вопросов, где она есть (у «Верно/Неверно» и ввода её нет): убраны 2 варианта
    // или подсвечены 2 периода таблицы. Типы вопросов случайные (REQ-TST-10) — ответ ищет общий решатель.
    let hinted = 0;
    for (let i = 1; i <= 3; i++) {
      const hint = page.getByTestId('atest-hint');
      if (!hinted && (await hint.isVisible()) && (await hint.isEnabled())) {
        await hint.click();
        if (await page.getByTestId('atest-table').isVisible())
          await expect(page.locator('.atest-table-status')).toContainText(T.table.hint);
        else await expect(page.locator('[data-testid="atest-option"][data-state="removed"]')).toHaveCount(2);
        hinted = 1;
      }
      await answerAtlas(page, chem.elements);
      // Верный ответ — свечение и объяснение «Это {название} (…)».
      await expect(page.getByTestId('atest-feedback')).toContainText(T.correct);
      await expect(page.getByTestId('atest-explanation')).toContainText(' (');
      await expect(page.getByTestId('atest-lesson')).toHaveAttribute('href', /\/explore\//);
      await page.getByTestId('atest-next').click();
    }
    // Три верных из трёх — уровень выше (REQ-TST-02.3).
    await expect(page.getByTestId('atest-level')).toHaveText(T.levelUp);
    await expect(page.getByTestId('atest-difficulty')).toContainText(T.difficulty.hard);
    await expect(page.getByTestId('atest-streak')).toHaveText(`🔥 ${fill(T.streak, { count: 3 })}`);
    await expectNoSeriousA11yViolations(page);

    // Остальные — заведомо неверно (другой вариант, другая ячейка, другой символ).
    for (let i = 4; i <= 10; i++) {
      await answerAtlas(page, chem.elements, true);
      await expect(page.getByTestId('atest-feedback')).toContainText(T.incorrect);
      await page.getByTestId('atest-next').click();
    }
    const result = page.getByTestId('atlas-quiz-result');
    await expect(result).toBeVisible();
    await expect(result.locator('.atest-result-title')).toHaveText(
      fill(T.result.score, { correct: 3, total: 10 }),
    );
    if (hinted) await expect(result).toContainText(fill(T.result.hinted, { count: 1 }));
    // XP: с подсказкой 2 + 0,5 = 2,5 → 2, без неё — 3 (BR-TST-01).
    await expect(page.getByTestId('atlas-quiz-xp')).toHaveText(fill(st.quiz.xp, { xp: hinted ? 2 : 3 }));
    await expect(page.getByTestId('atlas-quiz-families').locator('li').first()).toBeVisible();
    await expect(page.getByTestId('atlas-quiz-mistakes').locator('li')).toHaveCount(7);
    await expectNoSeriousA11yViolations(page);
    // «Повторить ошибки» — 7 вопросов по ошибочным элементам.
    await page.getByTestId('atlas-quiz-retry-mistakes').click();
    await expect(page.getByTestId('atest-progress')).toHaveText(fill(T.progress, { index: 1, count: 7 }));
  });

  test('AC-TST-04, REQ-TST-03.5 the element test in the atlas supports all three platform types (choice, true/false, text input)', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await atlasStudent(page, baseURL!);
    // В тестах элементов сейчас только выбор варианта: вопросы других типов подставляются в ответ API-S-07.
    const ids = { tf: '00000000-0000-7000-8000-0000000000a1', text: '00000000-0000-7000-8000-0000000000a2' };
    await page.route('**/api/student/quizzes/*/attempts', (route) =>
      route.fulfill({
        json: {
          attemptId: '00000000-0000-7000-8000-0000000000aa',
          questions: [
            {
              id: ids.tf,
              type: 'true_false',
              difficulty: 'easy',
              text: 'Кислород — газ при комнатной температуре?',
              options: [
                { id: 'tf-true', text: 'Верно' },
                { id: 'tf-false', text: 'Неверно' },
              ],
            },
            {
              id: ids.text,
              type: 'text_input',
              difficulty: 'medium',
              text: 'Символ кислорода?',
              options: [],
            },
          ],
          answered: {},
          hints: {},
          hintsLeft: 3,
        },
      }),
    );
    await page.route('**/api/student/attempts/*/answers', async (route) => {
      const body = route.request().postDataJSON();
      const tf = body.questionId === ids.tf;
      await route.fulfill({
        json: {
          correct: tf ? body.optionId === 'tf-true' : body.textAnswer?.trim() === 'O',
          hinted: false,
          correctOptionId: tf ? 'tf-true' : null,
          correctAnswer: tf ? null : 'O',
          explanation: tf ? 'Кислород — газ.' : null,
        },
      });
    });
    await page.route('**/api/student/attempts/*/finish', (route) =>
      route.fulfill({
        json: { scorePercent: 50, xpAwarded: 10, badgesAwarded: [], bestPercent: 50, previousPercent: null },
      }),
    );
    await page.goto(`${chem.base}/explore/oxygen/test`);
    await expect(page.getByTestId('atlas-test')).toBeVisible();
    // «Верно/Неверно»: две кнопки, клавиша 1 и Enter.
    await expect(page.getByTestId('atest-option')).toHaveCount(2);
    await expect(page.getByTestId('atest-hint')).toHaveCount(0);
    await page.getByTestId('atest-question').click();
    await page.keyboard.press('1');
    await expect(page.getByTestId('atest-option').first()).toHaveAttribute('data-state', 'selected');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('atest-feedback')).toContainText('Кислород — газ.');
    await page.getByTestId('atest-next').click();
    // Ввод ответа: Enter — проверить; неверно — правильный ответ.
    await page.getByLabel(T.answerLabel).fill('Ox');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('atest-feedback')).toContainText(fill(T.correctAnswer, { answer: 'O' }));
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('atest-next').click();
    await expect(page.getByTestId('atlas-test-result')).toBeVisible();
    await expect(page.getByTestId('atlas-test-xp')).toHaveText(fill(st.quiz.xp, { xp: 10 }));
    await expect(page.getByTestId('atlas-test-mistakes')).toContainText(
      fill(T.result.right, { answer: 'O' }),
    );
  });

  test('AC-TST-12 a teacher previews the atlas quiz with «50/50», nothing is recorded', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const api = await request.newContext({ baseURL });
    const res = await api.post('/api/auth/login', {
      data: {
        email: 'teacher@syntara.local',
        password: process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password',
      },
    });
    expect(res.status()).toBe(200);
    await signIn(page, api, baseURL!);
    let hintCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/hint')) hintCalls++;
    });
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atlas-quiz-preview')).toContainText(ru.atlas.preview.note);
    // Первый вопрос с «50/50» (у «Верно/Неверно» и ввода её нет — REQ-TST-10): убраны 2 варианта или подсвечены 2 периода.
    while (!(await page.getByTestId('atest-hint').isVisible())) {
      await answerAny(page);
      await page.getByTestId('atest-next').click();
    }
    await page.getByTestId('atest-hint').click();
    if (await page.getByTestId('atest-table').isVisible())
      await expect(page.locator('.atest-table-status')).toContainText(T.table.hint);
    else await expect(page.locator('[data-testid="atest-option"][data-state="removed"]')).toHaveCount(2);
    await expect(page.getByTestId('atest-hint')).toHaveText(fill(T.hintLeft, { count: 2 }));
    expect(hintCalls).toBe(0);
    // «× Завершить» у учителя: прогресс не сохраняется — возврат на стартовый экран.
    await page.getByTestId('atest-exit').click();
    await expect(page.getByTestId('atest-exit-dialog')).toContainText(T.exitLost);
    await page.getByTestId('atest-exit-confirm').click();
    await expect(page.getByTestId('atlas-quiz-intro')).toBeVisible();
  });
});
