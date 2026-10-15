import { test, expect, type Page } from '@playwright/test';
import { acceptCookies, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

/** Основа дизайна: токены 3.1 в одном месте, единые состояния, плавность и фон страниц входа. */

const AUTH_PAGES = ['/ru/auth/login', '/ru/auth/start', '/ru/auth/start?role=student', '/ru/join'];

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.beforeEach(async ({ context, baseURL }) => {
  await acceptCookies(context, baseURL);
});

test('REQ-GEN-DS-01 tokens: colors, radii, spacing, text sizes, shadows and motion come from tokens.css', async ({
  context,
  page,
  baseURL,
}) => {
  await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
  await page.goto('/ru/auth/start?role=student');
  expect(await cssVar(page, '--bg')).toBe('#070707');
  expect(await cssVar(page, '--radius-card')).toBe('20px');
  expect(await cssVar(page, '--radius-field')).toBe('12px');
  expect(await cssVar(page, '--space-4')).toBe('24px');
  expect(await cssVar(page, '--text-cabinet-title')).toBe('1.75rem');
  // Минификатор CSS может записать 150ms как .15s — сравниваем в миллисекундах.
  const fast = await cssVar(page, '--duration-fast');
  expect(parseFloat(fast) * (fast.endsWith('ms') ? 1 : 1000)).toBe(150);
  expect(await cssVar(page, '--shadow-card')).not.toBe('');

  // Поля и карточка формы ученика используют токены: высота 48 px, радиусы поля и карточки.
  const name = page.locator('#student-displayName');
  const field = await name.evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: s.borderTopLeftRadius, height: el.getBoundingClientRect().height };
  });
  expect(field.radius).toBe('12px');
  expect(field.height).toBeGreaterThanOrEqual(48);
});

test('REQ-GEN-DS-01 field states: hover lightens the border, error shows --danger', async ({ page }) => {
  await page.goto('/ru/auth/start?role=student');
  const name = page.locator('#student-displayName');
  const border = () => name.evaluate((el) => getComputedStyle(el).borderTopColor);
  const idle = await border();
  await name.hover();
  await expect.poll(border).not.toBe(idle);

  // Пустая отправка — поле в состоянии ошибки.
  await page.locator('#student-panel-register button[type="submit"]').click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await page.mouse.move(0, 0);
  await expect.poll(border).toBe('rgb(229, 72, 77)');
});

test('REQ-GEN-PREF-04 interactive elements animate for 150 ms; reduced motion and data saver turn it off', async ({
  browser,
  baseURL,
}) => {
  const duration = async (reducedMotion: 'reduce' | 'no-preference', dataSaver: boolean) => {
    const context = await browser.newContext({ baseURL, reducedMotion });
    await context.addCookies([{ name: 'consent', value: 'necessary', url: baseURL! }]);
    const page = await context.newPage();
    await page.goto('/ru/auth/start?role=student');
    if (dataSaver)
      await page.evaluate(() => document.documentElement.setAttribute('data-data-saver', 'true'));
    const value = await page
      .locator('#student-displayName')
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) * 1000);
    await context.close();
    return value;
  };
  expect(await duration('no-preference', false)).toBe(150);
  expect(await duration('reduce', false)).toBeLessThan(1);
  expect(await duration('no-preference', true)).toBe(0);
});

for (const path of AUTH_PAGES) {
  test(`REQ-GEN-DS-01 ${path}: decorative line background, hidden from AT and in data saver`, async ({
    page,
  }) => {
    await page.goto(path);
    const backdrop = page.getByTestId('auth-backdrop');
    await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    await expect(backdrop).toHaveCSS('pointer-events', 'none');
    const mask = await backdrop.evaluate((el) => getComputedStyle(el, '::after').maskImage);
    expect(mask).toContain('svg');
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);

    await page.evaluate(() => document.documentElement.setAttribute('data-data-saver', 'true'));
    await expect(backdrop).toBeHidden();
  });
}

test('REQ-GEN-DS-01 no line background outside sign-in, registration and /join', async ({ page }) => {
  await page.goto('/ru/support');
  await expect(page.getByTestId('auth-backdrop')).toHaveCount(0);
});

test('REQ-GEN-DS-01 light theme: tokens switch and the form stays accessible', async ({
  context,
  page,
  baseURL,
}) => {
  await context.addCookies([{ name: 'theme', value: 'light', url: baseURL! }]);
  await page.goto('/ru/auth/start?role=student');
  expect(await cssVar(page, '--bg')).toBe('#fafafc');
  expect(await cssVar(page, '--border-strong')).toBe('#c9cbd1');
  await expectNoSeriousA11yViolations(page);
});
