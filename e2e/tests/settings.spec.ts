import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { givePhotoAvatar } from './db';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isPhone,
} from './support';

const ru = bundles.ru;
const s = ru.account.settings;
const uid = () => randomUUID().slice(0, 8);

async function account(baseURL: string, path: string, data: object): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}
async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}
/** Вторая сессия того же пользователя — «другое устройство». */
async function otherDevice(baseURL: string, login: string, password: string) {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/login', { data: { email: login, password } });
  expect(res.status()).toBe(200);
  return ctx;
}

test.describe('Настройки аккаунта (docs/PROFILE_TZ.md, REQ-PRF-06…09)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-PRF-07 password: strength, mismatch, wrong current; after the change another device is signed out, this one is not', async ({
    page,
    context,
    baseURL,
  }) => {
    const email = `set.${uid()}@example.kz`;
    const teacher = await account(baseURL!, '/api/auth/register', {
      role: 'teacher',
      email,
      displayName: 'Алия Сапарова',
      password: 'teacher-pass-1',
    });
    const other = await otherDevice(baseURL!, email, 'teacher-pass-1');
    await signIn(context, teacher, baseURL!);
    await page.goto('/ru/account/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(s.title);

    const form = page.getByTestId('password-form');
    await form.getByLabel(s.currentPassword).fill('wrong-pass');
    await form.getByLabel(new RegExp(`^${s.password.new}`)).fill('abcdefgh');
    await expect(page.getByTestId('password-strength')).toContainText(s.password.strength['1']);
    await form.getByLabel(new RegExp(`^${s.password.new}`)).fill('Новый-пароль-2026');
    await expect(page.getByTestId('password-strength')).toContainText(s.password.strength['3']);
    await form.getByLabel(s.password.repeat).fill('другой');
    await form.getByRole('button', { name: s.password.change }).click();
    await expect(form.getByText(s.password.mismatch)).toBeVisible();

    await form.getByLabel(s.password.repeat).fill('Новый-пароль-2026');
    await form.getByRole('button', { name: s.password.change }).click();
    await expect(form.getByText(ru.validation.invalidPassword)).toBeVisible();

    await form.getByLabel(s.currentPassword).fill('teacher-pass-1');
    await form.getByRole('button', { name: s.password.change }).click();
    await expect(page.getByTestId('password-feedback')).toHaveText(s.password.changed);
    expect((await other.get('/api/me')).status()).toBe(401);
    expect((await page.request.get('/api/me')).status()).toBe(200);
  });

  test('AC-PRF-08 «Выйти на всех других устройствах»; last sign-in is shown', async ({
    page,
    context,
    baseURL,
  }) => {
    const login = `set.${uid()}`;
    const student = await account(baseURL!, '/api/auth/register-student', {
      displayName: 'Асель Нурова',
      login,
      password: 'student-pass-1',
    });
    const other = await otherDevice(baseURL!, login, 'student-pass-1');
    await signIn(context, student, baseURL!);
    await page.goto('/ru/account/settings');
    await expect(page.getByTestId('settings-last-login')).toContainText(
      s.devices.lastLogin.split('{')[0]!.trim(),
    );
    await page.getByRole('button', { name: s.devices.revoke }).click();
    await expect(page.getByTestId('devices-feedback')).toHaveText(s.devices.revoked);
    expect((await other.get('/api/me')).status()).toBe(401);
    expect((await page.request.get('/api/me')).status()).toBe(200);
  });

  test('AC-PRF-06 a student without email adds one: the link goes to the new address, the old state stays; remove is confirmed', async ({
    page,
    context,
    baseURL,
  }) => {
    const student = await account(baseURL!, '/api/auth/register-student', {
      displayName: 'Асель Нурова',
      login: `set.${uid()}`,
      password: 'student-pass-1',
      email: `kid.${uid()}@example.kz`,
    });
    await signIn(context, student, baseURL!);
    await page.goto('/ru/account/settings');
    const section = page.getByTestId('settings-email');
    const before = await page.getByTestId('settings-email-current').textContent();

    await section.getByRole('button', { name: s.email.change }).click();
    const next = `next.${uid()}@example.kz`;
    await section.getByLabel(s.email.newEmail).fill(next);
    await section.getByLabel(s.currentPassword).fill('student-pass-1');
    await section.getByRole('button', { name: s.email.submit }).click();
    await expect(page.getByTestId('email-feedback')).toContainText(next);
    await expect(page.getByTestId('settings-email-current')).toHaveText(before!);

    // Удаление email (ученик с логином) — с подтверждением паролем.
    await section.getByRole('button', { name: s.email.remove }).click();
    const dialog = page.getByRole('dialog', { name: s.email.removeTitle });
    await expect(dialog).toContainText(s.email.removeText);
    await dialog.getByLabel(s.currentPassword).fill('student-pass-1');
    await dialog.getByRole('button', { name: s.email.removeConfirm }).click();
    await expect(page.getByTestId('settings-email-current')).toHaveText(s.email.none);
    await expect(section.getByRole('button', { name: s.email.add })).toBeVisible();
  });

  test('REQ-PRF-09 preferences are the header ones: theme and data saver change the page at once; a11y, no horizontal scroll', async ({
    page,
    context,
    baseURL,
  }) => {
    const student = await account(baseURL!, '/api/auth/register-student', {
      displayName: 'Асель Нурова',
      login: `set.${uid()}`,
      password: 'student-pass-1',
    });
    await signIn(context, student, baseURL!);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/ru/account/settings');
    const prefs = page.getByTestId('settings-prefs');
    await prefs.getByRole('radio', { name: s.prefs.themeLight }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await prefs.getByRole('radio', { name: s.prefs.on }).click();
    await expect(page.locator('html')).toHaveAttribute('data-data-saver', 'true');
    if (!isPhone(page)) {
      await expect(page.getByTestId('data-saver-toggle').first()).toHaveAttribute('aria-pressed', 'true');
    }
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
    // Выбор сохранён в аккаунте (API-ME-02).
    const me = await (await page.request.get('/api/me')).json();
    expect(me.preferences).toMatchObject({ theme: 'light', dataSaver: true });
    await prefs.getByRole('radio', { name: s.prefs.themeDark }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('Модерация картинки-аватара (BR-PRF-06, API-SUP-09)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-PRF-05 support resets a teacher picture from the ticket card (with confirmation)', async ({
    page,
    baseURL,
  }) => {
    const email = `photo.${uid()}@example.kz`;
    const teacher = await account(baseURL!, '/api/auth/register', {
      role: 'teacher',
      email,
      displayName: 'Алия Сапарова',
      password: 'teacher-pass-1',
    });
    const me = await (await teacher.get('/api/me')).json();
    await givePhotoAvatar(me.id);
    const csrf = (await teacher.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
    const ticket = await (
      await teacher.post('/api/me/data-requests', {
        data: { type: 'export' },
        headers: { 'X-CSRF-Token': csrf },
      })
    ).json();
    expect((await (await teacher.get('/api/me/profile')).json()).avatar.kind).toBe('photo');

    await page.goto('/ru/auth/login?role=staff');
    await page.getByRole('textbox', { name: ru.auth.login.email }).fill('support@syntara.local');
    await page
      .getByLabel(ru.auth.login.password)
      .fill(process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password');
    await page.getByRole('button', { name: ru.auth.login.submit }).click();
    await expect(page).toHaveURL(/\/ru\/staff\/tickets$/);
    await page.getByLabel(ru.staff.filters.search).fill(ticket.publicNumber);
    await page.getByRole('link', { name: ticket.publicNumber }).click();

    const reset = page.getByTestId('ticket-reset-avatar');
    await expect(reset).toHaveText(ru.staff.ticketActions.resetAvatar);
    let asked = '';
    page.once('dialog', (dialog) => {
      asked = dialog.message();
      void dialog.accept();
    });
    await reset.click();
    await expect(reset).toBeHidden();
    expect(asked).toBe(ru.staff.ticketActions.resetAvatarConfirm);
    expect((await (await teacher.get('/api/me')).json()).avatar).toMatchObject({
      kind: 'initials',
      photoUrl: null,
    });
  });
});
