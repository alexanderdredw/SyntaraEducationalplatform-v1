import { randomUUID } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isMobile,
} from './support';

const ru = bundles.ru;
const uid = () => randomUUID().slice(0, 8);

/** Регистрация учителя через API в контексте страницы (cookie сессии попадают в браузер). */
async function signUpTeacher(page: Page, name = 'Учитель Тестов') {
  const email = `teacher.${uid()}@example.kz`;
  const res = await page.request.post('/api/auth/register', {
    data: { role: 'teacher', email, displayName: name, password: 'teacher-pass-1' },
  });
  expect(res.status()).toBe(201);
  return { email, password: 'teacher-pass-1' };
}

/** Класс и свежий код через API от имени вошедшего учителя. */
async function registerStudentAsGuest(baseURL: string | undefined, code: string, login: string) {
  const guest = await request.newContext({ baseURL });
  const res = await guest.post('/api/auth/register-student', {
    data: { code, displayName: 'Ученик', login, password: 'student-pass-1' },
  });
  expect(res.status()).toBe(201);
  await guest.dispose();
}

async function classWithCode(page: Page, name: string): Promise<string> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'csrf')!.value;
  const cls = await page.request.post('/api/teacher/classes', {
    data: { name },
    headers: { 'X-CSRF-Token': csrf },
  });
  const { id } = (await cls.json()) as { id: string };
  const code = await page.request.post(`/api/teacher/classes/${id}/invite-codes`, {
    headers: { 'X-CSRF-Token': csrf },
  });
  return ((await code.json()) as { code: string }).code;
}

test.describe('Аккаунты и классы (итерация 6)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-GEN-AUTH-02 /auth/start: student → «Вход или регистрация»; teacher → sign-up → teacher cabinet', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start');
    await page.getByTestId('start-student').click();
    await expect(page).toHaveURL(/\/ru\/auth\/start\?role=student$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.studentAuth.title);

    await page.goto('/ru/auth/start');
    await page.getByTestId('start-teacher').click();
    const form = page.getByTestId('teacher-register');
    await form.getByRole('button', { name: ru.auth.start.submit }).click();
    await expect(form.getByText(ru.validation.passwordTooShort)).toBeVisible();
    await form.getByRole('textbox', { name: ru.auth.start.email }).fill(`new.${uid()}@example.kz`);
    await form.getByRole('textbox', { name: ru.auth.start.displayName }).fill('Айгерим Сапарова');
    await form.getByLabel(ru.auth.start.password).fill('teacher-pass-1');
    await form.getByRole('button', { name: ru.auth.start.submit }).click();

    await expect(page).toHaveURL(/\/ru\/teacher\/courses$/);
    const header = page.getByTestId('cabinet-header');
    await expect(header.getByTestId('cabinet-role')).toContainText(ru.cabinet.roles.teacher);
    await expect(header.getByRole('link', { name: new RegExp('Айгерим Сапарова') })).toBeVisible();
    // С итерации 7 «Мои курсы» — список предметов (API-T-01), а не заглушка.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.teacher.courses.title);
  });

  test('REQ-GEN-SHELL-02..05 cabinet header, sidebar, lamp and «Кабинет» in the footer', async ({ page }) => {
    await signUpTeacher(page);
    await page.goto('/ru/teacher/classes');
    const header = page.getByTestId('cabinet-header');
    for (const name of [ru.cabinet.notifications, ru.cabinet.logout]) {
      await expect(header.getByRole('button', { name })).toBeVisible();
    }
    await header.getByRole('button', { name: ru.cabinet.notifications }).click();
    await expect(page.getByText(ru.cabinet.noNotifications)).toBeVisible();
    await page.keyboard.press('Escape');

    const sidebar = page.getByTestId('cabinet-sidebar');
    await expect(sidebar.getByRole('link', { name: ru.cabinet.nav.classes })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await sidebar.getByRole('link', { name: ru.cabinet.nav.assignments }).click();
    await expect(page).toHaveURL(/\/ru\/teacher\/assignments$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.teacher.assignments.title);

    await expect(page.getByTestId('cabinet-lamp')).toBeVisible();
    const footer = page.getByTestId('site-footer');
    await expect(footer.getByRole('link', { name: ru.footer.cabinet })).toHaveAttribute(
      'href',
      '/ru/teacher/courses',
    );
    await expect(footer.getByRole('link', { name: ru.footer.joinClass })).toHaveCount(0);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('API-T-04..06 teacher creates a class and issues a code shown once', async ({ page }) => {
    await signUpTeacher(page);
    await page.goto('/ru/teacher/classes');
    await expect(page.getByText(ru.teacher.classes.empty)).toBeVisible();
    await page.getByRole('textbox', { name: ru.teacher.classes.name }).fill('7 «Б»');
    await page.getByRole('button', { name: ru.teacher.classes.create }).click();
    const row = page.getByTestId('teacher-class').filter({ hasText: '7 «Б»' });
    await expect(row).toContainText('Учеников: 0');
    await row.getByRole('button', { name: ru.teacher.classes.issueCode }).click();
    const dialog = page.getByRole('dialog', { name: 'Код для класса «7 «Б»»' });
    await expect(dialog.getByTestId('issued-code')).toHaveText(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    await expect(dialog).toContainText('Код показывается один раз');
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-AUTH-01, PH-44 guest checks a valid code, signs up as a student by login and lands in the class', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signUpTeacher(page, 'Алия Учитель');
    const code = await classWithCode(page, '5 «А»');

    const guest = await browser.newContext();
    await acceptCookies(guest, baseURL);
    const g = await guest.newPage();
    const check = g.waitForResponse((r) => r.url().includes('/api/public/join/check'));
    await g.goto('/ru/join');
    await g.getByRole('textbox', { name: ru.join.codeLabel }).fill(` ${code.toLowerCase()} `);
    await g.getByRole('button', { name: ru.join.check }).click();
    expect(await (await check).json()).toEqual({ valid: true });
    await expect(g.getByTestId('join-valid')).toContainText(ru.join.valid);
    await expect(g.getByTestId('join-valid').getByRole('link', { name: ru.join.login })).toHaveAttribute(
      'href',
      '/ru/auth/login?returnTo=%2Fjoin',
    );

    const login = `kid.${uid()}`;
    // Та же форма ученика с заполненным кодом (REQ-GEN-AUTH-03).
    const reg = g.getByTestId('student-auth');
    await expect(reg.getByRole('textbox', { name: ru.studentAuth.code })).toHaveValue(
      ` ${code.toLowerCase()} `,
    );
    await reg.getByRole('textbox', { name: ru.studentAuth.name }).fill('Асель');
    await reg.getByRole('textbox', { name: ru.studentAuth.login }).fill(login);
    await reg.getByLabel(ru.studentAuth.password, { exact: true }).fill('student-pass-1');
    await reg.getByRole('button', { name: ru.studentAuth.submit }).click();

    await expect(g).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(g.getByTestId('student-class-card')).toContainText('Вы в классе «5 «А»»');
    await expect(g.getByTestId('student-class-card')).toContainText('Учитель: Алия Учитель');
    await expect(g.getByTestId('cabinet-stats')).toBeVisible();
    await guest.close();
  });

  test('REQ-GEN-AUTH-03 invalid code → «Код не найден или истёк…» with a support link', async ({ page }) => {
    await page.goto('/ru/join');
    await page.getByRole('textbox', { name: ru.join.codeLabel }).fill('ZZZZZZ');
    await page.getByRole('button', { name: ru.join.check }).click();
    await expect(page.getByTestId('join-invalid')).toContainText(ru.join.invalid);
    await expect(
      page.getByTestId('join-invalid').getByRole('link', { name: ru.help.supportLink }),
    ).toHaveAttribute('href', '/ru/support');
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-AUTH-02, AC-AUTH-04 student signs in by login, joins after confirmation, leaves after confirmation', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signUpTeacher(page);
    const first = await classWithCode(page, 'Первый');
    const second = await classWithCode(page, 'Второй');
    const login = `pupil.${uid()}`;
    await registerStudentAsGuest(baseURL, first, login);

    const ctx = await browser.newContext();
    await acceptCookies(ctx, baseURL);
    const s = await ctx.newPage();
    await s.goto('/ru/auth/login');
    await s.getByRole('textbox', { name: ru.auth.login.email }).fill(login.toUpperCase());
    await s.getByLabel(ru.auth.login.password).fill('student-pass-1');
    await s.getByRole('button', { name: ru.auth.login.submit }).click();
    await expect(s).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(s.getByTestId('student-class-card')).toContainText('Вы в классе «Первый»');

    // Выход из класса — подтверждение «Выйти из класса «…»?» (PH-40), это не выход из аккаунта.
    await s.getByTestId('student-class-card').getByRole('button', { name: ru.student.class.leave }).click();
    const confirm = s.getByRole('dialog', { name: 'Выйти из класса «Первый»?' });
    await confirm.getByRole('button', { name: ru.student.class.leaveYes }).click();
    await expect(s.getByTestId('student-class-card')).toHaveCount(0);
    await expect(s.getByTestId('student-join')).toBeVisible();
    await expect(s.getByTestId('cabinet-header')).toBeVisible();

    // Вступление с подтверждением «Присоединиться к классу?»; повтор не создаёт второй записи (API).
    await s.getByRole('textbox', { name: ru.student.class.join }).fill(second);
    await s.getByRole('button', { name: ru.student.class.joinSubmit }).click();
    await s
      .getByRole('dialog', { name: ru.join.confirmTitle })
      .getByRole('button', { name: ru.join.confirm })
      .click();
    await expect(s.getByTestId('student-class-card')).toContainText('Вы в классе «Второй»');
    await expectNoSeriousA11yViolations(s);
    await ctx.close();
  });

  test('REQ-GEN-AUTH-03 signed-in student opening /join gets the «Присоединиться к классу?» confirmation', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signUpTeacher(page);
    const first = await classWithCode(page, 'Старт');
    const target = await classWithCode(page, 'Цель');
    const login = `join.${uid()}`;
    await registerStudentAsGuest(baseURL, first, login);
    const ctx = await browser.newContext();
    await acceptCookies(ctx, baseURL);
    const s = await ctx.newPage();
    await s.request.post('/api/auth/login', { data: { email: login, password: 'student-pass-1' } });
    await s.goto('/ru/join');
    await s.getByRole('textbox', { name: ru.join.codeLabel }).fill(target);
    await s.getByRole('button', { name: ru.join.check }).click();
    await s
      .getByRole('dialog', { name: ru.join.confirmTitle })
      .getByRole('button', { name: ru.join.confirm })
      .click();
    await expect(s).toHaveURL(/\/ru\/learn\/subjects$/);
    await expect(s.getByTestId('student-class-card')).toContainText('Вы в классе «Цель»');
    await ctx.close();
  });

  test('API-AUTH-04 «Забыли пароль?» → same answer for any email; invalid reset link → message', async ({
    page,
  }) => {
    await page.goto('/ru/auth/login');
    await page.getByRole('link', { name: ru.auth.login.forgot }).click();
    await expect(page).toHaveURL(/\/ru\/auth\/login\?forgot=1$/);
    await page.getByRole('textbox', { name: ru.auth.forgot.email }).fill('nobody@example.kz');
    await page.getByRole('button', { name: ru.auth.forgot.submit }).click();
    await expect(page.getByTestId('forgot-sent')).toHaveText(ru.auth.forgot.sent);
    // Клиентский переход завершён — заголовок документа выставлен.
    await expect(page).toHaveTitle(ru.common.appName);
    await expectNoSeriousA11yViolations(page);

    await page.goto('/ru/auth/login?resetToken=not-a-real-token-123456');
    await page.getByLabel(ru.auth.reset.password).fill('new-password-1');
    await page.getByRole('button', { name: ru.auth.reset.submit }).click();
    await expect(page.getByTestId('reset-form').getByRole('alert')).toContainText(ru.auth.reset.invalid);
  });

  test('REQ-GEN-AUTH-04 «Мои данные»: list of stored data, request a copy → ticket number', async ({
    page,
  }) => {
    await signUpTeacher(page);
    await page.goto('/ru/account/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.privacy.title);
    await expect(page.getByTestId('privacy-page').getByRole('listitem')).toHaveCount(7);
    await page.getByRole('button', { name: ru.privacy.requestCopy }).click();
    await expect(page.getByTestId('privacy-result')).toHaveText(
      /Запрос принят\. Номер обращения: T-\d{6}-\d{4}\./,
    );
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-NFR-A11Y-01 axe: /auth/start (teacher form), /join, cabinet pages; no horizontal scroll', async ({
    page,
  }) => {
    for (const path of ['/ru/auth/start?role=teacher', '/ru/join']) {
      await page.goto(path);
      await expectNoSeriousA11yViolations(page);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await signUpTeacher(page);
    await page.goto('/ru/teacher/classes');
    await expectNoSeriousA11yViolations(page);
    if (isMobile(page)) expect(await hasHorizontalScroll(page)).toBe(false);
  });
});
