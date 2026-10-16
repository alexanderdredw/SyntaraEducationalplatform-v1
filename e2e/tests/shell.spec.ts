import { expect, test } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isMobile,
  PUBLIC_PAGES,
} from './support';

const ru = bundles.ru;

test.describe('Оболочка и навигация', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-GEN-PREF-01 root redirects to /ru by default, ignoring Accept-Language', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.goto(`${baseURL}/`);
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
    test(`REQ-NFR-I18N-01 /${locale} renders texts from ${locale}.json`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByTestId('hero-accent-line')).toHaveText(bundles[locale].home.hero.line3);
      await expect(page.getByText(bundles[locale].footer.copyright)).toBeVisible();
    });
  }

  for (const p of PUBLIC_PAGES) {
    test(`AC-GEN-01 direct URL ${p.path} equals navigation; active menu item matches`, async ({ page }) => {
      await page.goto(`/ru${p.path}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(p.h1);
      if (p.nav && !isMobile(page)) {
        const nav = page.getByRole('navigation', { name: ru.shell.navLabel });
        await expect(nav.locator('[aria-current="page"]')).toHaveText(ru.shell.nav[p.nav]);
      }
    });
  }

  test('AC-GEN-01 navigating through the menu opens the same page as a direct URL', async ({ page }) => {
    await page.goto('/ru');
    for (const p of PUBLIC_PAGES.filter((x) => x.nav && x.path !== '/schools/request')) {
      if (isMobile(page)) await page.getByRole('button', { name: ru.shell.menu }).click();
      await page
        .getByRole('navigation', { name: ru.shell.navLabel })
        .getByRole('link', { name: ru.shell.nav[p.nav!] })
        .click();
      await expect(page).toHaveURL(new RegExp(`/ru${p.path === '/' ? '$' : p.path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(p.h1);
    }
  });

  test('AC-GEN-03 no horizontal scroll on every public page', async ({ page }) => {
    for (const p of PUBLIC_PAGES) {
      await page.goto(`/ru${p.path}`);
      expect(await hasHorizontalScroll(page), p.path).toBe(false);
    }
  });

  test('AC-GEN-03, REQ-GEN-SHELL-06 mobile menu: opens, closes on Escape, focus returns to «Меню»', async ({
    page,
  }) => {
    test.skip(!isMobile(page), 'мобильное меню — ширина < 1024 px');
    await page.goto('/ru/about');
    const menuButton = page.getByRole('button', { name: ru.shell.menu });
    await menuButton.click();
    const dialog = page.getByRole('dialog', { name: ru.shell.menu });
    await expect(dialog).toBeVisible();
    for (const key of ['home', 'subjects', 'about', 'ai', 'schools', 'help'] as const) {
      await expect(dialog.getByRole('link', { name: ru.shell.nav[key] })).toBeVisible();
    }
    await expect(dialog.getByTestId('theme-toggle')).toBeVisible();
    await expect(dialog.getByTestId('data-saver-toggle')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(menuButton).toBeFocused();
    // Закрытие переходом.
    await menuButton.click();
    await dialog.getByRole('link', { name: ru.shell.nav.schools }).click();
    await expect(page).toHaveURL(/\/ru\/schools$/);
    await expect(dialog).toBeHidden();
  });

  test('REQ-GEN-SHELL-07 tap targets in the header are at least 44×44 px', async ({ page }) => {
    await page.goto('/ru');
    const header = page.getByTestId('public-header');
    for (const el of await header.locator('a:visible, button:visible').all()) {
      const box = await el.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('REQ-GEN-SHELL-07 skip link is the first focusable element and moves focus to content', async ({
    page,
  }) => {
    await page.goto('/ru');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: ru.common.skipToContent });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('REQ-GEN-SHELL-01 header is sticky and anchors respect its height', async ({ page }) => {
    await page.goto('/ru/about#teacher');
    const header = await page.getByTestId('public-header').boundingBox();
    const target = await page.locator('#teacher').boundingBox();
    expect(header!.y).toBe(0);
    expect(target!.y).toBeGreaterThanOrEqual(header!.height - 1);
  });

  test('REQ-GEN-SHELL-04 floating «?» shows page help; the blue button opens /ai', async ({ page }) => {
    await page.goto('/ru/schools');
    await page.getByRole('button', { name: ru.help.open }).click();
    await expect(page.getByText(ru.help.pages.schools)).toBeVisible();
    await expect(page.getByRole('link', { name: ru.help.supportLink })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: ru.help.assistant }).click();
    await expect(page).toHaveURL(/\/ru\/ai$/);
  });

  test('REQ-GEN-SHELL-05 footer: brand, columns, support email (PH-09), legal links and copyright', async ({
    page,
  }) => {
    await page.goto('/ru');
    const footer = page.getByTestId('site-footer');
    await expect(footer.getByText(ru.footer.tagline)).toBeVisible();
    await expect(footer.getByRole('link', { name: 'support@syntara-edu.me' })).toBeVisible();
    await expect(footer.getByText(ru.footer.languages)).toBeVisible();
    for (const label of [ru.footer.product, ru.footer.schools, ru.footer.legal]) {
      await expect(footer.getByRole('heading', { name: label })).toBeVisible();
    }
    for (const link of [
      ru.footer.requestSchool,
      ru.footer.joinClass,
      ru.legal.terms,
      ru.legal.privacy,
      ru.legal.cookies,
    ]) {
      await expect(footer.getByRole('link', { name: link })).toBeVisible();
    }
    await expect(footer.getByText(ru.footer.copyright)).toBeVisible();
  });

  test('раздел 4: closed cabinet pages send a guest to the login page with returnTo', async ({ page }) => {
    // Страницы PH-24 кабинетов проверяются в accounts.spec.ts после входа.
    // Каталог и уроки базовой программы гость открывает без входа (BR-VIS-04) — здесь «Мои показатели».
    for (const path of ['/teacher/courses', '/learn/progress', '/account/privacy']) {
      await page.goto(`/ru${path}`);
      await expect(page).toHaveURL(new RegExp(`/ru/auth/login\\?returnTo=${encodeURIComponent(path)}$`));
    }
  });

  for (const theme of ['dark', 'light'] as const) {
    for (const p of PUBLIC_PAGES) {
      test(`REQ-NFR-A11Y-01 axe: ${p.path} in ${theme} theme`, async ({ page, baseURL }) => {
        await page.context().addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
        await page.goto(`/ru${p.path}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectNoSeriousA11yViolations(page);
      });
    }
  }

  test('REQ-NFR-SEC-01 security headers on web pages', async ({ request }) => {
    const headers = (await request.get('/ru')).headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
