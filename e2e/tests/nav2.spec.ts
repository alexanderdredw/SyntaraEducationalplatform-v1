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
  cabinetNav,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isPhone,
} from './support';

const ru = bundles.ru;
const nav = ru.cabinet.nav;
const mc = ru.student.myClass;
const uid = () => randomUUID().slice(0, 8);
const DAY = 86_400_000;

const csrfOf = async (ctx: APIRequestContext) =>
  (await ctx.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
async function call(ctx: APIRequestContext, method: string, path: string, data: object = {}) {
  const res = await ctx.fetch(path, { method, data, headers: { 'X-CSRF-Token': await csrfOf(ctx) } });
  expect(res.status(), `${method} ${path} ${await res.text()}`).toBeLessThan(300);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function account(baseURL: string, path: string, data: object): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}
const student = (baseURL: string, code?: string) =>
  account(baseURL, '/api/auth/register-student', {
    displayName: 'Асель Нурова',
    login: `n2.${uid()}`,
    password: 'student-pass-1',
    ...(code ? { code } : {}),
  });
async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

/** Учитель, класс с кодом и предмет учителя с опубликованной темой и квизом (правильный — «….0»). */
async function teacherClass(baseURL: string) {
  const teacher = await account(baseURL, '/api/auth/register', {
    role: 'teacher',
    email: `n2.${uid()}@example.kz`,
    displayName: 'Алия Сапарова',
    password: 'teacher-pass-1',
  });
  const cls = await call(teacher, 'POST', '/api/teacher/classes', { name: '7 «Н»' });
  const { code } = await call(teacher, 'POST', `/api/teacher/classes/${cls.id}/invite-codes`);
  const subject = async (title: string) => {
    const s = await call(teacher, 'POST', '/api/teacher/subjects', {
      translations: { ru: { title, description: `${title}: описание` } },
      inPublicCatalog: false,
    });
    const topic = await call(teacher, 'POST', `/api/teacher/subjects/${s.id}/topics`);
    await call(teacher, 'PUT', `/api/teacher/topics/${topic.id}`, {
      translations: { ru: { title: `${title}: тема` } },
      materialIds: [],
    });
    await call(teacher, 'POST', `/api/teacher/topics/${topic.id}/quiz/questions`, {
      type: 'single_choice',
      difficulty: 'easy',
      translations: { ru: { text: 'Вопрос?' } },
      options: [0, 1].map((i) => ({ translations: { ru: `Ответ ${i}` }, isCorrect: i === 0 })),
    });
    await call(teacher, 'POST', `/api/teacher/topics/${topic.id}/publish`);
    await call(teacher, 'POST', `/api/teacher/subjects/${s.id}/access`, { classId: cls.id });
    return { subjectId: s.id as string, topicId: topic.id as string, title };
  };
  const assign = (t: { subjectId: string; topicId: string }, days: number) =>
    call(teacher, 'POST', '/api/teacher/assignments', {
      classId: cls.id,
      subjectId: t.subjectId,
      topicId: t.topicId,
      dueAt: new Date(Date.now() + days * DAY).toISOString(),
    });
  return { teacher, classId: cls.id as string, code: code as string, subject, assign };
}

/** Квиз темы: все ответы верные (сдача задания, бейдж «Первый шаг»). */
async function passQuiz(s: APIRequestContext, topicId: string) {
  const lesson = await (await s.get(`/api/student/topics/${topicId}`)).json();
  const attempt = await call(s, 'POST', `/api/student/quizzes/${lesson.quizId}/attempts`);
  for (const q of attempt.questions)
    await call(s, 'POST', `/api/student/attempts/${attempt.attemptId}/answers`, {
      questionId: q.id,
      optionId: q.options.find((o: { text: string }) => o.text.endsWith('0')).id,
    });
  await call(s, 'POST', `/api/student/attempts/${attempt.attemptId}/finish`);
}

/** Пункт навигации — в панели (≥ 768 px) или в меню телефона. */
async function navLink(page: Page, label: string) {
  return (await cabinetNav(page)).getByRole('link', { name: new RegExp(`^${label}`) });
}
const closeMenu = async (page: Page) => {
  if (isPhone(page)) await page.keyboard.press('Escape');
};

test.describe('Панель ученика: «Мой класс», группы, счётчики (docs/NAV_TZ_2.md)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-NAV-11, REQ-NAV-11 «Мой класс»: class card, teacher subjects with progress, up to 3 upcoming; leaving works as before', async ({
    page,
    context,
    baseURL,
  }) => {
    const t = await teacherClass(baseURL!);
    const botany = await t.subject('Ботаника');
    const ecology = await t.subject('Экология края');
    for (const days of [-1, 2, 5, 9]) await t.assign(ecology, days);
    const s = await student(baseURL!, t.code);
    await passQuiz(s, botany.topicId);
    await signIn(context, s, baseURL!);

    await page.goto('/ru/learn/class');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(mc.title);
    await expect(page.getByTestId('student-class-card')).toContainText('Вы в классе «7 «Н»»');
    await expect(page.getByTestId('student-class-card')).toContainText('Учитель: Алия Сапарова');
    const subjects = page.getByTestId('class-subject');
    await expect(subjects).toHaveCount(2);
    const botanyCard = subjects.filter({ hasText: 'Ботаника' });
    await expect(botanyCard).toContainText('Ботаника: описание');
    // FIX-02: склонение по числу — «из 1 темы».
    await expect(botanyCard).toContainText('Освоено 1 из 1 темы');
    await expect(botanyCard).toContainText(mc.new);
    await expect(botanyCard).toHaveAttribute('href', `/ru/learn/subjects/${botany.subjectId}`);
    const upcoming = page.getByTestId('class-upcoming-item');
    await expect(upcoming).toHaveCount(3);
    await expect(upcoming.first()).toContainText(ru.student.assignments.overdue);
    await expect(page.getByRole('link', { name: mc.allAssignments })).toHaveAttribute(
      'href',
      '/ru/learn/assignments',
    );
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);

    // Выход из класса — с подтверждением, как раньше (BR-CLS-03): предметы класса пропадают.
    await page
      .getByTestId('student-class-card')
      .getByRole('button', { name: ru.student.class.leave })
      .click();
    await page
      .getByRole('dialog', { name: 'Выйти из класса «7 «Н»»?' })
      .getByRole('button', { name: ru.student.class.leaveYes })
      .click();
    await expect(page.getByTestId('student-join')).toBeVisible();
    await expect(page.getByTestId('class-subject')).toHaveCount(0);
    await expect(page.getByTestId('my-class-join-hint')).toHaveText(mc.joinHint);
  });

  test('AC-NAV-12 without a class: «Подключиться к классу» and the hint; after the code the class subjects appear', async ({
    page,
    context,
    baseURL,
  }) => {
    const t = await teacherClass(baseURL!);
    await t.subject('Астрономия');
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/learn/class');
    await expect(page.getByTestId('my-class-join-hint')).toHaveText(mc.joinHint);
    await page.getByRole('textbox', { name: ru.join.codeLabel }).fill(t.code);
    await page.getByRole('button', { name: ru.student.class.joinSubmit }).click();
    await page
      .getByRole('dialog', { name: ru.join.confirmTitle })
      .getByRole('button', { name: ru.join.confirm })
      .click();
    await expect(page.getByTestId('student-class-card')).toBeVisible();
    await expect(page.getByTestId('class-subject')).toHaveText([/Астрономия/]);
  });

  test('AC-NAV-13, AC-NAV-14 catalog has only base subjects; a teacher subject opens from «Мой класс» with crumbs; access unchanged', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const t = await teacherClass(baseURL!);
    const own = await t.subject('Ботаника опытов');
    await signIn(context, await student(baseURL!, t.code), baseURL!);

    // Каталог: заголовок «Предметы платформы», предмета учителя нет ни в сетке, ни в разделах; плашка → «Мой класс».
    await page.goto('/ru/learn/subjects');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.student.catalog.title);
    await expect(page.getByText(own.title)).toHaveCount(0);
    await expect(page.getByTestId('student-class-card')).toHaveCount(0);
    await expect(page.getByTestId('catalog-class-link')).toHaveText(ru.student.catalog.classLink);
    for (const section of await page
      .getByTestId('catalog-section')
      .evaluateAll((a) => a.map((x) => x.getAttribute('href')!))) {
      await page.goto(section);
      await expect(page.getByTestId('section-subjects')).toBeVisible();
      await expect(page.getByText(own.title)).toHaveCount(0);
    }
    await page.goto('/ru/learn/subjects');
    await expect(await navLink(page, nav.studentCatalog)).toHaveAttribute('aria-current', 'page');
    await closeMenu(page);
    await page.getByTestId('catalog-class-link').click();
    await expect(page).toHaveURL(/\/ru\/learn\/class$/);

    // Предмет учителя: «← Мой класс», в панели активен «Мой класс».
    await page.getByTestId('class-subject').click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/subjects/${own.subjectId}$`));
    await expect(page.getByRole('link', { name: mc.back })).toHaveAttribute('href', '/ru/learn/class');
    await expect(await navLink(page, nav.myClass)).toHaveAttribute('aria-current', 'page');
    await closeMenu(page);
    await page.getByTestId('student-topic').click();
    const crumbs = page.getByRole('navigation', { name: ru.student.lesson.breadcrumbs });
    await expect(crumbs).toHaveText(`${mc.back}/${own.title}/${own.title}: тема`);
    await expect(crumbs.getByRole('link', { name: mc.back })).toHaveAttribute('href', '/ru/learn/class');
    const panel = await cabinetNav(page);
    await expect(panel.getByRole('link', { name: new RegExp(`^${nav.myClass}`) })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(panel.locator('[aria-current="page"]')).toHaveCount(1);
    await closeMenu(page);

    // Урок базового предмета — активен «Каталог», крошки прежние.
    const anon = await request.newContext({ baseURL });
    const cat = await (await anon.get('/api/public/catalog')).json();
    const sec = await (await anon.get(`/api/public/sections/${cat.sections[0].id}`)).json();
    const base = sec.subjects.find((x: { status: string }) => x.status === 'available');
    const baseTopic = (await (await anon.get(`/api/public/subjects/${base.id}`)).json()).topics[0].id;
    await page.goto(`/ru/learn/topics/${baseTopic}`);
    await expect(page.getByTestId('lesson-overview')).toBeVisible();
    await expect(crumbs.getByRole('link', { name: mc.back })).toHaveCount(0);
    await expect(await navLink(page, nav.studentCatalog)).toHaveAttribute('aria-current', 'page');
    await closeMenu(page);

    // Доступ не изменился: другой ученик и гость — 404 (BR-VIS-01).
    const other = await browser.newContext();
    await acceptCookies(other, baseURL);
    await signIn(other, await student(baseURL!), baseURL!);
    const op = await other.newPage();
    expect((await op.goto(`/ru/learn/subjects/${own.subjectId}`))!.status()).toBe(404);
    expect((await op.goto(`/ru/learn/topics/${own.topicId}`))!.status()).toBe(404);
    await other.close();
    expect((await anon.get(`/api/public/subjects/${own.subjectId}`)).status()).toBe(404);
    await anon.dispose();
  });

  test('AC-NAV-15 exactly one active item on every page; hover differs from active', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(isPhone(page), 'наведение — на компьютере; меню телефона — AC-NAV-19');
    await signIn(context, await student(baseURL!), baseURL!);
    const sidebar = page.getByTestId('cabinet-sidebar');
    for (const path of [
      '/',
      '/learn/subjects',
      '/learn/class',
      '/learn/assignments',
      '/learn/progress',
      '/about',
    ]) {
      await page.goto(`/ru${path}`);
      await expect(sidebar.locator('[aria-current="page"]'), path).toHaveCount(1);
    }
    await page.goto('/ru');
    const home = sidebar.getByRole('link', { name: nav.home });
    const catalog = sidebar.getByRole('link', { name: nav.studentCatalog });
    await catalog.hover();
    await expect(catalog).not.toHaveAttribute('aria-current');
    const style = (l: typeof home) =>
      l.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el, '::before').content]);
    const [activeBg, activeBar] = await style(home);
    const [hoverBg, hoverBar] = await style(catalog);
    expect(hoverBg).not.toBe(activeBg);
    expect(activeBar).not.toBe('none');
    expect(hoverBar).toBe('none');
  });

  test('AC-NAV-16 «Мои задания» counter: open ones, red with an overdue one, «9+», decreases after submitting without reload', async ({
    page,
    context,
    baseURL,
  }) => {
    const t = await teacherClass(baseURL!);
    const own = await t.subject('Химия опытов');
    const s = await student(baseURL!, t.code);
    await signIn(context, s, baseURL!);
    await page.goto('/ru/learn/progress');
    const assignments = async () => navLink(page, nav.myAssignments);
    await expect(await assignments()).toHaveAccessibleName(nav.myAssignments);
    await closeMenu(page);

    await t.assign(own, 3);
    await page.goto('/ru/learn/progress');
    let link = await assignments();
    await expect(link).toHaveAccessibleName(`${nav.myAssignments}, 1 невыполненное`);
    await expect(link.getByTestId('nav-badge-count')).toHaveText('1');
    await expect(link.getByTestId('nav-badge-count')).toHaveAttribute('data-tone', 'accent');
    await closeMenu(page);

    for (let i = 0; i < 10; i++) await t.assign(own, i === 0 ? -1 : 4 + i);
    await page.goto('/ru/learn/progress');
    link = await assignments();
    await expect(link.getByTestId('nav-badge-count')).toHaveText('9+');
    await expect(link.getByTestId('nav-badge-count')).toHaveAttribute('data-tone', 'danger');
    await expect(link).toHaveAccessibleName(`${nav.myAssignments}, 11 невыполненных, есть просроченные`);
    await closeMenu(page);

    // Сдача квиза в интерфейсе: счётчик обновляется без перезагрузки (как серия и XP).
    await page.goto(`/ru/learn/topics/${own.topicId}?tab=quiz`);
    await page.getByTestId('quiz-option').filter({ hasText: 'Ответ 0' }).click();
    await page.getByTestId('quiz-next').click();
    await expect(page.getByTestId('quiz-result')).toBeVisible();
    // Все задания по одной теме сдаются одной попыткой (BR-ASG-03) — открытых не остаётся.
    await expect(await assignments()).toHaveAccessibleName(nav.myAssignments);
  });

  test('AC-NAV-17 a new class subject → dot on «Мой класс»; it disappears after opening and stays gone after reload', async ({
    page,
    context,
    baseURL,
  }) => {
    const t = await teacherClass(baseURL!);
    await signIn(context, await student(baseURL!, t.code), baseURL!);
    await page.goto('/ru/learn/progress');
    await expect(await navLink(page, nav.myClass)).toHaveAccessibleName(nav.myClass);
    await closeMenu(page);
    await t.subject('Геология');
    await page.goto('/ru/learn/progress');
    const link = await navLink(page, nav.myClass);
    await expect(link).toHaveAccessibleName(`${nav.myClass}, ${ru.cabinet.navBadges.new}`);
    await expect(link.getByTestId('nav-badge-new')).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/ru\/learn\/class$/);
    await expect(page.getByTestId('class-subject')).toContainText(mc.new);
    await expect(await navLink(page, nav.myClass)).toHaveAccessibleName(nav.myClass);
    await closeMenu(page);
    await page.reload();
    await expect(page.getByTestId('class-subject')).not.toContainText(mc.new);
    await expect(await navLink(page, nav.myClass)).toHaveAccessibleName(nav.myClass);
  });

  test('AC-NAV-18 a new badge → dot on «Достижения»; it disappears after opening the section', async ({
    page,
    context,
    baseURL,
  }) => {
    const t = await teacherClass(baseURL!);
    const own = await t.subject('Ботаника');
    const s = await student(baseURL!, t.code);
    await signIn(context, s, baseURL!);
    await page.goto('/ru/learn/progress');
    await expect(await navLink(page, nav.achievements)).toHaveAccessibleName(nav.achievements);
    await closeMenu(page);
    await passQuiz(s, own.topicId);
    await page.goto('/ru/learn/progress');
    const link = await navLink(page, nav.achievements);
    await expect(link).toHaveAccessibleName(`${nav.achievements}, ${ru.cabinet.navBadges.new}`);
    await link.click();
    await expect(page.getByTestId('badges-earned')).toBeVisible();
    await expect(await navLink(page, nav.achievements)).toHaveAccessibleName(nav.achievements);
    await closeMenu(page);
    await page.reload();
    await expect(await navLink(page, nav.achievements)).toHaveAccessibleName(nav.achievements);
  });

  test('AC-NAV-19 collapsed panel: group titles → dividers, tooltips, dots on icons', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(isPhone(page), 'панель — от 768 px');
    const t = await teacherClass(baseURL!);
    const own = await t.subject('Ботаника');
    await t.assign(own, -1);
    await signIn(context, await student(baseURL!, t.code), baseURL!);
    await page.addInitScript(() => localStorage.setItem('syntara.sidebar', 'collapsed'));
    await page.goto('/ru/learn/progress');
    const sidebar = page.getByTestId('cabinet-sidebar');
    expect(
      (await sidebar.getByText(ru.cabinet.navGroups.study).boundingBox())?.width ?? 0,
    ).toBeLessThanOrEqual(1);
    expect(await sidebar.locator('hr').count()).toBeGreaterThanOrEqual(3);
    const assignments = sidebar.getByRole('link', { name: new RegExp(`^${nav.myAssignments}`) });
    await expect(assignments).toHaveAttribute('title', nav.myAssignments);
    await expect(assignments.getByTestId('nav-badge-dot')).toBeVisible();
    await expect(assignments.getByTestId('nav-badge-count')).toHaveCount(0);
    await expect(
      sidebar.getByRole('link', { name: new RegExp(`^${nav.myClass}`) }).getByTestId('nav-badge-dot'),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  for (const width of [320, 390]) {
    test(`AC-NAV-19 phone ${width} px: groups «Учёба», «Мой прогресс», «Платформа»; counters in the menu; no horizontal scroll`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const t = await teacherClass(baseURL!);
      const own = await t.subject('Ботаника');
      await t.assign(own, 2);
      await signIn(context, await student(baseURL!, t.code), baseURL!);
      await page.goto('/ru/learn/class');
      await expect(page.getByTestId('class-subject')).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
      const menu = await cabinetNav(page);
      const dialog = page.getByRole('dialog', { name: ru.shell.menu });
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveText([
        ru.shell.menu,
        ru.cabinet.navGroups.study,
        ru.cabinet.navGroups.progress,
        ru.cabinet.navGroups.platform,
        nav.help,
        ru.shell.language,
        ru.shell.settings,
      ]);
      await expect(menu.getByRole('link', { name: `${nav.myAssignments}, 1 невыполненное` })).toBeVisible();
      await expect(menu.getByRole('link', { name: nav.myClass })).toHaveAttribute('aria-current', 'page');
      await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
      expect(await hasHorizontalScroll(page)).toBe(false);
      await expectNoSeriousA11yViolations(page);
    });
  }

  for (const theme of ['dark', 'light'] as const) {
    test(`AC-NAV-19 ${theme}: keyboard, aria-label with counters, axe on «Мой класс» and the catalog`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(isPhone(page), 'меню телефона — отдельный сценарий');
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      const t = await teacherClass(baseURL!);
      const own = await t.subject('Ботаника');
      await t.assign(own, -1);
      await signIn(context, await student(baseURL!, t.code), baseURL!);
      await page.goto('/ru/learn/subjects');
      await expect(page.getByTestId('catalog-class-link')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      const sidebar = page.getByTestId('cabinet-sidebar');
      const myClass = sidebar.getByRole('link', { name: `${nav.myClass}, ${ru.cabinet.navBadges.new}` });
      await myClass.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/ru\/learn\/class$/);
      await expect(page.getByTestId('class-subject')).toBeVisible();
      await expect(
        sidebar.getByRole('link', { name: `${nav.myAssignments}, 1 невыполненное, есть просроченные` }),
      ).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('AC-NAV-19 data saver: no periodic badge requests, refresh only on navigation', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(isPhone(page), 'одна ширина достаточна');
    await page.clock.install();
    await context.addCookies([{ name: 'data_saver', value: '1', url: baseURL! }]);
    await signIn(context, await student(baseURL!), baseURL!);
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/student/nav-badges')) calls++;
    });
    await page.goto('/ru/learn/progress');
    // OPT-05 (О4-2): первые счётчики приходят в HTML страницы — браузер их не запрашивает.
    await expect(page.getByTestId('cabinet-sidebar')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const before = calls;
    await page.clock.fastForward(3 * 60_000);
    await page.waitForTimeout(500);
    expect(calls).toBe(before);
    await page.getByTestId('cabinet-sidebar').getByRole('link', { name: nav.about }).click();
    await expect(page).toHaveURL(/\/ru\/about$/);
    await expect.poll(() => calls).toBeGreaterThan(before);

    // Без экономии трафика — опрос раз в 60 с.
    await context.clearCookies({ name: 'data_saver' });
    await page.reload();
    await expect.poll(() => calls).toBeGreaterThan(before + 1);
    const polled = calls;
    await page.clock.fastForward(61_000);
    await expect.poll(() => calls).toBeGreaterThan(polled);
  });
});
