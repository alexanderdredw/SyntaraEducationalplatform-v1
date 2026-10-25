import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { expect, request, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isPhone,
} from './support';

const ru = bundles.ru;
const p = ru.account.profile;
const uid = () => randomUUID().slice(0, 8);

async function account(baseURL: string, path: string, data: object): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}
const student = (baseURL: string, displayName = 'Асель Нурова') =>
  account(baseURL, '/api/auth/register-student', {
    displayName,
    login: `prf.${uid()}`,
    password: 'student-pass-1',
  });
const teacher = (baseURL: string) =>
  account(baseURL, '/api/auth/register', {
    role: 'teacher',
    email: `prf.${uid()}@example.kz`,
    displayName: 'Алия Сапарова',
    password: 'teacher-pass-1',
  });
async function signIn(context: BrowserContext, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

/** PNG 400×300 — картинка учителя для загрузки (BR-PRF-03). */
function png(width = 400, height = 300): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set([40 + (x % 120), 90 + (y % 100), 200], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test.describe('Редактировать профиль (docs/PROFILE_TZ.md, REQ-PRF-05)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-PRF-03 REQ-PRF-05 a student changes the name and picks an avatar from the set; the header shows it at once', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/account/profile');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.title);
    await expect(
      page
        .getByRole('navigation', { name: ru.account.tabsLabel })
        .getByRole('link', { name: ru.account.tabs.profile }),
    ).toHaveAttribute('aria-current', 'page');
    // Ученик: только набор и инициалы (решение владельца 2026-10-25); логин — только просмотр.
    await expect(page.getByRole('radio', { name: p.avatarKinds.photo })).toHaveCount(0);
    await expect(page.getByLabel(p.fields.login)).toHaveAttribute('readonly', '');
    await expect(page.getByLabel(p.fields.position, { exact: false })).toHaveCount(0);

    await page.getByLabel(p.fields.firstName).fill('Асель-Мария');
    await page.getByRole('radio', { name: p.avatarKinds.preset }).click();
    // Выбор с клавиатуры: стрелка переносит выбор к следующему аватару.
    await page.getByRole('radio', { name: p.presets.fox }).click();
    // Radix выбирает вариант, пока стрелка нажата (фокус переносится асинхронно) — как при обычном нажатии.
    await page.keyboard.down('ArrowRight');
    await expect(page.getByRole('radio', { name: p.presets.owl })).toBeFocused();
    await page.keyboard.up('ArrowRight');
    await expect(page.getByRole('radio', { name: p.presets.owl })).toHaveAttribute('data-state', 'checked');
    await page.getByRole('button', { name: p.save }).click();
    await expect(page.getByTestId('profile-status')).toHaveText(p.saved);

    const me = await (await page.request.get('/api/me')).json();
    expect(me.displayName).toBe('Асель-Мария Нурова');
    expect(me.avatar).toMatchObject({ kind: 'preset', preset: 'owl' });
    if (!isPhone(page)) {
      await expect(page.getByTestId('cabinet-header')).toContainText('Асель-Мария Нурова');
    }
    await page.reload();
    await expect(page.getByLabel(p.fields.firstName)).toHaveValue('Асель-Мария');
  });

  test('BR-PRF-01 invalid characters are shown at the field; nothing is saved', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/account/profile');
    await page.getByLabel(p.fields.firstName).fill('Асель2');
    await page.getByRole('button', { name: p.save }).click();
    await expect(page.getByText(ru.validation.nameChars)).toBeVisible();
    expect((await (await page.request.get('/api/me')).json()).displayName).toBe('Асель Нурова');
  });

  test('REQ-PRF-05 leaving with unsaved changes asks for confirmation', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await student(baseURL!), baseURL!);
    await page.goto('/ru/account/profile');
    await page.getByLabel(p.fields.firstName).fill('Другое');
    let asked = '';
    page.once('dialog', (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole('link', { name: ru.account.tabs.privacy }).click();
    expect(asked).toBe(p.unsaved);
    await expect(page).toHaveURL(/\/account\/profile$/);
  });

  test('AC-PRF-04 BR-PRF-03 a teacher uploads a picture: crop, «checking» with initials, then the picture; position and about are saved', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await signIn(context, await teacher(baseURL!), baseURL!);
    await page.goto('/ru/account/profile');
    await page.getByLabel(new RegExp(`^${p.fields.position}`)).fill('Учитель биологии');
    await page.getByLabel(new RegExp(`^${p.fields.about}`)).fill('Веду уроки биологии');

    await page.getByRole('radio', { name: p.avatarKinds.photo }).click();
    await page
      .getByTestId('avatar-file')
      .setInputFiles({ name: 'я.png', mimeType: 'image/png', buffer: png() });
    const crop = page.getByTestId('avatar-crop');
    await expect(crop).toBeVisible();
    await crop.focus();
    await page.keyboard.press('ArrowLeft');
    await page.getByTestId('avatar-crop-apply').click();
    await expect(crop).toBeHidden();
    await page.getByRole('button', { name: p.save }).click();
    await expect(page.getByTestId('profile-status')).toHaveText(p.saved);

    const profile = await (await page.request.get('/api/me/profile')).json();
    expect(profile).toMatchObject({ position: 'Учитель биологии', about: 'Веду уроки биологии' });
    expect(profile.avatar.kind).toBe('photo');
    if (profile.avatar.photoStatus === 'pending') await expect(page.getByText(p.checking)).toBeVisible();
    // Worker проверяет и перекодирует картинку; после этого — картинка по подписанной ссылке.
    await expect
      .poll(async () => (await (await page.request.get('/api/me/profile')).json()).avatar.photoStatus, {
        timeout: 120_000,
      })
      .toBe('clean');
    await page.reload();
    const avatarImg = page.getByTestId('profile-form').locator('img[alt="Алия Сапарова"]');
    await expect(avatarImg).toBeVisible();
    await expect(avatarImg).toHaveAttribute('src', /X-Amz-Signature/);
  });

  test('AC-PRF-11 keyboard and axe on the profile page; no horizontal scroll; both themes', async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, await teacher(baseURL!), baseURL!);
    // Проверка контраста — без переходов цвета (150 мс) после нажатия.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const theme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/ru/account/profile');
      await expect(page.getByTestId('profile-form')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await page.getByRole('radio', { name: p.avatarKinds.preset }).click();
    await expectNoSeriousA11yViolations(page);
  });
});
