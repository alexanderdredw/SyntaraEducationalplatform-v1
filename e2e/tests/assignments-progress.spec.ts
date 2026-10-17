import { randomUUID } from 'node:crypto';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const st = ru.student;
const ta = ru.teacher.assignments;
const tan = ru.teacher.analytics;
const uid = () => randomUUID().slice(0, 8);

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
async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

/** Учитель, класс и ученик в нём (по коду). */
async function setup(baseURL: string) {
  const teacher = await apiAs(baseURL, {
    role: 'teacher',
    email: `as.${uid()}@example.kz`,
    displayName: 'Учитель',
    password: 'teacher-pass-1',
  });
  const cls = await post(teacher, '/api/teacher/classes', { name: `9 «${uid().slice(0, 2)}»` });
  const { code } = await post(teacher, `/api/teacher/classes/${cls.id}/invite-codes`);
  const student = await apiAs(
    baseURL,
    { displayName: 'Асель', login: `as.${uid()}`, password: 'student-pass-1', code },
    '/api/auth/register-student',
  );
  return { teacher, student, classId: cls.id as string, className: cls.name as string };
}

/** Radix Select: открыть список поля и выбрать вариант. */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).click();
}

/** Квиз «Сердечно-сосудистая система» (content/): правильные ответы в порядке quiz.yaml. */
async function passCardio(page: Page) {
  const next = async () => {
    await expect(page.getByTestId('quiz-feedback')).toContainText(st.quiz.correct);
    await page.getByTestId('quiz-next').click();
  };
  await page.getByTestId('quiz-option').filter({ hasText: 'Аорта' }).click();
  await next();
  await page.getByLabel(st.quiz.answerLabel).fill('4');
  await page.getByRole('button', { name: st.quiz.answer }).click();
  await next();
  await page.getByTestId('quiz-option').filter({ hasText: 'Левый желудочек' }).click();
  await next();
  await page.getByTestId('quiz-option').filter({ hasText: ru.teacher.quiz.optionFalse }).click();
  await next();
  await page.getByTestId('quiz-option').filter({ hasText: 'В малом (лёгочном)' }).click();
  await next();
}

/** Итерация 10 — задания, показатели, аналитика (учитель и ученик). */
test.describe('Задания, показатели, аналитика (итерация 10)', () => {
  test('AC-TCH-08, REQ-TCH-ASG-01..03, REQ-ST-ASG-01 the teacher assigns a base topic → the student passes it from «Мои задания» → counters update', async ({
    page,
    browser,
    baseURL,
  }) => {
    const { teacher, student, className } = await setup(baseURL!);
    await signIn(page.context(), teacher, baseURL!);
    await page.goto('/ru/teacher/assignments');
    await expect(page.getByRole('heading', { level: 1, name: ta.title })).toBeVisible();
    await expect(page.getByTestId('assignment-form')).toContainText(ta.issueText);
    await expect(page.getByTestId('review-queue')).toContainText(ta.reviewEmpty);

    // Пустая форма — ошибки полей, запроса нет.
    await page.getByTestId('assignment-submit').click();
    await expect(page.getByTestId('assignment-form').getByText(ru.validation.required).first()).toBeVisible();

    await choose(page, ta.class, className);
    await choose(page, ta.subject, 'Анатомия человека');
    await choose(page, ta.topic, 'Дыхательная система');
    // BR-ASG-02: смена предмета сбрасывает тему — здесь предмет тот же, выбираем нужную тему.
    await choose(page, ta.topic, 'Сердечно-сосудистая система');
    await page.getByLabel(ta.due).fill('2030-05-20T18:30');
    await page.getByTestId('assignment-submit').click();
    await expect(page.getByTestId('assignment-form').getByRole('status')).toHaveText(ta.done);
    const card = page.getByTestId('assignment-card').filter({ hasText: 'Сердечно-сосудистая система' });
    await expect(card).toContainText(`${className} · 20.05.2030 18:30`);
    await expect(card.getByTestId('assignment-counts')).toHaveText('Сдано: 0 · На проверку: 0 · Оценено: 0');
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // Ученик: «Мои задания» → квиз из задания → «Оценено: 100%».
    const studentContext = await browser.newContext({ viewport: page.viewportSize()! });
    await signIn(studentContext, student, baseURL!);
    const sp = await studentContext.newPage();
    await sp.goto('/ru/learn/assignments');
    const item = sp.getByTestId('student-assignment');
    await expect(item).toHaveAttribute('data-status', 'not_started');
    await expect(item).toContainText(st.assignments.status.not_started);
    await expect(item).toContainText('Анатомия человека · Срок: 20.05.2030 18:30');
    await expectNoSeriousA11yViolations(sp);
    await item.click();
    await expect(sp).toHaveURL(/tab=quiz&assignment=/);
    await passCardio(sp);
    await sp.goto('/ru/learn/assignments');
    await expect(item).toHaveAttribute('data-status', 'graded');
    await expect(item).toContainText('Оценено: 100%');
    await studentContext.close();

    await page.reload();
    await expect(card.getByTestId('assignment-counts')).toHaveText('Сдано: 1 · На проверку: 0 · Оценено: 1');
  });

  test('REQ-TCH-AN-01..04, AC-TCH-09 class analytics: average, engagement, weak topics, attention; tabs keep the class', async ({
    page,
    baseURL,
  }) => {
    const { teacher, student, classId, className } = await setup(baseURL!);
    // Ученик проходит базовый квиз (результат 100 %), второй ученик класса неактивен.
    const lesson = await (await student.get('/api/student/topics/' + (await cardioId(baseURL!)))).json();
    const attempt = await post(student, `/api/student/quizzes/${lesson.quizId}/attempts`);
    await post(student, `/api/student/attempts/${attempt.attemptId}/finish`);
    const { code } = await post(teacher, `/api/teacher/classes/${classId}/invite-codes`);
    await apiAs(
      baseURL!,
      { displayName: 'Бауыржан', login: `as.${uid()}`, password: 'student-pass-1', code },
      '/api/auth/register-student',
    );

    await signIn(page.context(), teacher, baseURL!);
    await page.goto('/ru/teacher/classes');
    await page
      .getByTestId('teacher-class')
      .filter({ hasText: className })
      .getByTestId('class-analytics-link')
      .click();
    await expect(page).toHaveURL(new RegExp(`/ru/teacher/classes/${classId}/analytics$`));
    await expect(page.getByTestId('class-name')).toHaveText(className);
    await expect(page.getByRole('link', { name: tan.analytics })).toHaveAttribute('aria-current', 'page');
    // Попытка без ответов — 0 % (BR-QZ-05): тема красная.
    await expect(page.getByTestId('analytics-avg')).toContainText('0%');
    await expect(page.getByTestId('analytics-avg')).toContainText(tan.avg);
    await expect(page.getByTestId('analytics-engagement')).toContainText('1/2');
    await expect(page.getByTestId('analytics-engagement')).toContainText('за последние 7 дней');
    const weak = page.getByTestId('weak-topic');
    await expect(weak).toHaveCount(1);
    await expect(weak).toHaveAttribute('data-color', 'red');
    await expect(weak).toContainText('Сердечно-сосудистая система');
    await expect(weak).toContainText('1 уч.');
    const attention = page.getByTestId('analytics-attention');
    await expect(attention).toHaveAttribute('data-tone', 'danger');
    await expect(attention.getByTestId('attention-student')).toContainText('Бауыржан');
    await expect(attention.getByTestId('attention-student')).toContainText(tan.inactive);
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    await page.getByRole('link', { name: tan.roster }).click();
    await expect(page).toHaveURL(new RegExp(`/teacher/classes/${classId}/roster$`));
    await expect(page.getByTestId('class-name')).toHaveText(className);
    await expect(page.getByTestId('class-roster-tab')).toContainText('Бауыржан');
    await page.getByRole('link', { name: tan.mastery }).click();
    await expect(page.getByTestId('mastery-stub')).toContainText(ru.common.sectionInDevelopment);
    await page.goto(`/ru/teacher/classes/0190a1b2-0000-7000-8000-000000000000/analytics`);
    await expect(page.getByTestId('class-analytics')).toHaveCount(0);
  });

  test('AC-ST-08, REQ-ST-PRG-01..04 «Мои показатели»: period «7 дней» recalculates dates; quarter is unavailable; rules in modals', async ({
    page,
    baseURL,
  }) => {
    const { student } = await setup(baseURL!);
    await post(student, '/api/student/events', {
      type: 'lesson_opened',
      topicId: await cardioId(baseURL!),
      idempotencyKey: `lesson:${await cardioId(baseURL!)}:${new Date().toISOString().slice(0, 10)}`,
    });
    await signIn(page.context(), student, baseURL!);
    await page.goto('/ru/learn/progress');
    await expect(page.getByRole('heading', { level: 1, name: st.progress.title })).toBeVisible();
    const range = page.getByTestId('progress-range');
    await expect(range).toContainText('30 дней');
    await expect(page.getByRole('radio', { name: new RegExp(st.progress.periods.quarter) })).toBeDisabled();
    await expect(page.getByTestId('progress-value')).toContainText('0 из 3 тем');
    await expect(page.getByTestId('streak-days')).toHaveText('1 дн.');
    await expect(page.getByTestId('next-step-action')).toHaveAttribute('data-action', 'next_topic');
    await expect(page.getByTestId('next-step-action')).toContainText('Дыхательная система');
    await expectNoSeriousA11yViolations(page);

    const before = await range.textContent();
    await page.getByRole('radio', { name: st.progress.periods['7d'] }).click();
    await expect(range).toContainText('7 дней');
    expect(await range.textContent()).not.toBe(before);
    await expect(page.getByTestId('streak-delta')).toContainText('+1');

    await page.getByTestId('progress-card').getByRole('button', { name: st.progress.howCounted }).click();
    await expect(page.getByTestId('progress-help')).toHaveText(st.progress.help.progressCounted);
    await page.keyboard.press('Escape');
    await page.getByTestId('next-step-go').click();
    await expect(page).toHaveURL(/\/ru\/learn\/topics\//);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('REQ-ST-ACH-01..02 «Достижения»: level card and 12 badges, the first one earned after a quiz', async ({
    page,
    baseURL,
  }) => {
    const { student } = await setup(baseURL!);
    const lesson = await (await student.get('/api/student/topics/' + (await cardioId(baseURL!)))).json();
    const attempt = await post(student, `/api/student/quizzes/${lesson.quizId}/attempts`);
    await post(student, `/api/student/attempts/${attempt.attemptId}/finish`);
    await signIn(page.context(), student, baseURL!);
    await page.goto('/ru/learn/achievements');
    await expect(page.getByTestId('rank-title')).toHaveText('Новичок');
    await expect(page.getByTestId('level-card')).toContainText(st.achievements.level.replace('{level}', '1'));
    await expect(page.getByTestId('xp-total')).toHaveText('10 XP всего');
    await expect(page.getByTestId('badges-earned')).toHaveText('Получено 1 из 12');
    const badges = page.getByTestId('badge');
    await expect(badges).toHaveCount(12);
    await expect(badges.first()).toHaveAttribute('data-earned', 'true');
    await expect(badges.first()).toContainText('Первый шаг');
    await expect(badges.nth(1)).toContainText(st.achievements.locked);
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});

let cardio: string | null = null;
async function cardioId(baseURL: string) {
  if (cardio) return cardio;
  const api = await request.newContext({ baseURL });
  const catalog = await (await api.get('/api/public/catalog')).json();
  const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
  const section = await (await api.get(`/api/public/sections/${biology.id}`)).json();
  const anatomy = section.subjects.find((s: { title: string }) => s.title === 'Анатомия человека');
  const subject = await (await api.get(`/api/public/subjects/${anatomy.id}`)).json();
  cardio = subject.topics.find((t: { title: string }) => t.title === 'Сердечно-сосудистая система')
    .id as string;
  return cardio;
}
