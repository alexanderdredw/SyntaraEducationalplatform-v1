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
const uid = () => randomUUID().slice(0, 8);
type Role = 'student' | 'teacher';

/** Вошедший через API ученик (без класса) или учитель. */
async function account(baseURL: string, role: Role): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res =
    role === 'student'
      ? await ctx.post('/api/auth/register-student', {
          data: { displayName: 'Асель Нурова', login: `nav.${uid()}`, password: 'student-pass-1' },
        })
      : await ctx.post('/api/auth/register', {
          data: {
            role: 'teacher',
            email: `nav.${uid()}@example.kz`,
            displayName: 'Алия Сапарова',
            password: 'teacher-pass-1',
          },
        });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}

async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

/** Базовая программа (BR-VIS-04): раздел, предмет и первая тема — через публичный каталог. */
async function baseContent(baseURL: string) {
  const anon = await request.newContext({ baseURL });
  const json = async (path: string) => (await anon.get(path)).json();
  const catalog = await json('/api/public/catalog');
  const sectionId = catalog.sections[0].id as string;
  const section = await json(`/api/public/sections/${sectionId}`);
  const subjectId = section.subjects.find((s: { status: string }) => s.status === 'available').id as string;
  const topicId = (await json(`/api/public/subjects/${subjectId}`)).topics[0].id as string;
  await anon.dispose();
  return { sectionId, subjectId, topicId };
}

/** Пункты панели в порядке: подпись и адрес. */
async function sidebarItems(page: Page) {
  return (
    page
      .getByTestId('cabinet-sidebar')
      .getByRole('link')
      // Подпись без состояния счётчика (после запятой — «есть новое» и т. п., REQ-NAV-14). Строка профиля
      // (REQ-PRF-10) — не пункт навигации REQ-NAV-01.
      .evaluateAll((links) =>
        links
          .filter((a) => a.getAttribute('data-testid') !== 'profile-row')
          .map((a) => `${a.getAttribute('aria-label')!.split(',')[0]} ${a.getAttribute('href')}`),
      )
  );
}

const EXPECTED: Record<Role, string[]> = {
  student: [
    `${nav.home} /ru`,
    `${nav.studentCatalog} /ru/learn/subjects`,
    `${nav.myClass} /ru/learn/class`,
    `${nav.myAssignments} /ru/learn/assignments`,
    `${nav.assistant} /ru/learn/assistant`,
    `${nav.battle} /ru/learn/battles`,
    `${nav.progress} /ru/learn/progress`,
    `${nav.achievements} /ru/learn/achievements`,
    `${nav.about} /ru/about`,
    `${nav.schools} /ru/schools`,
    `${nav.help} /ru/support`,
  ],
  teacher: [
    `${nav.home} /ru`,
    `${nav.courses} /ru/teacher/courses`,
    `${nav.classes} /ru/teacher/classes`,
    `${nav.assignments} /ru/teacher/assignments`,
    `${nav.battle} /ru/teacher/battles`,
    `${nav.catalog} /ru/subjects`,
    `${nav.ai} /ru/ai`,
    `${nav.about} /ru/about`,
    `${nav.schools} /ru/schools`,
    `${nav.help} /ru/support`,
  ],
};

/** Гостевые страницы REQ-NAV-04, п. 1. */
function guestRoutes(c: { sectionId: string; subjectId: string; topicId: string }) {
  return [
    '/',
    '/subjects',
    '/learn/subjects',
    `/learn/sections/${c.sectionId}`,
    `/learn/subjects/${c.subjectId}`,
    `/learn/topics/${c.topicId}`,
    '/about',
    '/ai',
    '/schools',
    '/schools/request',
    '/support',
    '/terms',
    '/privacy',
    '/cookies',
  ];
}

test.describe('Единая рабочая среда (docs/NAV_TZ.md)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  for (const role of ['student', 'teacher'] as const) {
    test(`AC-NAV-01, AC-NAV-02 ${role}: the same panel on every page, no repeats, no «←»`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(isPhone(page), 'панель — от 768 px; телефон — AC-NAV-07');
      await signIn(context, await account(baseURL!, role), baseURL!);
      const c = await baseContent(baseURL!);
      const pages =
        role === 'student'
          ? [
              '/',
              '/learn/subjects',
              `/learn/topics/${c.topicId}`,
              `/learn/topics/${c.topicId}?tab=quiz`,
              `/learn/topics/${c.topicId}?tab=ai`,
              '/learn/battles',
              '/about',
            ]
          : [
              '/',
              '/teacher/courses',
              '/subjects',
              `/learn/topics/${c.topicId}`,
              '/teacher/battles',
              '/about',
            ];
      for (const path of pages) {
        await page.goto(`/ru${path}`);
        await expect(page.getByTestId('cabinet-sidebar'), path).toBeVisible();
        const items = await sidebarItems(page);
        expect(items, path).toEqual(EXPECTED[role]);
        expect(new Set(items).size, path).toBe(items.length);
        await expect(page.getByTestId('cabinet-sidebar').getByText('←'), path).toHaveCount(0);
        // Ровно одна панель навигации кабинета на странице (REQ-NAV-01).
        await expect(page.getByRole('navigation', { name: ru.cabinet.sidebarLabel }), path).toHaveCount(1);
      }
    });

    test(`AC-NAV-03 ${role}: every guest page opens inside the workspace, without signing out`, async ({
      page,
      context,
      baseURL,
    }) => {
      await signIn(context, await account(baseURL!, role), baseURL!);
      for (const path of guestRoutes(await baseContent(baseURL!))) {
        const res = await page.goto(`/ru${path}`);
        expect(res?.status(), path).toBe(200);
        expect(new URL(page.url()).pathname, path).toBe(`/ru${path === '/' ? '' : path}`);
        await expect(page.getByTestId('cabinet-header'), path).toBeVisible();
        await expect(page.getByTestId('public-header'), path).toHaveCount(0);
        if (isPhone(page)) {
          await expect(
            page.getByTestId('cabinet-header').getByRole('button', { name: ru.shell.menu }),
          ).toBeVisible();
        } else {
          await expect(page.getByTestId('cabinet-sidebar'), path).toBeVisible();
        }
      }
      // Сессия не потеряна.
      expect((await page.request.get('/api/me')).status()).toBe(200);
    });

    test(`REQ-NAV-04 ${role}: sign-in pages redirect to the role home; REQ-NAV-06 logo leads there too`, async ({
      page,
      context,
      baseURL,
    }) => {
      await signIn(context, await account(baseURL!, role), baseURL!);
      const home = role === 'student' ? /\/ru$/ : /\/ru\/teacher\/courses$/;
      for (const path of ['/auth/login', '/auth/login?forgot=1', '/auth/start', '/auth/start?role=student']) {
        await page.goto(`/ru${path}`);
        await expect(page, path).toHaveURL(home);
      }
      await page.goto('/ru/about');
      await page.getByTestId('cabinet-header').getByRole('link', { name: ru.shell.logoLabel }).click();
      await expect(page).toHaveURL(home);
    });
  }

  test('AC-NAV-04 school request, support ticket and the demo question work for a signed-in student', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await account(baseURL!, 'student'), baseURL!);
    const sr = ru.schoolRequest;
    await page.goto('/ru/schools/request');
    await page.getByLabel(sr.fields.schoolName).fill('Школа-гимназия №1');
    await page.getByLabel(sr.fields.contactPerson).fill('Директор');
    await page.getByRole('textbox', { name: sr.fields.email, exact: true }).fill('nav-school@example.kz');
    await page.getByRole('button', { name: sr.submit }).click();
    await expect(page.getByTestId('form-success-number')).toHaveText(/SR-\d{6}-\d{4}/);

    const sp = ru.support;
    await page.goto('/ru/support');
    await page.getByLabel(sp.fields.subject).fill('Не открывается урок');
    await page.getByLabel(sp.fields.email).fill('nav-support@example.kz');
    await page.getByLabel(sp.fields.description).fill('После входа белый экран');
    await page.getByRole('button', { name: sp.submit }).click();
    await expect(page.getByTestId('form-success-number')).toHaveText(/T-\d{6}-\d{4}/);

    await page.goto('/ru');
    const demo = page.getByTestId('demo-question');
    await demo.getByRole('radio').first().click();
    await demo.getByRole('button', { name: ru.home.demo.check }).click();
    await expect(page.getByTestId('demo-result')).toBeVisible();
    // Пробный вопрос ведёт ученика к его предмету (REQ-ST-HOME, AC-STF-04).
    await expect(page.getByTestId('demo-to-subject')).toHaveAttribute('href', /\/ru\/learn\/subjects\//);
  });

  test('AC-NAV-05 no «Войти»/«Начать»/«Зарегистрироваться» for signed-in users; replacement buttons', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const guestOnly = [ru.shell.login, ru.about.hero.start, ru.home.hero.teacher, ru.auth.start.submit];
    await signIn(context, await account(baseURL!, 'student'), baseURL!);
    for (const path of ['/', '/about']) {
      await page.goto(`/ru${path}`);
      for (const name of guestOnly) {
        await expect(page.getByRole('link', { name, exact: true }), `${path} ${name}`).toHaveCount(0);
      }
      await expect(page.getByTestId('signed-in-cta')).toHaveText(ru.home.hero.continue);
      await expect(page.getByTestId('signed-in-cta')).toHaveAttribute('href', '/ru/learn/subjects');
    }

    const t = await browser.newContext();
    await acceptCookies(t, baseURL);
    await signIn(t, await account(baseURL!, 'teacher'), baseURL!);
    const tp = await t.newPage();
    for (const path of ['/', '/about']) {
      await tp.goto(`/ru${path}`);
      for (const name of guestOnly) {
        await expect(tp.getByRole('link', { name, exact: true }), `${path} ${name}`).toHaveCount(0);
      }
      await expect(tp.getByTestId('signed-in-cta')).toHaveText(ru.cabinet.toCabinet);
      await expect(tp.getByTestId('signed-in-cta')).toHaveAttribute('href', '/ru/teacher/courses');
    }
    // Базовый урок у учителя: на «Квиз» вместо «Войти» — «Перейти в кабинет →».
    const { topicId } = await baseContent(baseURL!);
    await tp.goto(`/ru/learn/topics/${topicId}?tab=quiz`);
    await expect(tp.getByTestId('guest-login')).toHaveCount(0);
    await expect(tp.getByTestId('to-cabinet')).toHaveAttribute('href', '/ru/teacher/courses');
    await t.close();
  });

  test('AC-NAV-06 collapsed and expanded panel; the choice is remembered on the device', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(isPhone(page), 'панель — от 768 px');
    await signIn(context, await account(baseURL!, 'teacher'), baseURL!);
    await page.goto('/ru/teacher/classes');
    const sidebar = page.getByTestId('cabinet-sidebar');
    const classes = sidebar.getByRole('link', { name: nav.classes });
    // Развёрнута: подписи пунктов и групп видны, ширина ≈ 220 px.
    await expect(sidebar.getByText(nav.classes, { exact: true })).toBeVisible();
    await expect(sidebar.getByText(ru.cabinet.navGroups.platform)).toBeVisible();
    expect(Math.round((await sidebar.boundingBox())!.width)).toBeGreaterThanOrEqual(200);
    await expect(classes).not.toHaveAttribute('title');

    const toggle = page.getByTestId('sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    // Свёрнута: только иконки с подсказками, подписи групп скрыты, разделители остаются.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName(ru.cabinet.expandNav);
    await expect(sidebar.getByText(nav.classes, { exact: true })).toBeHidden();
    // Подпись группы остаётся только для экранного диктора (sr-only, 1 × 1 px).
    expect(
      (await sidebar.getByText(ru.cabinet.navGroups.platform).boundingBox())?.width ?? 0,
    ).toBeLessThanOrEqual(1);
    await expect(classes).toHaveAttribute('title', nav.classes);
    await expect(classes).toHaveAccessibleName(nav.classes);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBeLessThanOrEqual(80);
    await expect(sidebar.locator('hr').first()).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(Math.round((await sidebar.boundingBox())!.width)).toBeLessThanOrEqual(80);
    await page.getByTestId('sidebar-toggle').click();
    await page.reload();
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByText(nav.classes, { exact: true })).toBeVisible();
  });

  for (const width of [320, 390]) {
    for (const role of ['student', 'teacher'] as const) {
      test(`AC-NAV-07 ${role} phone ${width} px: menu blocks «Мой кабинет», «Платформа», «Помощь», «Язык», «Настройки»`, async ({
        page,
        context,
        baseURL,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await signIn(context, await account(baseURL!, role), baseURL!);
        await page.goto('/ru/about');
        await expect(page.getByTestId('cabinet-sidebar')).toBeHidden();
        expect(await hasHorizontalScroll(page)).toBe(false);
        const menuButton = page.getByTestId('cabinet-header').getByRole('button', { name: ru.shell.menu });
        await menuButton.click();
        const dialog = page.getByRole('dialog', { name: ru.shell.menu });
        // Первый заголовок — скрытое название диалога «Меню» (Radix Dialog.Title).
        const headings = await dialog.getByRole('heading', { level: 2 }).allTextContents();
        const groups =
          role === 'student'
            ? [ru.cabinet.navGroups.study, ru.cabinet.navGroups.progress, ru.cabinet.navGroups.platform]
            : [ru.cabinet.navGroups.cabinet, ru.cabinet.navGroups.platform];
        expect(headings).toEqual([ru.shell.menu, ...groups, nav.help, ru.shell.language, ru.shell.settings]);
        const links = await dialog
          .getByTestId('cabinet-menu-nav')
          .getByRole('link')
          .evaluateAll((as) => as.map((a) => `${a.textContent} ${a.getAttribute('href')}`));
        expect(links).toEqual(EXPECTED[role]);
        await expect(dialog.getByRole('link', { name: nav.about })).toHaveAttribute('aria-current', 'page');
        await expect(dialog.getByRole('link', { name: nav.home })).toBeFocused();
        await expect(dialog.getByRole('button', { name: ru.cabinet.logout })).toBeVisible();
        expect(await hasHorizontalScroll(page)).toBe(false);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(menuButton).toBeFocused();
        // Переход по пункту закрывает меню.
        await menuButton.click();
        await dialog.getByRole('link', { name: nav.schools }).click();
        await expect(page).toHaveURL(/\/ru\/schools$/);
        await expect(dialog).toBeHidden();
      });
    }
  }

  for (const theme of ['dark', 'light'] as const) {
    test(`AC-NAV-08 ${theme}: nav landmark, aria-current, keyboard, axe`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      await signIn(context, await account(baseURL!, 'student'), baseURL!);
      const { topicId } = await baseContent(baseURL!);
      // axe — после загрузки данных страницы (элементы, которые ждут данных, не меряются в промежуточном виде).
      for (const [path, ready] of [
        ['/learn/progress', 'progress-range'],
        [`/learn/topics/${topicId}`, 'lesson-overview'],
        ['/about', 'about-hero'],
      ]) {
        await page.goto(`/ru${path}`);
        await expect(page.getByTestId(ready!)).toBeVisible();
        await expectNoSeriousA11yViolations(page);
      }
      const panel = await cabinetNav(page);
      await expect(panel.getByRole('link', { name: nav.about })).toHaveAttribute('aria-current', 'page');
      await expect(panel.locator('[aria-current="page"]')).toHaveCount(1);
      if (!isPhone(page)) {
        await expect(page.getByRole('navigation', { name: ru.cabinet.sidebarLabel })).toBeVisible();
        // Клавиатура: пункт открывается Enter, свёртывание — пробелом.
        await panel.getByRole('link', { name: nav.progress }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/ru\/learn\/progress$/);
        await page.getByTestId('sidebar-toggle').focus();
        await page.keyboard.press('Space');
        await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expectNoSeriousA11yViolations(page);
      } else {
        await expectNoSeriousA11yViolations(page);
      }
    });
  }

  test('AC-NAV-09 a guest keeps the public header and its menu', async ({ page }) => {
    await page.goto('/ru/about');
    await expect(page.getByTestId('public-header')).toBeVisible();
    await expect(page.getByTestId('header-login')).toBeVisible();
    await expect(page.getByTestId('cabinet-header')).toHaveCount(0);
    await expect(page.getByTestId('cabinet-sidebar')).toHaveCount(0);
    if (page.viewportSize()!.width >= 1024) {
      const links = await page
        .getByRole('navigation', { name: ru.shell.navLabel })
        .getByRole('link')
        .allTextContents();
      expect(links).toEqual(
        ['home', 'subjects', 'about', 'ai', 'schools', 'help'].map((k) => ru.shell.nav[k as 'home']),
      );
    }
  });
});
