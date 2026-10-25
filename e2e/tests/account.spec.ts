import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  cabinetNav,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isMobile,
  isPhone,
} from './support';
import { addLearningEvents } from './db';

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

  test('AC-PRF-02 AC-PRF-21 student overview: header with cover, avatar, numbers and tabs; numbers match the sections', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/account');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(o.title);
    const header = page.getByTestId('account-header');
    await expect(header.getByTestId('account-name')).toHaveText('Асель Нурова');
    await expect(header).toContainText(ru.cabinet.roles.student);
    await expect(header).toContainText(/acc\./);
    // FIX-01: родительный падеж месяца.
    await expect(header.getByTestId('account-since')).toHaveText(/^На платформе с [а-я]+я 20\d\d\s?г\.$/);
    await expect(header.getByTestId('account-cover')).toHaveAttribute('aria-hidden', 'true');
    await expect(header.getByRole('link', { name: o.editProfile })).toHaveAttribute(
      'href',
      '/ru/account/profile',
    );

    const achievements = await (await page.request.get('/api/student/achievements')).json();
    await expect(header.getByTestId('account-stat-level')).toContainText(String(achievements.level));
    await expect(header.getByTestId('account-stat-xp')).toContainText(String(achievements.xpTotal));
    await expect(header.getByTestId('account-stat-badges')).toContainText(
      `${achievements.earnedCount} из 12`,
    );
    await expect(header.getByTestId('account-stat-level')).toHaveAttribute('href', '/ru/learn/achievements');

    const progress = await (await page.request.get('/api/student/progress?period=30d')).json();
    await expect(page.getByTestId('overview-progress-percent')).toHaveText(`${progress.progress.percent} %`);
    await expect(page.getByTestId('overview-next-action')).toHaveAttribute(
      'data-action',
      progress.nextStep.action,
    );
  });

  test('AC-PRF-21 the same header and tabs on all four pages; tabs are a tablist with arrow keys', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    const tabs = [
      ru.account.tabs.overview,
      ru.account.tabs.profile,
      ru.account.tabs.settings,
      ru.account.tabs.privacy,
    ];
    for (const [i, path] of [
      '/ru/account',
      '/ru/account/profile',
      '/ru/account/settings',
      '/ru/account/privacy',
    ].entries()) {
      await page.goto(path);
      await expect(page.getByTestId('account-header').getByTestId('account-name')).toHaveText('Асель Нурова');
      await expect(page.getByTestId('account-stats').getByRole('link')).toHaveCount(5);
      await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(tabs);
      await expect(page.getByRole('tab', { name: tabs[i] })).toHaveAttribute('aria-selected', 'true');
    }
    await page.goto('/ru/account');
    await page.getByRole('tab', { name: tabs[0] }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: tabs[1] })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: tabs[3] })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/ru\/account\/privacy$/);
  });

  test('AC-PRF-22 AC-PRF-23 AC-PRF-24 calendar with day counts and arrows; completeness with «Скрыть»; card order and empty states', async ({
    page,
    context,
    baseURL,
  }) => {
    const s = await student(baseURL!);
    const me = await (await s.get('/api/me')).json();
    // Три открытия урока вчера (полдень Алматы) — в календаре 3 занятия.
    await addLearningEvents(me.id, 'lesson_opened', 1, 3);
    await signIn(context, s, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/ru/account');

    const activity = await (await page.request.get('/api/me/activity?weeks=12')).json();
    const yesterday = activity.days.at(-2);
    expect(yesterday.count).toBe(3);
    const grid = page.getByTestId('activity-grid');
    await expect(grid).toHaveAttribute('role', 'img');
    await expect(grid.locator(`[data-date="${yesterday.date}"]`)).toHaveAttribute('data-level', '2');
    await expect(page.getByTestId('activity-active-days')).toHaveText('Активных дней за 12 недель: 1');
    await expect(page.getByTestId('activity-longest')).toHaveText('Самая длинная серия: 1 дн.');
    await grid.focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('activity-tooltip')).toHaveText(/: 3 занятия$/);

    // Заполненность (REQ-PRF-22): ученик без аватара и email — 25 %; «Скрыть» убирает карточку.
    const card = page.getByTestId('profile-completeness');
    await expect(card).toContainText(ru.account.completeness.title.replace('{percent}', '25'));
    await expect(
      card.getByRole('link', { name: new RegExp(ru.account.completeness.items.email) }),
    ).toHaveAttribute('href', '/ru/account/settings#email');
    await card.getByRole('button', { name: ru.account.completeness.hide }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('activity-grid')).toBeVisible();
    await expect(page.getByTestId('profile-completeness')).toHaveCount(0);

    // Порядок карточек (REQ-PRF-23) и пустые состояния с действием (REQ-PRF-24).
    const order = await page
      .locator(
        '[data-testid^="overview-"][data-testid$="step"], [data-testid="overview-progress"], [data-testid="overview-achievements"], [data-testid="overview-activity"], [data-testid="overview-assignments"], [data-testid="overview-class"], [data-testid="overview-badges"], [data-testid="overview-battle"]',
      )
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([
      'overview-next-step',
      'overview-progress',
      'overview-achievements',
      'overview-activity',
      'overview-assignments',
      'overview-class',
      'overview-badges',
      'overview-battle',
    ]);
    if (!isMobile(page)) {
      for (const [a, b] of [
        ['overview-progress', 'overview-achievements'],
        ['overview-assignments', 'overview-class'],
        ['overview-badges', 'overview-battle'],
      ] as const) {
        const ha = (await page.getByTestId(a).boundingBox())!.height;
        const hb = (await page.getByTestId(b).boundingBox())!.height;
        expect(Math.abs(ha - hb), `${a} | ${b}`).toBeLessThan(1);
      }
    }
    await expect(
      page.getByTestId('overview-battle').getByRole('link', { name: o.student.noBattleAction }),
    ).toHaveAttribute('href', '/ru/learn/battles');
    await expect(
      page.getByTestId('overview-class').getByRole('link', { name: o.student.noClassAction }),
    ).toHaveAttribute('href', '/ru/learn/class');
    await expect(page.getByTestId('overview-badges')).toContainText(o.student.noBadgesTitle);
    await expect(
      page.getByTestId('overview-assignments').getByRole('link', { name: o.student.noAssignmentsAction }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('AC-PRF-25 teacher overview: «Требуют внимания» links to the class analytics with the student highlighted; «Сдано X из Y»; AC-PRF-31 axe, both themes', async ({
    page,
    context,
    baseURL,
  }) => {
    const t = await teacher(baseURL!);
    const csrf = (await t.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
    const call = async (path: string, data: object = {}) => {
      const res = await t.post(path, { data, headers: { 'X-CSRF-Token': csrf } });
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    };
    const cls = await call('/api/teacher/classes', { name: '8 «А»' });
    const { code } = await call(`/api/teacher/classes/${cls.id}/invite-codes`);
    await account(baseURL!, '/api/auth/register-student', {
      displayName: 'Ерлан Сапаров',
      login: `acc.${uid()}`,
      password: 'student-pass-1',
      code,
    });
    const subject = await call('/api/teacher/subjects', {
      translations: { ru: { title: 'Ботаника', description: 'Растения' } },
      inPublicCatalog: false,
    });
    const topic = await call(`/api/teacher/subjects/${subject.id}/topics`);
    await t.put(`/api/teacher/topics/${topic.id}`, {
      data: { translations: { ru: { title: 'Корень' } }, materialIds: [] },
      headers: { 'X-CSRF-Token': csrf },
    });
    await call(`/api/teacher/topics/${topic.id}/quiz/questions`, {
      type: 'single_choice',
      difficulty: 'easy',
      translations: { ru: { text: 'Вопрос?' } },
      options: [0, 1].map((i) => ({ translations: { ru: `Ответ ${i}` }, isCorrect: i === 0 })),
    });
    await call(`/api/teacher/topics/${topic.id}/publish`);
    await call(`/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
    await call('/api/teacher/assignments', {
      classId: cls.id,
      subjectId: subject.id,
      topicId: topic.id,
      dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    await signIn(context, t, baseURL!);

    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/ru/account');
      await expect(page.getByTestId('overview-deadline-progress')).toHaveText('Сдано 0 из 1');
      await expectNoSeriousA11yViolations(page);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    const header = page.getByTestId('account-header');
    await expect(header).toContainText(ru.cabinet.roles.teacher);
    await expect(header.getByTestId('account-stat-classes')).toContainText('1');
    await expect(header.getByTestId('account-stat-students')).toContainText('1');
    await expect(header.getByTestId('account-stat-battles')).toHaveAttribute(
      'href',
      '/ru/teacher/battles?tab=history',
    );
    await expect(
      page.getByTestId('overview-battles').getByRole('link', { name: o.teacher.noBattlesAction }),
    ).toBeVisible();
    const student = page.getByTestId('overview-attention-student').first();
    await expect(student).toContainText('Ерлан Сапаров');
    await expect(student).toContainText('ещё не занимался');
    await student.click();
    await expect(page).toHaveURL(new RegExp(`/ru/teacher/classes/${cls.id}/analytics\\?student=`));
    await expect(page.locator('[data-testid="attention-student"][data-highlighted="true"]')).toContainText(
      'Ерлан Сапаров',
    );
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
      await expect(page.getByRole('tablist').getByRole('tab')).toHaveText([
        b.tabs.overview,
        b.tabs.profile,
        b.tabs.settings,
        b.tabs.privacy,
      ]);
    }
  });
});
