import { expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';

export const bundles = { ru, kk, en } as const;

/** 10 публичных страниц раздела 8.1 и пункт меню, который должен быть активным (AC-GEN-01). */
export const PUBLIC_PAGES = [
  { path: '/', nav: 'home', h1: ru.home.hero.line1 },
  { path: '/subjects', nav: 'subjects', h1: ru.subjects.title },
  { path: '/about', nav: 'about', h1: ru.about.hero.title },
  { path: '/ai', nav: 'ai', h1: ru.ai.title },
  { path: '/schools', nav: 'schools', h1: ru.schools.hero.title },
  { path: '/schools/request', nav: 'schools', h1: ru.schoolRequest.title },
  { path: '/support', nav: 'help', h1: ru.support.title },
  { path: '/terms', nav: null, h1: ru.legal.terms },
  { path: '/privacy', nav: null, h1: ru.legal.privacy },
  { path: '/cookies', nav: null, h1: ru.legal.cookies },
] as const;

/** Решение по cookie уже принято — баннер не мешает сценариям, где он не проверяется. */
export async function acceptCookies(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: 'consent', value: 'necessary', url: baseURL! }]);
}

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

/**
 * Смена языка интерфейса из хедера: ≥ 1024 px — выпадающий список, < 1024 px — сегменты RU/KK/EN
 * в мобильном меню (UX-10; меню остаётся открытым — закрываем Escape).
 */
export async function switchLocale(page: Page, code: 'ru' | 'kk' | 'en') {
  if (isMobile(page)) {
    await page.getByRole('button', { name: ru.shell.menu }).click();
    const dialog = page.getByRole('dialog', { name: ru.shell.menu });
    await dialog.getByRole('radio', { name: code.toUpperCase() }).click();
    await expect(page).toHaveURL(new RegExp(`/${code}(/|\\?|#|$)`));
    await page.keyboard.press('Escape');
    return;
  }
  await page
    .getByTestId('public-header')
    .getByRole('button', { name: new RegExp(ru.shell.language) })
    .click();
  await page.getByRole('menuitem', { name: new RegExp(code.toUpperCase()) }).click();
}

/** DoD 5 / REQ-NFR-A11Y-01: axe без нарушений уровня serious и critical. */
export async function expectNoSeriousA11yViolations(page: Page) {
  // После клиентского перехода Next.js заново выставляет <title> (метаданные корневого layout) — ждём его.
  await page.waitForFunction(() => document.title !== '');
  // Переходы 150–200 мс (hover, смена вкладки): axe не должен мерить контраст промежуточного цвета.
  // Бесконечные анимации (скелетоны) не ждём.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

export async function hasHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}
