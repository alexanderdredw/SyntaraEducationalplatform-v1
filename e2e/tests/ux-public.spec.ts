import { expect, test } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isMobile,
} from './support';

const ru = bundles.ru;

/** Вёрстка публичных страниц по docs/UX_TZ.md (UX-01…UX-10); логика страниц не меняется. */
test.describe('UX публичных страниц', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('UX-01 REQ-GEN-SHELL-01 header: logo, menu capsule with aria-current, data saver label and status', async ({
    page,
  }) => {
    await page.goto('/ru/about');
    const header = page.getByTestId('public-header');
    await expect(header.getByRole('link', { name: ru.shell.logoLabel })).toBeVisible();
    if (isMobile(page)) return;
    await expect(header.getByRole('link', { name: ru.shell.nav.about })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const toggle = header.locator('[data-testid="data-saver-toggle"]:visible');
    await expect(toggle).toHaveAccessibleName(ru.shell.dataSaver.off);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(ru.shell.dataSaver.on);
    await expect(toggle).toContainText(ru.shell.dataSaver.stateOn);
  });

  test('UX-02 public primary buttons are blue (accent) — «К предметам →», «Оставить заявку»', async ({
    page,
  }) => {
    for (const [path, name] of [
      ['/ru/about', ru.about.hero.toSubjects],
      ['/ru/schools', ru.schools.hero.request],
    ] as const) {
      await page.goto(path);
      const button = page.getByRole('link', { name, exact: true }).first();
      const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, path).not.toBe('rgb(255, 255, 255)');
      expect(bg, path).toMatch(/^rgb\((\d+), (\d+), (2\d\d)\)$/);
    }
  });

  test('UX-04 REQ-GEN-AUTH-02 «Войти» opens «Как продолжить?»: student, teacher, guest; no parent card', async ({
    page,
  }) => {
    await page.goto('/ru');
    const login = page.getByTestId('header-login');
    await expect(login).toHaveAttribute('href', '/ru/auth/start');
    await page.goto('/ru/auth/start');
    const choice = page.getByTestId('continue-choice');
    await expect(choice.getByRole('heading', { level: 1 })).toHaveText(ru.auth.choice.title);
    await expect(choice.getByTestId('start-student')).toHaveAttribute('href', '/ru/auth/start?role=student');
    await expect(choice.getByTestId('start-teacher')).toHaveAttribute('href', '/ru/auth/start?role=teacher');
    await expect(choice.getByTestId('choice-guest')).toHaveAttribute('href', '/ru');
    await expect(choice).not.toContainText('Родитель');
    // Порядок фокуса — сверху вниз: ученик, учитель, без аккаунта.
    const order = await choice
      .locator('a[data-testid]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['start-student', 'start-teacher', 'choice-guest']);
    // Язык меняется на том же экране.
    await choice.getByRole('radio', { name: 'EN' }).click();
    await expect(page).toHaveURL(/\/en\/auth\/start$/);
    await expect(page.getByTestId('continue-choice').getByRole('heading', { level: 1 })).toHaveText(
      bundles.en.auth.choice.title,
    );
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);
  });

  test('UX-05..UX-08 /about: roles list, quote as blockquote, initials fallback, current texts', async ({
    page,
  }) => {
    await page.goto('/ru/about');
    const hero = page.getByTestId('about-hero');
    await expect(hero.getByRole('heading', { level: 1 })).toHaveText(ru.about.hero.title);
    await expect(hero.getByRole('listitem')).toHaveCount(3);
    await expect(hero.getByText(ru.about.metrics.accessValue)).toBeVisible();
    await expect(page.getByTestId('about-mission').locator('blockquote')).toHaveText(ru.about.mission.quote);
    await expect(page.getByTestId('about-why').getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('about-origins').getByText(ru.about.origins.soon)).toHaveCount(2);
    const team = page.getByTestId('about-team');
    await expect(team.getByRole('img', { name: ru.about.team.alexandrName })).toHaveText('АЗ');
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);
  });

  test('UX-09 /schools: ordered steps, Kazakhstan data law sentence, trial request leads to the form', async ({
    page,
  }) => {
    await page.goto('/ru/schools');
    await expect(page.getByTestId('schools-connect').locator('ol > li')).toHaveCount(4);
    await expect(page.getByTestId('schools-data')).toContainText(ru.schools.data.text);
    await expect(
      page.getByTestId('schools-trial').getByRole('link', { name: ru.schools.trial.request }),
    ).toHaveAttribute('href', '/ru/schools/request');
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);
  });
  test('UX-10 REQ-GEN-SHELL-06 mobile menu: panel, active item, language, settings, closing and focus', async ({
    page,
  }) => {
    if (!isMobile(page)) {
      // ≥ 1024 px — десктопная шапка UX-01, кнопки мобильного меню нет.
      await page.goto('/ru/about');
      await expect(page.getByRole('button', { name: ru.shell.menu, exact: true })).toBeHidden();
      return;
    }
    await page.goto('/ru/about');
    const menuButton = page.getByRole('button', { name: ru.shell.menu, exact: true });
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await menuButton.click();
    const dialog = page.getByRole('dialog', { name: ru.shell.menu });
    const nav = dialog.getByRole('navigation', { name: ru.shell.navLabel });
    // Фокус — на первом пункте; текущая страница — aria-current.
    await expect(nav.getByRole('link', { name: ru.shell.nav.home })).toBeFocused();
    await expect(nav.getByRole('link', { name: ru.shell.nav.about })).toHaveAttribute('aria-current', 'page');
    for (const link of await nav.getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    for (const button of await dialog.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await expect(dialog.getByRole('button', { name: ru.shell.theme.dark })).toHaveAttribute(
      'aria-pressed',
      /true|false/,
    );
    await expect(dialog.getByRole('button', { name: ru.shell.dataSaver.label })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);

    // Переход закрывает меню, новый раздел активен.
    await nav.getByRole('link', { name: ru.shell.nav.schools }).click();
    await expect(page).toHaveURL(/\/ru\/schools$/);
    await expect(dialog).toBeHidden();
    await menuButton.click();
    await expect(nav.getByRole('link', { name: ru.shell.nav.schools })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Язык меняется сразу, меню остаётся открытым на той же странице.
    await dialog.getByRole('radio', { name: 'KK' }).click();
    await expect(page).toHaveURL(/\/kk\/schools$/);
    const kkDialog = page.getByRole('dialog', { name: bundles.kk.shell.menu });
    await expect(kkDialog.getByRole('radio', { name: 'KK' })).toHaveAttribute('aria-checked', 'true');

    // Esc закрывает, фокус возвращается на кнопку меню.
    await page.keyboard.press('Escape');
    await expect(kkDialog).toBeHidden();
    const kkMenuButton = page.getByRole('button', { name: bundles.kk.shell.menu, exact: true });
    await expect(kkMenuButton).toBeFocused();

    // Нажатие вне панели закрывает меню.
    await kkMenuButton.click();
    await expect(kkDialog).toBeVisible();
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width / 2, viewport.height - 4);
    await expect(kkDialog).toBeHidden();
  });
});
