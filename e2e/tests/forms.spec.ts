import { expect, test, type Page, type Request } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, isMobile, switchLocale } from './support';

const ru = bundles.ru;
const sr = ru.schoolRequest;
const sp = ru.support;

const SCHOOL_ENDPOINT = '**/api/public/school-requests';

async function fillSchoolRequest(page: Page, email = 'school@example.kz') {
  await page.getByLabel(sr.fields.schoolName).fill('Школа-гимназия №1');
  await page.getByLabel(sr.fields.contactPerson).fill('Директор');
  await page.getByRole('textbox', { name: sr.fields.email, exact: true }).fill(email);
}

async function fillSupport(page: Page, email = 'parent@example.kz') {
  await page.getByLabel(sp.fields.subject).fill('Не открывается урок');
  await page.getByLabel(sp.fields.email).fill(email);
  await page.getByLabel(sp.fields.description).fill('После входа белый экран');
}

test.describe('Формы (SM-FORM)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-PUB-REQ-01, REQ-PUB-REQ-02 school request: fields in order with placeholders, consent, buttons', async ({
    page,
  }) => {
    await page.goto('/ru/schools/request');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(sr.title);
    const form = page.getByTestId('school-request-form');
    const labels = await form.locator('label').allTextContents();
    expect(labels.map((l) => l.replace(' *', ''))).toEqual([
      sr.fields.schoolName,
      sr.fields.region,
      sr.fields.city,
      sr.fields.contactPerson,
      sr.fields.phone,
      sr.fields.email,
      sr.fields.message,
    ]);
    for (const name of Object.keys(sr.placeholders) as Array<keyof typeof sr.placeholders>) {
      await expect(form.getByPlaceholder(sr.placeholders[name])).toBeVisible();
    }
    for (const required of [sr.fields.schoolName, sr.fields.contactPerson, sr.fields.email]) {
      await expect(form.getByRole('textbox', { name: required, exact: true })).toHaveAttribute(
        'aria-required',
        'true',
      );
    }
    await expect(form.getByText(ru.forms.consent)).toBeVisible();
    await expect(form.getByRole('link', { name: ru.common.backHome })).toHaveAttribute('href', '/ru');
    await expect(form.getByRole('button', { name: sr.submit })).toHaveAttribute(
      'data-variant',
      // UX-02: главная кнопка публичных страниц — синяя.
      'primary-blue',
    );
    if (!isMobile(page)) {
      // Регион и город, контактное лицо и телефон — в одной строке.
      const y = async (label: string) =>
        (await form.getByRole('textbox', { name: label, exact: true }).boundingBox())!.y;
      expect(await y(sr.fields.region)).toBe(await y(sr.fields.city));
      expect(await y(sr.fields.contactPerson)).toBe(await y(sr.fields.phone));
    }
  });

  test('AC-FRM-01 empty required fields: field errors, summary on top, focus on the first, no request sent', async ({
    page,
  }) => {
    const sent: Request[] = [];
    page.on('request', (r) => r.url().includes('/api/public/school-requests') && sent.push(r));
    await page.goto('/ru/schools/request');
    await page.getByRole('button', { name: sr.submit }).click();

    const summary = page.getByTestId('form-error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(ru.forms.summaryTitle);
    for (const label of [sr.fields.schoolName, sr.fields.contactPerson, sr.fields.email]) {
      await expect(summary.getByRole('link', { name: label })).toBeVisible();
      await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    }
    await expect(page.getByText(ru.validation.required).first()).toBeVisible();
    await expect(page.getByLabel(sr.fields.schoolName)).toBeFocused();
    const summaryBox = (await summary.boundingBox())!;
    const firstField = (await page.getByLabel(sr.fields.schoolName).boundingBox())!;
    expect(summaryBox.y).toBeLessThan(firstField.y);
    expect(sent).toHaveLength(0);
  });

  test('SM-FORM validates on blur only fields the user changed; valid fields are kept', async ({ page }) => {
    await page.goto('/ru/schools/request');
    // Проход Tab по пустому полю — без ошибок.
    await page.getByLabel(sr.fields.schoolName).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(sr.fields.schoolName)).not.toHaveAttribute('aria-invalid', 'true');

    const email = page.getByRole('textbox', { name: sr.fields.email, exact: true });
    await email.fill('not-an-email');
    await email.blur();
    await expect(page.getByText(ru.validation.email)).toBeVisible();
    await page.getByLabel(sr.fields.city).fill('Алматы');
    await email.fill('ok@example.kz');
    await email.blur();
    await expect(page.getByText(ru.validation.email)).toBeHidden();
    await expect(page.getByLabel(sr.fields.city)).toHaveValue('Алматы');
  });

  test('AC-FRM-02 valid request: «Отправляем...», then «Заявка получена», SR number and email; form cleared', async ({
    page,
  }) => {
    await page.goto('/ru/schools/request');
    await fillSchoolRequest(page, 'e2e-school@example.kz');
    // Задержка ответа, чтобы увидеть состояние submitting.
    await page.route(SCHOOL_ENDPOINT, async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.getByRole('button', { name: sr.submit }).click();
    const submitting = page.getByRole('button', { name: ru.forms.submitting });
    await expect(submitting).toBeVisible();
    await expect(submitting).toBeDisabled();

    const success = page.getByTestId('form-success');
    await expect(success).toBeVisible();
    await expect(success).toContainText(sr.success);
    await expect(page.getByTestId('form-success-number')).toHaveText(/SR-\d{6}-\d{4}/);
    await expect(page.getByTestId('form-success-email')).toContainText('e2e-school@example.kz');
    await expect(page.getByLabel(sr.fields.schoolName)).toHaveValue('');
    await expect(page.getByRole('textbox', { name: sr.fields.email, exact: true })).toHaveValue('');
  });

  test('AC-FRM-04 no network: message shown, input kept, retry reuses the Idempotency-Key; edit → new key', async ({
    page,
  }) => {
    await page.goto('/ru/schools/request');
    await fillSchoolRequest(page);
    const keys: string[] = [];
    await page.route(SCHOOL_ENDPOINT, async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      await route.abort('internetdisconnected');
    });

    await page.getByRole('button', { name: sr.submit }).click();
    await expect(page.getByTestId('form-submit-error')).toHaveText(ru.forms.networkError);
    await expect(page.getByLabel(sr.fields.schoolName)).toHaveValue('Школа-гимназия №1');
    await expect(page.getByRole('textbox', { name: sr.fields.email, exact: true })).toHaveValue(
      'school@example.kz',
    );

    await page.getByRole('button', { name: sr.submit }).click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);

    await page.getByLabel(sr.fields.city).fill('Алматы');
    await page.getByRole('button', { name: sr.submit }).click();
    await expect.poll(() => keys.length).toBe(3);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('SM-FORM server error: «Не удалось подтвердить отправку…», key kept for the retry', async ({
    page,
  }) => {
    await page.goto('/ru/schools/request');
    await fillSchoolRequest(page);
    const keys: string[] = [];
    await page.route(SCHOOL_ENDPOINT, async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"code":"INTERNAL_ERROR"}',
      });
    });
    await page.getByRole('button', { name: sr.submit }).click();
    await expect(page.getByTestId('form-submit-error')).toHaveText(ru.forms.serverError);
    await page.getByRole('button', { name: sr.submit }).click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);
  });

  test('SM-FORM leaving a filled, unsent form triggers the beforeunload warning; no localStorage draft', async ({
    page,
  }) => {
    await page.goto('/ru/schools/request');
    await page.getByLabel(sr.fields.schoolName).fill('Черновик');
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain('Черновик');
    const dialog = new Promise<string>((resolve) =>
      page.once('dialog', async (d) => {
        resolve(d.type());
        await d.dismiss();
      }),
    );
    await page.close({ runBeforeUnload: true });
    expect(await dialog).toBe('beforeunload');
  });

  test('AC-GEN-02 a half-filled form survives a language switch', async ({ page }) => {
    await page.goto('/ru/schools/request');
    await page.getByLabel(sr.fields.schoolName).fill('Школа №5');
    await switchLocale(page, 'kk');
    await expect(page).toHaveURL(/\/kk\/schools\/request$/);
    await expect(page.getByLabel(bundles.kk.schoolRequest.fields.schoolName)).toHaveValue('Школа №5');
  });

  test('REQ-PUB-SUP-01, REQ-PUB-SUP-02 support form: rows, default category, optional fields, caption', async ({
    page,
  }) => {
    await page.goto('/ru/support');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(sp.title);
    await expect(page.getByText(sp.subtitle)).toBeVisible();
    const form = page.getByTestId('support-form');
    const labels = (await form.locator('label').allTextContents()).map((l) => l.replace(' *', ''));
    expect(labels).toEqual([
      sp.fields.category,
      sp.fields.subject,
      sp.fields.name,
      sp.fields.email,
      sp.fields.phone,
      sp.fields.description,
    ]);
    await expect(form.getByLabel(sp.fields.category)).toHaveText(sp.categories.technical);
    await expect(page.getByTestId('support-tech-note')).toHaveText(sp.techContextNote);
    await expect(form.getByRole('button', { name: sp.submit })).toBeVisible();
    // «← На главную» — ниже карточки формы.
    const back = page.getByRole('link', { name: ru.common.backHome });
    expect((await back.boundingBox())!.y).toBeGreaterThan(
      (await form.boundingBox())!.y + (await form.boundingBox())!.height,
    );

    await form.getByLabel(sp.fields.category).click();
    const options = await page.getByRole('option').allTextContents();
    expect(options).toEqual([
      sp.categories.technical,
      sp.categories.school_onboarding,
      sp.categories.learning,
      sp.categories.account_access,
      sp.categories.data_privacy,
      sp.categories.other,
    ]);
    await page.keyboard.press('Escape');
  });

  test('REQ-PUB-SCH-01 /support?category=school_onboarding preselects «Подключение школы»', async ({
    page,
  }) => {
    await page.goto('/ru/support?category=school_onboarding');
    await expect(page.getByTestId('support-form').getByLabel(sp.fields.category)).toHaveText(
      sp.categories.school_onboarding,
    );
  });

  test('API-PUB-05, REQ-PUB-SUP-03 ticket is sent with techContext only (no secrets) → «Обращение получено», T-number', async ({
    page,
  }) => {
    await page.goto('/ru/support');
    await fillSupport(page, 'e2e-support@example.kz');
    const request = page.waitForRequest(
      (r) => r.url().includes('/api/public/support-tickets') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: sp.submit }).click();
    const body = (await request).postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({
      category: 'technical',
      email: 'e2e-support@example.kz',
      techContext: {
        route: '/ru/support',
        appVersion: expect.any(String),
        locale: 'ru',
        dataSaver: false,
        userAgent: expect.any(String),
      },
    });
    expect(Object.keys(body.techContext as object).sort()).toEqual([
      'appVersion',
      'dataSaver',
      'locale',
      'route',
      'userAgent',
    ]);
    await expect(page.getByTestId('form-success')).toContainText(sp.success);
    await expect(page.getByTestId('form-success-number')).toHaveText(/T-\d{6}-\d{4}/);
  });

  test('REQ-NFR-A11Y-01 axe: forms with validation errors', async ({ page }) => {
    for (const [path, button] of [
      ['/ru/schools/request', sr.submit],
      ['/ru/support', sp.submit],
    ] as const) {
      await page.goto(path);
      await page.getByRole('button', { name: button }).click();
      await expect(page.getByTestId('form-error-summary')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }
  });
});
