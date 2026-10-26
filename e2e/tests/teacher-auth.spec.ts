import { randomUUID } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const ta = ru.teacherAuth;
const sa = ru.studentAuth;
const uid = () => randomUUID().slice(0, 8);
const plain = (text: string) => text.replace(/<\/?\w+>/g, '');

const card = (page: Page) => page.getByTestId('teacher-auth');

test.describe('Экран учителя «Вход или регистрация» (REQ-GEN-AUTH-01, REQ-GEN-AUTH-02)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-GEN-AUTH-02 «Я учитель» → card like the student one: «УЧИТЕЛЬ», fields in order, no student-only parts', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start');
    await page.getByTestId('start-teacher').click();
    await expect(page).toHaveURL(/\/ru\/auth\/start\?role=teacher$/);
    const c = card(page);
    await expect(c).toContainText(ta.label);
    await expect(c.getByRole('heading', { level: 1 })).toHaveText(ta.title);
    await expect(c.getByRole('tab', { name: ta.tabRegister })).toHaveAttribute('aria-selected', 'true');

    // Поля по порядку: Имя, Фамилия, Email, Пароль, Школа.
    const labels = await c.locator('#teacher-panel-register label').allTextContents();
    expect(labels).toEqual([ta.firstName, ta.lastName, ta.email, ta.password, ta.school]);
    await expect(c.getByRole('textbox', { name: ta.firstName, exact: true })).toHaveAttribute(
      'placeholder',
      ta.firstNamePlaceholder,
    );
    await expect(c.getByText(ta.passwordHint)).toBeVisible();
    await expect(c.getByRole('button', { name: ta.schoolManual })).toBeVisible();
    await expect(c.getByRole('button', { name: ta.submit })).toBeVisible();

    // Под кнопкой — согласие со ссылками и пояснение для учителя; частей формы ученика нет.
    await expect(c.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute(
      'href',
      '/ru/terms',
    );
    await expect(c.getByRole('link', { name: 'Политику конфиденциальности' })).toHaveAttribute(
      'href',
      '/ru/privacy',
    );
    await expect(c.getByTestId('teacher-account-note')).toHaveText(ta.accountNote);
    for (const text of [sa.login, sa.code, sa.guest, sa.accountNote, sa.namePlaceholder]) {
      await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId('continue-as-guest')).toHaveCount(0);

    // Пароль с «глазом».
    const password = c.getByLabel(ta.password, { exact: true });
    await password.fill('teacher-pass-1');
    await c.getByRole('button', { name: ta.showPassword }).click();
    await expect(password).toHaveAttribute('type', 'text');
  });

  test('REQ-GEN-AUTH-02, API-AUTH-03 sign-up: validation, first/last name in the profile, «Подтвердите email»', async ({
    page,
  }) => {
    await page.goto('/ru/auth/start?role=teacher');
    const c = card(page);
    await c.getByRole('button', { name: ta.submit }).click();
    await expect(c.locator('#teacher-firstName-error')).toHaveText(ru.validation.required);
    await expect(c.locator('#teacher-lastName-error')).toHaveText(ru.validation.required);
    await expect(c.locator('#teacher-email-error')).toHaveText(ru.validation.email);
    await expect(c.locator('#teacher-password-error')).toHaveText(ru.validation.passwordTooShort);
    await expect(c.getByRole('textbox', { name: ta.firstName, exact: true })).toBeFocused();

    const email = `t.${uid()}@example.kz`;
    await c.getByRole('textbox', { name: ta.firstName, exact: true }).fill('Айгерим');
    await c.getByRole('textbox', { name: ta.lastName, exact: true }).fill('Сапарова');
    await c.getByRole('textbox', { name: ta.email, exact: true }).fill(email);
    await c.getByLabel(ta.password, { exact: true }).fill('teacher-pass-1');
    await c.getByRole('button', { name: ta.schoolManual }).click();
    await c.getByPlaceholder(ta.schoolManualPlaceholder).fill('Школа №7, Шымкент');
    await c.getByRole('button', { name: ta.submit }).click();

    await expect(page).toHaveURL(/\/ru\/teacher\/courses$/);
    await expect(page.getByTestId('verify-email-banner')).toContainText(ru.cabinet.verify.text);
    const profile = await page.request.get('/api/me/profile');
    expect(await profile.json()).toMatchObject({
      firstName: 'Айгерим',
      lastName: 'Сапарова',
      email,
      emailVerified: false,
      school: { name: 'Школа №7, Шымкент' },
    });
    const me = await page.request.get('/api/me');
    expect(await me.json()).toMatchObject({ displayName: 'Айгерим Сапарова' });
  });

  test('REQ-GEN-AUTH-01 «Вход»: «Email», «Пароль», «Войти», «Забыли пароль?» with the email note; sign in', async ({
    page,
    baseURL,
  }) => {
    const email = `t.${uid()}@example.kz`;
    const api = await request.newContext({ baseURL });
    expect(
      (
        await api.post('/api/auth/register', {
          data: {
            role: 'teacher',
            email,
            firstName: 'Ерлан',
            lastName: 'Садыков',
            password: 'teacher-pass-1',
          },
        })
      ).status(),
    ).toBe(201);
    await api.dispose();

    await page.goto('/ru/auth/login?role=teacher');
    const c = card(page);
    await expect(c.getByRole('tab', { name: ta.tabLogin })).toHaveAttribute('aria-selected', 'true');
    const labels = await c.locator('#teacher-panel-login label').allTextContents();
    expect(labels).toEqual([ta.loginEmail, ta.password]);
    await expect(page.getByText(sa.identifier, { exact: true })).toHaveCount(0);
    await expect(page.getByText(sa.forgotNote)).toHaveCount(0);
    await expect(c.getByRole('link', { name: ta.forgotLink })).toHaveAttribute(
      'href',
      '/ru/auth/login?forgot=1',
    );
    await expect(c.getByText(ta.forgotNote)).toBeVisible();
    await expect(c.getByTestId('teacher-account-note')).toHaveText(ta.accountNote);
    // Согласие — только на вкладке «Регистрация».
    await expect(c.getByText(plain(ta.consent))).toHaveCount(0);

    await c.getByRole('button', { name: ta.loginSubmit }).click();
    await expect(c.locator('#teacher-login-email-error')).toHaveText(ru.validation.required);

    await c.getByRole('textbox', { name: ta.loginEmail, exact: true }).fill(email);
    await c.getByLabel(ta.password, { exact: true }).fill('wrong-pass-1');
    await c.getByRole('button', { name: ta.loginSubmit }).click();
    await expect(page.getByTestId('login-error')).toHaveText(ru.auth.login.invalid);
    await expect(c.getByLabel(ta.password, { exact: true })).toHaveValue('');

    await c.getByLabel(ta.password, { exact: true }).fill('teacher-pass-1');
    await c.getByRole('button', { name: ta.loginSubmit }).click();
    await expect(page).toHaveURL(/\/ru\/teacher\/courses$/);
  });

  test('REQ-GEN-AUTH-01 tabs switch inside the card; «вы» in KK and EN as well', async ({ page }) => {
    for (const locale of ['ru', 'kk', 'en'] as const) {
      const t = bundles[locale].teacherAuth;
      await page.goto(`/${locale}/auth/start?role=teacher`);
      const c = card(page);
      await expect(c).toContainText(t.label);
      await expect(c.getByTestId('teacher-account-note')).toHaveText(t.accountNote);
      await c.getByRole('tab', { name: t.tabLogin }).click();
      await expect(c.getByRole('textbox', { name: t.loginEmail, exact: true })).toBeVisible();
      await expect(c.getByText(t.forgotNote)).toBeVisible();
      await c.getByRole('tab', { name: t.tabRegister }).click();
      await expect(c.getByRole('textbox', { name: t.firstName, exact: true })).toBeVisible();
    }
  });

  test('REQ-NFR-A11Y-01 axe, 320/390/1440 px, dark and light themes: no horizontal scroll', async ({
    page,
  }) => {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        for (const path of ['/ru/auth/start?role=teacher', '/ru/auth/login?role=teacher']) {
          await page.goto(path);
          await expect(card(page)).toBeVisible();
          await expectNoSeriousA11yViolations(page);
          expect(await hasHorizontalScroll(page), `${path} ${width} ${theme}`).toBe(false);
        }
      }
    }
  });
});
