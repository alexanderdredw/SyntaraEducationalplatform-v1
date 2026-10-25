import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  cabinetNav,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isPhone,
} from './support';

const ru = bundles.ru;
const menu = ru.account.menu;
const o = ru.account.overview;
const uid = () => randomUUID().slice(0, 8);

async function account(baseURL: string, path: string, data: object): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}
const student = (baseURL: string) =>
  account(baseURL, '/api/auth/register-student', {
    displayName: 'Асель Нурова',
    login: `acc.${uid()}`,
    password: 'student-pass-1',
  });
const teacher = (baseURL: string) =>
  account(baseURL, '/api/auth/register', {
    role: 'teacher',
    email: `acc.${uid()}@example.kz`,
    displayName: 'Алия Сапарова',
    password: 'teacher-pass-1',
  });
async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

test.describe('Личный кабинет и меню профиля (docs/PROFILE_TZ.md, REQ-PRF-02…04, REQ-PRF-10)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-PRF-09 the header menu: keyboard, Esc, every item leads to its page', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(isPhone(page), 'на телефоне — строка профиля в меню (следующий сценарий)');
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/learn/subjects');
    const trigger = page.getByTestId('profile-menu-trigger');
    await expect(trigger).toHaveAccessibleName(`${ru.cabinet.profile}: Асель Нурова`);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const list = page.getByRole('menu');
    await expect(list).toBeVisible();
    const items = [menu.dashboard, menu.editProfile, menu.settings, menu.privacy, ru.cabinet.logout];
    await expect(list.getByRole('menuitem')).toHaveText(items);
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(trigger).toBeFocused();

    for (const [name, url] of [
      [menu.dashboard, /\/ru\/account$/],
      [menu.editProfile, /\/ru\/account\/profile$/],
      [menu.settings, /\/ru\/account\/settings$/],
      [menu.privacy, /\/ru\/account\/privacy$/],
    ] as const) {
      await trigger.click();
      await page.getByRole('menuitem', { name }).click();
      await expect(page).toHaveURL(url);
    }
    await trigger.click();
    await page.getByRole('menuitem', { name: ru.cabinet.logout }).click();
    await expect(page).toHaveURL(/\/ru$/);
    expect((await page.request.get('/api/me')).status()).toBe(401);
  });

  test('AC-PRF-09 the profile row: in the panel above «Помощь» (collapsed — avatar only) and first in the phone menu', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/learn/subjects');
    if (isPhone(page)) {
      await cabinetNav(page);
      const row = page.getByRole('dialog').getByTestId('profile-row');
      await expect(row).toHaveAccessibleName(menu.profileRow.replace('{name}', 'Асель Нурова'));
      await row.click();
      await expect(page).toHaveURL(/\/ru\/account$/);
      return;
    }
    const sidebar = page.getByTestId('cabinet-sidebar');
    const row = sidebar.getByTestId('profile-row');
    await expect(row).toContainText('Асель Нурова');
    // Строка профиля — над «Помощь».
    const rowBox = (await row.boundingBox())!;
    const helpBox = (await sidebar.getByRole('link', { name: ru.cabinet.nav.help }).boundingBox())!;
    expect(rowBox.y).toBeLessThan(helpBox.y);
    await page.getByTestId('sidebar-toggle').click();
    await expect(row).toHaveAttribute('title', 'Асель Нурова');
    await expect(row.getByText('Асель Нурова')).toBeHidden();
    await row.click();
    await expect(page).toHaveURL(/\/ru\/account$/);
    await expect(row).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('sidebar-toggle').click();
  });

  test('AC-PRF-02 REQ-PRF-02/03 student overview: profile card and summary match «Показатели» and «Достижения»', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/account');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(o.title);
    const card = page.getByTestId('profile-card');
    await expect(card).toContainText('Асель Нурова');
    await expect(card).toContainText(ru.cabinet.roles.student);
    await expect(card).toContainText(/acc\./);
    await expect(card.getByRole('link', { name: o.editProfile })).toHaveAttribute(
      'href',
      '/ru/account/profile',
    );

    const progress = await (await page.request.get('/api/student/progress?period=30d')).json();
    await expect(page.getByTestId('overview-progress-percent')).toHaveText(`${progress.progress.percent} %`);
    await expect(page.getByTestId('overview-next-action')).toHaveAttribute(
      'data-action',
      progress.nextStep.action,
    );
    for (const id of ['achievements', 'class', 'assignments', 'badges', 'battle']) {
      await expect(page.getByTestId(`overview-${id}`)).toBeVisible();
    }
    await expect(
      page.getByTestId('overview-class').getByRole('link', { name: ru.student.class.join }),
    ).toBeVisible();
    await expect(page.getByTestId('overview-battle')).toContainText(o.student.noBattle);
    await expect(
      page.getByTestId('overview-achievements').getByRole('link', { name: o.student.allAchievements }),
    ).toHaveAttribute('href', '/ru/learn/achievements');
  });

  test('AC-PRF-02 REQ-PRF-04 teacher overview: summary, quick actions; AC-PRF-11 axe, no horizontal scroll, both themes', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await teacher(baseURL!), baseURL!);
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/ru/account');
      await expect(page.getByTestId('overview-summary')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await expect(page.getByTestId('profile-card')).toContainText(ru.cabinet.roles.teacher);
    for (const key of ['classes', 'students', 'subjects', 'publishedTopics'] as const) {
      await expect(page.getByTestId(`overview-count-${key}`)).toContainText('0');
    }
    const actions = page.getByTestId('overview-actions');
    for (const [name, href] of [
      [o.teacher.newSubject, '/ru/teacher/subjects/new'],
      [o.teacher.assign, '/ru/teacher/assignments'],
      [o.teacher.launchBattle, '/ru/teacher/battles'],
      [o.teacher.createClass, '/ru/teacher/classes'],
    ] as const) {
      await expect(actions.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    // Вкладки: «Обзор», «Профиль», «Настройки», «Данные».
    const tabs = page.getByRole('navigation', { name: ru.account.tabsLabel }).getByRole('link');
    await expect(tabs).toHaveText([
      ru.account.tabs.overview,
      ru.account.tabs.profile,
      ru.account.tabs.settings,
      ru.account.tabs.privacy,
    ]);
    await expect(tabs.first()).toHaveAttribute('aria-current', 'page');
  });

  test('AC-PRF-11 the account pages are translated: RU, KK, EN (texts from i18n)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    for (const locale of ['ru', 'kk', 'en'] as const) {
      const b = bundles[locale].account;
      await page.goto(`/${locale}/account`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(b.overview.title);
      await page.goto(`/${locale}/account/profile`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(b.profile.title);
      await page.goto(`/${locale}/account/settings`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(b.settings.title);
      await expect(page.getByRole('navigation', { name: b.tabsLabel }).getByRole('link')).toHaveText([
        b.tabs.overview,
        b.tabs.profile,
        b.tabs.settings,
        b.tabs.privacy,
      ]);
    }
  });
});
