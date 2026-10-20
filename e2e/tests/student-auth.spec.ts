import { randomUUID } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const sa = ru.studentAuth;
const uid = () => randomUUID().slice(0, 8);

const card = (page: Page) => page.getByTestId('student-auth');

async function fillRegistration(
  page: Page,
  data: { name: string; login: string; password?: string; email?: string; code?: string },
) {
  const c = card(page);
  await c.getByRole('textbox', { name: sa.name }).fill(data.name);
  await c.getByRole('textbox', { name: sa.login }).fill(data.login);
  await c.getByLabel(sa.password, { exact: true }).fill(data.password ?? 'student-pass-1');
  if (data.email) await c.getByRole('textbox', { name: sa.email }).fill(data.email);
  if (data.code) await c.getByRole('textbox', { name: sa.code }).fill(data.code);
}

/** Учитель, класс и код через API (отдельный контекст запросов). */
async function teacherWithCode(baseURL: string | undefined, className: string) {
  const api = await request.newContext({ baseURL });
  const email = `t.${uid()}@example.kz`;
  expect(
    (
      await api.post('/api/auth/register', {
        data: { role: 'teacher', email, displayName: 'Учитель Е2Е', password: 'teacher-pass-1' },
      })
    ).status(),
  ).toBe(201);
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
  const cls = await (
    await api.post('/api/teacher/classes', { data: { name: className }, headers: { 'X-CSRF-Token': csrf } })
  ).json();
  const code = await (
    await api.post(`/api/teacher/classes/${cls.id}/invite-codes`, { headers: { 'X-CSRF-Token': csrf } })
  ).json();
  return { api, csrf, classId: cls.id as string, code: code.code as string, email };
}

test.describe('Ученик: вход или регистрация (эталон student-auth.png)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-GEN-AUTH-02 layout: Syntara, «УЧЕНИК», heading, tabs, fields in order, notes and links', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start?role=student');
    const c = card(page);
    await expect(c.getByText('Syntara', { exact: true })).toBeVisible();
    await expect(c.getByText(sa.label, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(sa.title);
    await expect(c.getByRole('tab', { name: sa.tabRegister })).toHaveAttribute('aria-selected', 'true');
    await expect(c.getByRole('tab', { name: sa.tabLogin })).toHaveAttribute('aria-selected', 'false');

    const labels = await c.locator('#student-panel-register label').allTextContents();
    expect(labels).toEqual([sa.name, sa.login, sa.password, sa.email, sa.school, sa.code]);
    await expect(c.getByRole('textbox', { name: sa.name })).toHaveAttribute(
      'placeholder',
      sa.namePlaceholder,
    );
    await expect(c.getByRole('combobox', { name: sa.school })).toHaveAttribute(
      'placeholder',
      sa.schoolPlaceholder,
    );
    await expect(c.getByRole('textbox', { name: sa.code })).toHaveAttribute(
      'placeholder',
      sa.codePlaceholder,
    );
    await expect(c.getByText(sa.passwordHint)).toBeVisible();
    await expect(c.getByText(sa.schoolHint)).toBeVisible();
    await expect(c.getByText(sa.codeHint)).toBeVisible();
    await expect(c.getByRole('button', { name: sa.submit })).toBeVisible();
    await expect(c.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute(
      'href',
      '/ru/terms',
    );
    await expect(c.getByRole('link', { name: 'Политику конфиденциальности' })).toHaveAttribute(
      'href',
      '/ru/privacy',
    );
    await expect(c.getByText(sa.accountNote)).toBeVisible();
    await expect(c.getByRole('link', { name: sa.forgotLink }).first()).toHaveAttribute(
      'href',
      '/ru/auth/login?forgot=1',
    );
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('REQ-GEN-AUTH-02 password eye toggles visibility; email in the login field gets a clear hint', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start?role=student');
    const c = card(page);
    const password = c.getByLabel(sa.password, { exact: true });
    await password.fill('secret-pass');
    await expect(password).toHaveAttribute('type', 'password');
    await c.getByRole('button', { name: sa.showPassword }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await c.getByRole('button', { name: sa.hidePassword }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await c.getByRole('textbox', { name: sa.login }).fill('kid@example.kz');
    await expect(c.getByText(ru.validation.loginIsEmail)).toBeVisible();
  });

  test('AC-AUTH-05 sign-up without code and email → cabinet with «Подключиться к классу»; later sign-in by login', async ({
    page,
  }) => {
    const login = `solo.${uid()}`;
    await page.goto('/ru/auth/start?role=student');
    await fillRegistration(page, { name: 'Самостоятельный', login });
    await card(page).getByRole('button', { name: sa.submit }).click();
    await expect(page).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(page.getByTestId('student-join')).toBeVisible();

    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/ru$/);
    await page.goto('/ru/auth/start?role=student');
    await card(page).getByRole('tab', { name: sa.tabLogin }).click();
    await card(page).getByRole('textbox', { name: sa.identifier }).fill(login);
    await card(page).getByLabel(sa.password, { exact: true }).fill('student-pass-1');
    await card(page).getByRole('button', { name: sa.loginSubmit }).click();
    await expect(page).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(page.getByTestId('cabinet-header')).toBeVisible();
  });

  test('AC-AUTH-06 sign-up with a class code → the student is in the class right away', async ({
    page,
    baseURL,
  }) => {
    const { api, code } = await teacherWithCode(baseURL, '8 «Г»');
    await page.goto('/ru/auth/start?role=student');
    await fillRegistration(page, { name: 'С кодом', login: `coded.${uid()}`, code: code.toLowerCase() });
    await card(page).getByRole('button', { name: sa.submit }).click();
    await expect(page).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(page.getByTestId('student-class-card')).toContainText('Вы в классе «8 «Г»»');
    await api.dispose();
  });

  test('AC-AUTH-02 sign-in, then join a class by code from the cabinet', async ({ page, baseURL }) => {
    const { api, code } = await teacherWithCode(baseURL, 'Позже');
    const login = `later.${uid()}`;
    const guest = await request.newContext({ baseURL });
    expect(
      (
        await guest.post('/api/auth/register-student', {
          data: { displayName: 'Позже', login, password: 'student-pass-1' },
        })
      ).status(),
    ).toBe(201);
    await guest.dispose();

    await page.goto('/ru/auth/start?role=student');
    await card(page).getByRole('tab', { name: sa.tabLogin }).click();
    await card(page).getByRole('textbox', { name: sa.identifier }).fill(login);
    await card(page).getByLabel(sa.password, { exact: true }).fill('student-pass-1');
    await card(page).getByRole('button', { name: sa.loginSubmit }).click();
    await expect(page.getByTestId('student-join')).toBeVisible();
    await page.getByRole('textbox', { name: ru.join.codeLabel }).fill(code);
    await page.getByRole('button', { name: ru.student.class.joinSubmit }).click();
    await page
      .getByRole('dialog', { name: ru.join.confirmTitle })
      .getByRole('button', { name: ru.join.confirm })
      .click();
    await expect(page.getByTestId('student-class-card')).toContainText('Вы в классе «Позже»');
    await api.dispose();
  });

  test('REQ-GEN-AUTH-02 «Продолжить без входа» → guest mode: home with the demo question and subjects', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start?role=student');
    await card(page).getByTestId('continue-as-guest').click();
    await expect(page).toHaveURL(/\/ru$/);
    await expect(page.getByTestId('demo-question')).toBeVisible();
    await expect(page.getByTestId('home-subjects')).toBeVisible();
    await expect(page.getByTestId('public-header').getByRole('link', { name: ru.shell.login })).toBeVisible();
  });

  test('REQ-GEN-AUTH-02 school: pick from the list with the keyboard, or enter manually', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start?role=student');
    const school = card(page).getByRole('combobox', { name: sa.school });
    await school.fill('Талг');
    await expect(page.getByRole('option', { name: /Средняя школа №2/ })).toBeVisible();
    await school.press('ArrowDown');
    await school.press('Enter');
    await expect(school).toHaveValue('Средняя школа №2');

    await card(page).getByRole('button', { name: sa.schoolManual }).click();
    await expect(card(page).getByText(sa.schoolUnverified)).toBeVisible();
    await card(page).getByRole('textbox', { name: sa.school }).fill('Сельская школа, с. Каскелен');
    await fillRegistration(page, { name: 'Ручная школа', login: `manual.${uid()}` });
    await card(page).getByRole('button', { name: sa.submit }).click();
    await expect(page).toHaveURL(/\/ru\/learn\/subjects$/);
  });

  test('AC-AUTH-07 teacher issues a temporary password; the student must change it before the cabinet', async ({
    page,
    browser,
    baseURL,
  }) => {
    const { api, code, email } = await teacherWithCode(baseURL, 'Пароли');
    const login = `forgot.${uid()}`;
    const guest = await request.newContext({ baseURL });
    await guest.post('/api/auth/register-student', {
      data: { displayName: 'Забывашка', login, password: 'student-pass-1', code },
    });
    await guest.dispose();
    await api.dispose();

    await page.goto('/ru/auth/login');
    await page.getByRole('textbox', { name: ru.auth.login.email }).fill(email);
    await page.getByLabel(ru.auth.login.password).fill('teacher-pass-1');
    await page.getByRole('button', { name: ru.auth.login.submit }).click();
    await expect(page).toHaveURL(/\/ru\/teacher\/courses$/);
    // Новый учитель ещё не подтвердил email — напоминание с повторной отправкой (AC-AUTH-08).
    await expect(page.getByTestId('verify-email-banner')).toContainText(ru.cabinet.verify.text);
    await page.getByRole('button', { name: ru.cabinet.verify.resend }).click();
    await expect(page.getByTestId('verify-email-banner')).toContainText(ru.cabinet.verify.resent);

    await page.goto('/ru/teacher/classes');
    const row = page.getByTestId('teacher-class').filter({ hasText: 'Пароли' });
    await row.getByRole('button', { name: ru.teacher.classes.showStudents }).click();
    await row
      .getByTestId('class-roster')
      .getByRole('button', { name: ru.teacher.classes.tempPassword })
      .click();
    const temp = (await page.getByTestId('temporary-password').textContent())!.trim();
    expect(temp).toMatch(/^[a-z2-9]{10}$/);

    const ctx = await browser.newContext();
    await acceptCookies(ctx, baseURL);
    const s = await ctx.newPage();
    await s.goto('/ru/auth/login');
    await s.getByRole('textbox', { name: ru.auth.login.email }).fill(login);
    await s.getByLabel(ru.auth.login.password).fill(temp);
    await s.getByRole('button', { name: ru.auth.login.submit }).click();
    await expect(s).toHaveURL(/\/ru\/auth\/login\?change=1$/);
    await expect(s.getByRole('heading', { level: 1 })).toHaveText(ru.auth.change.title);
    // Кабинет недоступен, пока пароль не сменён.
    await s.goto('/ru/learn/subjects');
    await expect(s).toHaveURL(/\/ru\/auth\/login\?change=1$/);
    await s.getByLabel(ru.auth.change.password).fill('my-own-pass-1');
    await s.getByRole('button', { name: ru.auth.change.submit }).click();
    await expect(s).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(s.getByTestId('student-class-card')).toContainText('Вы в классе «Пароли»');
    await ctx.close();
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`REQ-NFR-A11Y-01 axe: student sign-up and sign-in tabs in ${theme} theme`, async ({
      page,
      baseURL,
    }) => {
      await page.context().addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      await page.goto('/ru/auth/start?role=student');
      await expectNoSeriousA11yViolations(page);
      await card(page).getByRole('tab', { name: sa.tabLogin }).click();
      await expectNoSeriousA11yViolations(page);
    });
  }
});
