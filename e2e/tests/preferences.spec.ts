import { expect, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, isMobile, switchLocale } from './support';

const ru = bundles.ru;

/** Открывает элементы управления языком/темой/трафиком (на мобильных — внутри меню). */
async function controls(page: Page) {
  if (isMobile(page)) {
    await page.getByRole('button', { name: ru.shell.menu }).click();
    return page.getByRole('dialog', { name: ru.shell.menu });
  }
  return page.getByTestId('public-header');
}

test.describe('Язык, тема, трафик, cookie', () => {
  test('AC-PUB-03, REQ-PUB-LEGAL-02 «Только необходимые»: no optional cookies, site works, banner gone after reload', async ({
    page,
  }) => {
    await page.goto('/ru');
    const banner = page.getByTestId('cookie-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByText(ru.cookieBanner.text)).toBeVisible();
    await banner.getByRole('button', { name: ru.cookieBanner.necessary }).click();
    await expect(banner).toBeHidden();

    const cookies = await page.context().cookies();
    const consent = cookies.find((c) => c.name === 'consent');
    expect(consent?.value).toBe('necessary');
    // 12 месяцев (± сутки).
    expect(consent!.expires * 1000 - Date.now()).toBeGreaterThan(364 * 24 * 3600 * 1000);
    // Только необходимые cookie: язык и решение по cookie.
    expect(cookies.every((c) => ['consent', 'locale'].includes(c.name))).toBe(true);

    await page.reload();
    await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
    await page.getByRole('link', { name: ru.home.hero.cta }).click();
    await expect(page).toHaveURL(/\/ru\/subjects$/);
  });

  test('REQ-PUB-LEGAL-02 «Принять все» stores consent=all', async ({ page }) => {
    await page.goto('/ru/about');
    await page.getByTestId('cookie-banner').getByRole('button', { name: ru.cookieBanner.acceptAll }).click();
    const consent = (await page.context().cookies()).find((c) => c.name === 'consent');
    expect(consent?.value).toBe('all');
  });

  test('REQ-GEN-SHELL-04 floating buttons do not overlap the cookie banner', async ({ page }) => {
    await page.goto('/ru');
    const banner = (await page.getByTestId('cookie-banner').boundingBox())!;
    const help = (await page.getByRole('button', { name: ru.help.open }).boundingBox())!;
    const assistant = (await page.getByRole('link', { name: ru.help.assistant }).boundingBox())!;
    for (const b of [help, assistant]) expect(b.y + b.height).toBeLessThanOrEqual(banner.y + 1);
  });

  test.describe('с принятым решением по cookie', () => {
    test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

    test('AC-GEN-02, REQ-GEN-PREF-01 language switch: no reload, state kept, choice saved', async ({
      page,
    }) => {
      await page.goto('/ru');
      const why = page.getByTestId('home-why');
      await why.getByRole('tab').nth(2).click();
      await page.evaluate(() => {
        (window as unknown as { __noReload: boolean }).__noReload = true;
      });

      await switchLocale(page, 'kk');

      await expect(page).toHaveURL(/\/kk$/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
      await expect(page.getByTestId('hero-accent-line')).toHaveText(bundles.kk.home.hero.line3);
      expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(
        true,
      );
      await expect(page.getByTestId('home-why').getByRole('tab').nth(2)).toHaveAttribute(
        'aria-selected',
        'true',
      );

      const locale = (await page.context().cookies()).find((c) => c.name === 'locale');
      expect(locale?.value).toBe('kk');
      await page.goto('/');
      await expect(page).toHaveURL(/\/kk$/);
    });

    test('REQ-GEN-PREF-01 language switch keeps the current page, query and anchor', async ({ page }) => {
      await page.goto('/ru/about?x=1#teacher');
      await switchLocale(page, 'en');
      await expect(page).toHaveURL(/\/en\/about\?x=1#teacher$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(bundles.en.about.hero.title);
    });

    test('AC-GEN-02, REQ-GEN-PREF-03 theme toggle: no reload, state kept, choice persists after reload', async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/ru');
      await page.getByTestId('home-why').getByRole('tab').nth(3).click();
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-theme', 'dark');

      const area = await controls(page);
      await area.getByTestId('theme-toggle').click();
      await expect(html).toHaveAttribute('data-theme', 'light');
      if (isMobile(page)) await page.keyboard.press('Escape');
      await expect(page.getByTestId('home-why').getByRole('tab').nth(3)).toHaveAttribute(
        'aria-selected',
        'true',
      );

      await page.reload();
      await expect(html).toHaveAttribute('data-theme', 'light');
    });

    test('REQ-GEN-PREF-03 first visit follows prefers-color-scheme without a flash', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      // Атрибут должен стоять уже в момент разбора <body>, до отрисовки.
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          (window as unknown as { __themeAtParse: string | null }).__themeAtParse =
            document.documentElement.getAttribute('data-theme');
        });
      });
      await page.goto('/ru');
      expect(
        await page.evaluate(() => (window as unknown as { __themeAtParse: string }).__themeAtParse),
      ).toBe('light');
    });

    test('REQ-GEN-PREF-04 data saver: label switches, attribute and cookie set, decorations hidden', async ({
      page,
    }) => {
      await page.goto('/ru');
      const area = await controls(page);
      const toggle = area.locator('[data-testid="data-saver-toggle"]:visible');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      // В мобильном меню (UX-10) имя кнопки — «Экономия трафика», состояние — aria-pressed и подсказка.
      const mobile = isMobile(page);
      await expect(toggle).toHaveAccessibleName(mobile ? ru.shell.dataSaver.label : ru.shell.dataSaver.off);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      if (mobile) await expect(toggle).toHaveAttribute('title', ru.shell.dataSaver.on);
      else await expect(toggle).toHaveAccessibleName(ru.shell.dataSaver.on);
      await expect(page.locator('html')).toHaveAttribute('data-data-saver', 'true');
      if (isMobile(page)) await page.keyboard.press('Escape');
      await expect(page.locator('[data-decorative]')).toBeHidden();
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-data-saver', 'true');
    });

    test('REQ-GEN-PREF-02 all three languages are available (PH-04)', async ({ page }) => {
      await page.goto('/ru');
      const area = await controls(page);
      if (isMobile(page)) {
        // UX-10: сегменты RU / KK / EN в мобильном меню.
        for (const code of ['RU', 'KK', 'EN']) {
          await expect(area.getByRole('radio', { name: code })).toBeEnabled();
        }
        await expect(area.getByText(ru.locale.soon)).toHaveCount(0);
        return;
      }
      await area.getByRole('button', { name: new RegExp(ru.shell.language) }).click();
      for (const code of ['RU', 'KK', 'EN']) {
        const item = page.getByRole('menuitem', { name: new RegExp(code) });
        await expect(item).toBeVisible();
        await expect(item).not.toHaveAttribute('aria-disabled', 'true');
      }
      await expect(page.getByRole('menu').getByText(ru.locale.soon)).toHaveCount(0);
    });
  });
});
