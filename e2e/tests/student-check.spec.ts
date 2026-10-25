import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  cabinetNav,
  expectNoSeriousA11yViolations,
  isPhone,
  switchCabinetLocale,
} from './support';

const ru = bundles.ru;

/** Вошедший через API ученик без класса (API-AUTH-03S); email необязателен. */
async function student(baseURL: string, withEmail = false): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const id = randomUUID().slice(0, 8);
  const res = await ctx.post('/api/auth/register-student', {
    data: {
      displayName: 'Асель Нурова',
      login: `stf.${id}`,
      password: 'student-pass-1',
      ...(withEmail ? { email: `stf.${id}@example.kz` } : {}),
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}

async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

/** «Анатомия человека» базовой программы и её первые две темы (API-PUB-10..12). */
async function anatomy(baseURL: string) {
  const anon = await request.newContext({ baseURL });
  const json = async (path: string) => (await anon.get(path)).json();
  const catalog = await json('/api/public/catalog');
  const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
  const section = await json(`/api/public/sections/${biology.id}`);
  const subject = section.subjects.find((s: { title: string }) => s.title === 'Анатомия человека');
  const topics = (await json(`/api/public/subjects/${subject.id}`)).topics as { id: string; title: string }[];
  await anon.dispose();
  return { first: topics[0]!, second: topics[1]! };
}

/** Часть B docs/NAV_TZ.md: функции ученика, для которых не было отдельной проверки. */
test.describe('Функции ученика (docs/NAV_TZ.md, часть B)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-STF-08, REQ-ST-LES-02/03, BR-XP-01 «Обзор»: fact, sections collapsed and several open, «Следующая →»; +5 XP once', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    const { first, second } = await anatomy(baseURL!);
    await page.goto(`/ru/learn/topics/${first.id}`);
    const overview = page.getByTestId('lesson-overview');
    await expect(overview.getByTestId('lesson-fun-fact')).toContainText(ru.teacher.lesson.funFact);

    // Аккордеон разделов: все свёрнуты, раскрываются несколько сразу (PH-36).
    const sections = overview.getByRole('button', { expanded: false });
    expect(await sections.count()).toBeGreaterThan(1);
    await expect(overview.getByRole('button', { expanded: true })).toHaveCount(0);
    await sections.nth(0).click();
    await overview.getByRole('button', { expanded: false }).nth(0).click();
    await expect(overview.getByRole('button', { expanded: true })).toHaveCount(2);

    // Первое открытие темы — +5 XP один раз (API-S-17): повторное открытие XP не добавляет.
    await expect(page.getByTestId('cabinet-stats')).toContainText('5 XP');
    await page.reload();
    await expect(page.getByTestId('lesson-overview')).toBeVisible();
    await expect(page.getByTestId('cabinet-stats')).toContainText('5 XP');
    expect((await (await page.request.get('/api/me/stats')).json()).xpTotal).toBe(5);

    // «СЛЕДУЮЩАЯ — {тема} →» ведёт на следующую тему (REQ-ST-LES-03).
    const next = page.getByTestId('lesson-next');
    await expect(next).toHaveAccessibleName(ru.teacher.lesson.next.replace('{title}', second.title));
    await next.click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/topics/${second.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: second.title })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-STF-03, API-ME-02 header: theme, data saver and language are saved in the account', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(isPhone(page), 'на телефоне те же переключатели — в меню (общий PreferencesProvider)');
    await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/learn/progress');
    const header = page.getByTestId('cabinet-header');
    await header.getByRole('button', { name: ru.shell.theme.toLight }).click();
    await header
      .getByRole('button', { name: new RegExp(ru.shell.dataSaver.label) })
      .first()
      .click();
    await switchCabinetLocale(page, 'kk');
    await expect
      .poll(async () => (await (await page.request.get('/api/me')).json()).preferences)
      .toEqual({ locale: 'kk', theme: 'light', dataSaver: true });
  });

  test('AC-STF-15, REQ-GEN-AUTH-04 student «Мои данные»: the list, a copy and a deletion request → ticket numbers', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!, true), baseURL!);
    await page.goto('/ru/learn/subjects');
    // Профиль (REQ-PRF-10): в хедере — меню «Данные и конфиденциальность»; на телефоне — строка профиля в меню,
    // затем вкладка «Данные» личного кабинета.
    if (isPhone(page)) {
      await cabinetNav(page);
      await page.getByTestId('profile-row').filter({ visible: true }).click();
      await expect(page).toHaveURL(/\/ru\/account$/);
      await page.getByRole('tab', { name: ru.account.tabs.privacy }).click();
    } else {
      await page.getByRole('button', { name: new RegExp(`${ru.cabinet.profile}: Асель Нурова`) }).click();
      await page.getByRole('menuitem', { name: ru.account.menu.privacy }).click();
    }
    await expect(page).toHaveURL(/\/ru\/account\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.privacy.title);
    await expect(page.getByTestId('privacy-page').getByRole('listitem')).toHaveCount(7);
    // «Мои данные» — тоже внутри рабочей среды (REQ-NAV-04).
    await expect(page.getByTestId('cabinet-header')).toBeVisible();
    for (const name of [ru.privacy.requestCopy, ru.privacy.requestDelete]) {
      await page.getByRole('button', { name }).click();
      await expect(page.getByTestId('privacy-result')).toHaveText(
        /Запрос принят\. Номер обращения: T-\d{6}-\d{4}\./,
      );
    }
    await expectNoSeriousA11yViolations(page);

    // Ученик без email: запрос записывается, обращения нет — ответить некуда (TODO(OWNER) в API-ME-05, SPEC 8.4.9).
    const other = await browser.newContext();
    await acceptCookies(other, baseURL);
    await signIn(other, await student(baseURL!), baseURL!);
    const p = await other.newPage();
    await p.goto('/ru/account/privacy');
    await p.getByRole('button', { name: ru.privacy.requestDelete }).click();
    await expect(p.getByTestId('privacy-result')).toHaveText(ru.privacy.sentNoNumber);
    await other.close();
  });
});
