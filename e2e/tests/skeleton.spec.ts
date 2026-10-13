import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';

const bundles = { ru, kk, en } as const;

test.describe('Каркас web (итерация 1)', () => {
  test('REQ-GEN-PREF-01 root redirects to /ru by default, ignoring Accept-Language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/ru$/);
    await context.close();
  });

  test('REQ-GEN-PREF-01 root redirects to the locale saved in the `locale` cookie', async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([{ name: 'locale', value: 'kk', url: baseURL! }]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/kk$/);
  });

  for (const locale of ['ru', 'kk', 'en'] as const) {
    test(`REQ-GEN-PREF-01 /${locale} renders texts from ${locale}.json`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(bundles[locale].common.appName);
      await expect(page.getByText(bundles[locale].common.sectionInDevelopment)).toBeVisible();
    });
  }

  test('REQ-GEN-SHELL-07 skip link is the first focusable element', async ({ page }) => {
    await page.goto('/ru');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: ru.common.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('REQ-GEN-SHELL-07 no horizontal scroll', async ({ page }) => {
    await page.goto('/ru');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test('REQ-NFR-A11Y-01 axe: no serious or critical violations', async ({ page }) => {
    await page.goto('/ru');
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test('REQ-NFR-SEC-01 baseline security headers on web', async ({ request }) => {
    const res = await request.get('/ru');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });
});
