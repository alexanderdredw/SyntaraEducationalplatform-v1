import { randomUUID } from 'node:crypto';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  switchCabinetLocale,
} from './support';

const ru = bundles.ru;
const st = ru.student;
const tt = ru.teacher;
const uid = () => randomUUID().slice(0, 8);

/** Вошедший через API контекст (cookie сессии и csrf). */
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
/** Перенести сессию API-контекста в браузер. */
async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

const question = (n: number) => ({
  type: 'single_choice',
  difficulty: n === 1 ? 'easy' : 'medium',
  translations: { ru: { text: `Вопрос ${n}?`, explanation: `Объяснение ${n}` }, kk: { text: `${n}-сұрақ?` } },
  options: [0, 1, 2, 3].map((i) => ({
    translations: { ru: `Ответ ${n}.${i}`, kk: `Жауап ${n}.${i}` },
    isCorrect: i === 0,
  })),
});

/** Учитель, класс, ученик в классе, опубликованная тема с квизом — через API (для сценариев урока). */
async function setup(baseURL: string, questions = 3) {
  const teacher = await apiAs(baseURL, {
    role: 'teacher',
    email: `lt.${uid()}@example.kz`,
    displayName: 'Учитель',
    password: 'teacher-pass-1',
  });
  const cls = await post(teacher, '/api/teacher/classes', { name: '8 «Б»' });
  const { code } = await post(teacher, `/api/teacher/classes/${cls.id}/invite-codes`);
  const subject = await post(teacher, '/api/teacher/subjects', {
    translations: { ru: { title: `Биология ${uid()}` }, kk: { title: 'Биология' } },
    inPublicCatalog: false,
  });
  await post(teacher, `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
  const topic = await post(teacher, `/api/teacher/subjects/${subject.id}/topics`);
  await put(teacher, `/api/teacher/topics/${topic.id}`, {
    translations: {
      ru: {
        title: 'Сердце',
        description: 'Камеры сердца',
        funFact: 'Около 100 000 ударов в сутки',
        bodyMd: '## Четыре камеры\n\nТекст урока',
      },
      kk: { title: 'Жүрек', description: 'Жүрек камералары', bodyMd: '## Төрт камера' },
    },
    materialIds: [],
  });
  for (let n = 1; n <= questions; n++)
    await post(teacher, `/api/teacher/topics/${topic.id}/quiz/questions`, question(n));
  await post(teacher, `/api/teacher/topics/${topic.id}/publish`);
  const login = `ls.${uid()}`;
  const student = await apiAs(
    baseURL,
    { displayName: 'Асель', login, password: 'student-pass-1', code },
    '/api/auth/register-student',
  );
  return {
    teacher,
    student,
    subjectId: subject.id as string,
    topicId: topic.id as string,
    classId: cls.id as string,
  };
}

async function answerOption(page: Page, text: string) {
  await page.getByTestId('quiz-option').filter({ hasText: text }).click();
  await expect(page.getByTestId('quiz-feedback')).not.toBeEmpty();
}

test.describe('Интерфейс ученика: обучение (итерация 8)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('E2E сквозной: учитель создаёт, выдаёт, публикует → ученик класса учится и получает XP; другие не видят; снятие и отзыв скрывают тему', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    // Учитель: класс с учеником — через API; предмет, выдача, тема и квиз — через интерфейс.
    const teacher = await apiAs(baseURL!, {
      role: 'teacher',
      email: `flow.${uid()}@example.kz`,
      displayName: 'Учитель',
      password: 'teacher-pass-1',
    });
    const cls = await post(teacher, '/api/teacher/classes', { name: `Класс ${uid()}` });
    const { code } = await post(teacher, `/api/teacher/classes/${cls.id}/invite-codes`);
    const student = await apiAs(
      baseURL!,
      { displayName: 'Асель', login: `flow.${uid()}`, password: 'student-pass-1', code },
      '/api/auth/register-student',
    );
    const outsider = await apiAs(
      baseURL!,
      { displayName: 'Чужой', login: `other.${uid()}`, password: 'student-pass-1' },
      '/api/auth/register-student',
    );

    await signIn(page.context(), teacher, baseURL!);
    const subjectTitle = `Ботаника ${uid()}`;
    await page.goto('/ru/teacher/subjects/new');
    await page
      .getByTestId('subject-form')
      .getByLabel(tt.subjectForm.name, { exact: true })
      .fill(subjectTitle);
    await page.getByTestId('subject-submit').click();
    await expect(page).toHaveURL(/\/teacher\/subjects\/[0-9a-f-]{36}$/);
    const subjectId = page.url().split('/').pop()!;
    await page
      .getByTestId('access-class')
      .filter({ hasText: cls.name })
      .getByRole('button', { name: tt.subject.grant })
      .click();
    await expect(
      page.getByTestId('access-class').filter({ hasText: cls.name }).getByText(tt.subject.granted),
    ).toBeVisible();
    await page.getByRole('button', { name: tt.subject.addTopic }).click();
    await expect(page).toHaveURL(/\/teacher\/topics\/[0-9a-f-]{36}$/);
    const topicId = page.url().split('/').pop()!;
    const editor = page.getByTestId('topic-editor');
    await editor.getByLabel(tt.topic.name, { exact: true }).fill('Листья');
    await editor.getByLabel(tt.topic.description, { exact: true }).fill('Как устроен лист');
    await editor.getByLabel(tt.topic.funFact, { exact: true }).fill('Лист может поворачиваться к солнцу');
    await editor.getByLabel(tt.topic.body, { exact: true }).fill('## Строение листа\n\nПластинка и черешок.');
    await page.getByTestId('topic-save').click();
    await expect(page.getByTestId('topic-save-status')).toHaveText(tt.topic.saved);
    await page.getByRole('link', { name: new RegExp(tt.topic.editQuiz) }).click();
    const qform = page.getByTestId('question-form').first();
    await qform.getByLabel(tt.quiz.text, { exact: true }).fill('Из чего состоит лист?');
    await qform
      .getByLabel(tt.quiz.option.replace('{number}', '1'), { exact: true })
      .fill('Пластинка и черешок');
    await qform.getByLabel(tt.quiz.option.replace('{number}', '2'), { exact: true }).fill('Корень и стебель');
    await qform
      .getByRole('radio', { name: `${tt.quiz.correct}: ${tt.quiz.option.replace('{number}', '1')}` })
      .check();
    await qform.getByLabel(tt.quiz.explanation, { exact: true }).fill('Лист — это пластинка и черешок');
    await page.getByTestId('question-submit').first().click();
    await expect(page.getByTestId('quiz-question')).toHaveCount(1);
    await page.goto(`/ru/teacher/topics/${topicId}`);
    await page.getByTestId('publish').click();
    await expect(page.getByTestId('topic-status')).toHaveText(tt.topic.statusPublished);

    // Ученик класса: «Мой класс» → предмет → урок → квиз → XP (предметы учителя — в «Мой класс», REQ-NAV-11).
    const studentCtx = await browser.newContext({ baseURL });
    await acceptCookies(studentCtx, baseURL);
    await signIn(studentCtx, student, baseURL!);
    const s = await studentCtx.newPage();
    await s.goto('/ru/learn/class');
    await s.getByTestId('class-subject').filter({ hasText: subjectTitle }).click();
    await expect(s).toHaveURL(new RegExp(`/learn/subjects/${subjectId}$`));
    await s.getByTestId('student-topic').filter({ hasText: 'Листья' }).click();
    await expect(s).toHaveURL(new RegExp(`/learn/topics/${topicId}`));
    await expect(s.getByRole('heading', { level: 1, name: 'Листья' })).toBeVisible();
    const overview = s.getByTestId('lesson-overview');
    await expect(overview.getByTestId('lesson-fun-fact')).toContainText('Лист может поворачиваться к солнцу');
    await expect(s.getByTestId('cabinet-stats')).toContainText('5 XP');
    await s.getByRole('tab', { name: st.lesson.quiz }).click();
    await answerOption(s, 'Пластинка и черешок');
    await expect(s.getByTestId('quiz-feedback')).toContainText(st.quiz.correct);
    await s.getByTestId('quiz-next').click();
    await expect(s.getByTestId('quiz-result')).toContainText(st.quiz.result.replace('{score}', '100'));
    await expect(s.getByTestId('quiz-xp')).toHaveText(st.quiz.xp.replace('{xp}', '20'));
    await expect(s.getByTestId('quiz-badges')).toContainText('Первый шаг');
    await expect(s.getByTestId('cabinet-stats')).toContainText('25 XP');

    // Ученик другого класса и гость темы не видят.
    const outsiderCtx = await browser.newContext({ baseURL });
    await acceptCookies(outsiderCtx, baseURL);
    await signIn(outsiderCtx, outsider, baseURL!);
    const o = await outsiderCtx.newPage();
    expect((await o.goto(`/ru/learn/topics/${topicId}`))?.status()).toBe(404);
    expect((await o.goto(`/ru/learn/subjects/${subjectId}`))?.status()).toBe(404);
    await o.goto('/ru/learn/subjects');
    await expect(o.getByTestId('student-catalog')).not.toContainText(subjectTitle);
    const guest = await request.newContext({ baseURL });
    expect((await guest.get(`/api/student/topics/${topicId}`)).status()).toBe(401);
    // BR-VIS-04: личный урок учителя гостю не виден (гость читает только базовые уроки).
    const guestPage = await (await browser.newContext({ baseURL })).newPage();
    expect((await guestPage.goto(`/ru/learn/topics/${topicId}`))?.status()).toBe(404);
    await expect(guestPage.getByText('Листья')).toHaveCount(0);

    // Снятие с публикации и отзыв доступа скрывают тему у ученика.
    await post(teacher, `/api/teacher/topics/${topicId}/unpublish`);
    expect((await s.goto(`/ru/learn/topics/${topicId}`))?.status()).toBe(404);
    await post(teacher, `/api/teacher/topics/${topicId}/publish`);
    expect((await s.goto(`/ru/learn/topics/${topicId}`))?.status()).toBe(200);
    const revoke = await teacher.delete(`/api/teacher/subjects/${subjectId}/access/${cls.id}`, {
      headers: { 'X-CSRF-Token': await csrfOf(teacher) },
    });
    expect(revoke.status()).toBe(204);
    expect((await s.goto(`/ru/learn/topics/${topicId}`))?.status()).toBe(404);
    await s.goto('/ru/learn/subjects');
    await expect(s.getByTestId('student-catalog')).not.toContainText(subjectTitle);
    await Promise.all([studentCtx.close(), outsiderCtx.close(), guest.dispose()]);
  });

  test('AC-ST-01, AC-GEN-02, REQ-ST-LES-05 tabs change ?tab without reload; the language switch keeps the topic, tab and quiz progress', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId } = await setup(baseURL!);
    await signIn(context, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}`);
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
    await page.getByRole('tab', { name: st.lesson.quiz }).click();
    await expect(page).toHaveURL(/\?tab=quiz$/);
    await answerOption(page, 'Ответ 1.1');
    await page.getByTestId('quiz-next').click();
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      st.quiz.progress.replace('{index}', '2').replace('{count}', '3'),
    );
    await page.getByRole('tab', { name: st.lesson.overview }).click();
    await expect(page).toHaveURL(/\?tab=overview$/);
    await page.getByRole('tab', { name: st.lesson.quiz }).click();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

    await switchCabinetLocale(page, 'kk');
    await expect(page).toHaveURL(new RegExp(`/kk/learn/topics/${topicId}\\?tab=quiz$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Жүрек' })).toBeVisible();
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      bundles.kk.student.quiz.progress.replace('{index}', '2').replace('{count}', '3'),
    );
    await expect(page.getByText('2-сұрақ?')).toBeVisible();
  });

  test('AC-ST-02, BR-QZ-01 no correct answer in network responses before answering; instant result', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId } = await setup(baseURL!);
    await signIn(context, student, baseURL!);
    const bodies: string[] = [];
    page.on('response', async (res) => {
      if (res.url().includes('/api/student/')) bodies.push(await res.text().catch(() => ''));
    });
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    await expect(page.getByTestId('quiz-progress')).toBeVisible();
    await expect(page.getByTestId('quiz-difficulty')).toHaveText(st.quiz.difficulty.easy);
    expect(bodies.join('\n')).not.toMatch(/isCorrect|is_correct|correctOptionId|Объяснение 1/);
    await answerOption(page, 'Ответ 1.2');
    const feedback = page.getByTestId('quiz-feedback');
    await expect(feedback).toContainText(st.quiz.incorrect);
    await expect(feedback).toContainText('Объяснение 1');
    await expect(page.getByTestId('quiz-option').filter({ hasText: 'Ответ 1.0' })).toHaveAttribute(
      'data-state',
      'correct',
    );
    await expect(page.getByTestId('quiz-option').filter({ hasText: 'Ответ 1.2' })).toHaveAttribute(
      'data-state',
      'wrong',
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-ST-QZ-01, REQ-NFR-A11Y-01 keyboard: arrows only move the choice, Enter or Space answers; result «Тема освоена!»', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId } = await setup(baseURL!, 2);
    await signIn(context, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    const radios = page.getByRole('radiogroup').getByRole('radio');
    await radios.first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    // Стрелки не отправляют ответ.
    await expect(radios.nth(2)).toBeChecked();
    await expect(page.getByTestId('quiz-feedback')).toBeEmpty();
    await expect(page.getByTestId('quiz-answer')).toBeEnabled();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('quiz-feedback')).toContainText(st.quiz.correct);
    await page.getByTestId('quiz-next').focus();
    await page.keyboard.press('Enter');
    // Второй вопрос: выбор стрелкой, ответ пробелом; затем кнопка «Ответить» не нужна.
    await radios.first().focus();
    await page.keyboard.press(' ');
    await expect(page.getByTestId('quiz-feedback')).toContainText(st.quiz.correct);
    await page.getByTestId('quiz-next').click();
    await expect(page.getByTestId('quiz-result')).toContainText(st.quiz.result.replace('{score}', '100'));
    await expect(page.getByTestId('quiz-correct-count')).toHaveText(
      st.quiz.correctCount.replace('{correct}', '2').replace('{total}', '2'),
    );
    await expect(page.getByTestId('quiz-mastery')).toHaveText(st.quiz.masteredYes);
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-ST-QZ-01 the «Ответить» button sends the option chosen with the keyboard', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId } = await setup(baseURL!, 1);
    await signIn(context, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    const radios = page.getByRole('radiogroup').getByRole('radio');
    await radios.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('quiz-feedback')).toBeEmpty();
    await page.getByTestId('quiz-answer').click();
    await expect(page.getByTestId('quiz-feedback')).toContainText(st.quiz.incorrect);
    await expect(page.getByTestId('quiz-option').nth(1)).toHaveAttribute('data-state', 'wrong');
  });

  test('AC-ST-03 leaving and coming back continues from the same question; «Пройти ещё раз»', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId } = await setup(baseURL!, 2);
    await signIn(context, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    await answerOption(page, 'Ответ 1.0');
    await page.goto('/ru/learn/subjects');
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      st.quiz.progress.replace('{index}', '2').replace('{count}', '2'),
    );
    await answerOption(page, 'Ответ 2.3');
    await page.getByTestId('quiz-next').click();
    await expect(page.getByTestId('quiz-result')).toContainText(st.quiz.result.replace('{score}', '50'));
    // Результат: целые проценты, «N из M правильно», порог освоения (решение владельца 2026-10-16).
    await expect(page.getByTestId('quiz-correct-count')).toHaveText(
      st.quiz.correctCount.replace('{correct}', '1').replace('{total}', '2'),
    );
    await expect(page.getByTestId('quiz-mastery')).toHaveText(
      st.quiz.masteredNo.replace('{threshold}', '80'),
    );
    await page.getByRole('button', { name: st.quiz.retry }).click();
    await expect(page.getByTestId('quiz-progress')).toHaveText(
      st.quiz.progress.replace('{index}', '1').replace('{count}', '2'),
    );
  });

  test('AC-STF-09, REQ-ST-QZ-02 two of three right → «67 %», «2 из 3 правильно», the 80 % threshold message', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId } = await setup(baseURL!, 3);
    await signIn(context, student, baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    for (const answer of ['Ответ 1.0', 'Ответ 2.0', 'Ответ 3.3']) {
      await answerOption(page, answer);
      await page.getByTestId('quiz-next').click();
    }
    await expect(page.getByTestId('quiz-result')).toContainText(st.quiz.result.replace('{score}', '67'));
    await expect(page.getByTestId('quiz-correct-count')).toHaveText(
      st.quiz.correctCount.replace('{correct}', '2').replace('{total}', '3'),
    );
    await expect(page.getByTestId('quiz-mastery')).toHaveText(
      st.quiz.masteredNo.replace('{threshold}', '80'),
    );
  });

  test('REQ-ST-CAT-01..03, REQ-ST-HOME-01 catalog, section, «Продолжить учёбу», «Перейти к предмету»; a11y and 320 px', async ({
    page,
    context,
    baseURL,
  }) => {
    const { student, topicId, subjectId } = await setup(baseURL!);
    await signIn(context, student, baseURL!);
    await page.goto('/ru/learn/subjects');
    await expect(page.getByRole('heading', { name: st.catalog.title })).toBeVisible();
    await expect(page.getByTestId('catalog-section').first()).toContainText(st.catalog.section);
    // REQ-NAV-12: в каталоге только базовые предметы (все — в разделах); предмет учителя — в «Мой класс».
    await expect(page.getByTestId('catalog-subject')).toHaveCount(0);
    // BR-CNT-08: предмет без опубликованных тем — «Скоро», не ссылка. Все базовые предметы — в разделах
    // («Химия» — в «Естественных науках», решение владельца 2026-10-17; с атласом химии — открыта, AC-CHEM-02).
    await page.getByTestId('catalog-section').filter({ hasText: 'Естественные науки' }).click();
    await expect(
      page.getByRole('link').filter({ has: page.getByText('Химия', { exact: true }) }),
    ).toContainText(st.catalog.available);
    const soon = page.locator('[data-testid="catalog-subject"][data-status="soon"]');
    await expect(soon.first()).toContainText('Физика');
    await expect(soon.first()).toContainText(st.catalog.soon);
    await expect(soon.first().getByRole('link')).toHaveCount(0);
    // Статусы тем на странице предмета: «Не начата» → после открытия «Начата».
    await page.goto(`/ru/learn/subjects/${subjectId}`);
    await expect(page.getByTestId('student-topic').first()).toHaveAttribute('data-status', 'not_started');
    await expect(page.getByTestId('student-topic').first()).toContainText(st.subject.status.not_started);
    await page.goto('/ru/learn/subjects');
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await page.getByTestId('catalog-section').first().click();
    await expect(page).toHaveURL(/\/learn\/sections\//);
    await expect(page.getByRole('link', { name: st.section.back })).toBeVisible();
    await expect(page.getByTestId('catalog-subject').first()).toBeVisible();

    // До первого урока «Продолжить учёбу» ведёт в каталог, после — на последнюю открытую тему.
    await page.goto('/ru');
    await expect(page.getByTestId('hero-continue')).toHaveAttribute('href', '/ru/learn/subjects');
    await page.goto(`/ru/learn/topics/${topicId}`);
    await expect(page.getByTestId('lesson-overview')).toBeVisible();
    await expect(page.getByTestId('cabinet-stats')).toContainText('5 XP');
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.goto('/ru');
    await expect(page.getByTestId('hero-continue')).toHaveText(ru.home.hero.continue);
    await expect(page.getByTestId('hero-continue')).toHaveAttribute('href', `/ru/learn/topics/${topicId}`);
    // REQ-NAV-04: публичная главная у вошедшего — внутри рабочей среды (хедер кабинета), «Войти» нет.
    await expect(page.getByTestId('cabinet-header')).toBeVisible();
    await expect(page.getByTestId('public-header')).toHaveCount(0);
    await expect(page.getByTestId('header-login')).toHaveCount(0);
    await page.goto(`/ru/learn/subjects/${subjectId}`);
    await expect(page.getByTestId('student-topic').first()).toHaveAttribute('data-status', 'started');
    await page.goto('/ru');

    // Пробный вопрос: «Перейти к предмету» → страница предмета ученика.
    const demo = page.getByTestId('home-demo');
    await demo.getByTestId('demo-option').first().click();
    await demo.getByRole('button', { name: ru.home.demo.check }).click();
    await expect(demo.getByTestId('demo-to-subject')).toHaveAttribute(
      'href',
      /\/ru\/learn\/subjects\/[0-9a-f-]{36}$/,
    );
    await demo.getByTestId('demo-to-subject').click();
    await expect(page.getByTestId('subject-topics')).toBeVisible();
    expect(subjectId).toBeTruthy();
  });
});
