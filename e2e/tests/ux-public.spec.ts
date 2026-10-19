import { expect, test } from '@playwright/test';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isMobile,
} from './support';

const ru = bundles.ru;

/** Вёрстка публичных страниц по docs/UX_TZ.md (UX-01…UX-09); логика страниц не меняется. */
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
});
