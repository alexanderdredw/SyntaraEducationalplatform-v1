import { expect, test } from '@playwright/test';
import { acceptCookies, bundles, isMobile } from './support';

const ru = bundles.ru;

test.describe('Публичные страницы', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-PUB-01, REQ-PUB-HOME-01 home sections are in the required order', async ({ page }) => {
    await page.goto('/ru');
    const order = await page
      .locator('main [data-testid^="home-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([
      'home-hero',
      'home-short',
      'home-demo',
      'home-how',
      'home-subjects',
      'home-why',
      'home-schools',
      'home-progress',
    ]);
    // Футер идёт после всех секций.
    const footerTop = (await page.getByTestId('site-footer').boundingBox())!.y;
    const lastTop = (await page.getByTestId('home-progress').boundingBox())!.y;
    expect(footerTop).toBeGreaterThan(lastTop);
  });

  test('AC-PUB-01, REQ-PUB-HOME-02 H1 has three lines, the third one in --accent', async ({ page }) => {
    await page.goto('/ru');
    const h1 = page.getByRole('heading', { level: 1 });
    const lines = h1.locator(':scope > span');
    await expect(lines).toHaveText([ru.home.hero.line1, ru.home.hero.line2, ru.home.hero.line3]);
    const [lineColor, accent] = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      document.body.appendChild(probe);
      const third = document.querySelector('[data-testid="hero-accent-line"]')!;
      return [getComputedStyle(third).color, getComputedStyle(probe).color];
    });
    expect(lineColor).toBe(accent);
    await expect(page.getByRole('link', { name: ru.home.hero.cta })).toHaveAttribute('href', '/ru/subjects');
    await expect(page.getByRole('link', { name: ru.home.hero.teacher })).toHaveAttribute(
      'href',
      '/ru/auth/start?role=teacher',
    );
  });

  test('AC-PUB-02, REQ-PUB-HOME-07 «Почему Syntara»: arrow button and ←/→ keep panel and indicator in sync', async ({
    page,
  }) => {
    await page.goto('/ru');
    const why = page.getByTestId('home-why');
    const panel = why.getByTestId('why-panel');
    const tabs = why.getByRole('tab');
    const activeIndicator = () =>
      why
        .getByTestId('why-indicators')
        .locator('span')
        .evaluateAll((els) => els.findIndex((e) => e.getAttribute('data-active') === 'true'));
    const panels = Object.values(ru.home.why.panels);

    await expect(panel).toHaveText(panels[0]!);
    await why.getByRole('button', { name: ru.home.why.next }).click();
    await expect(panel).toHaveText(panels[1]!);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    expect(await activeIndicator()).toBe(1);

    await tabs.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(panel).toHaveText(panels[2]!);
    await expect(tabs.nth(2)).toBeFocused();
    expect(await activeIndicator()).toBe(2);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(panel).toHaveText(panels[0]!);

    // Без автопрокрутки.
    await page.waitForTimeout(4000);
    await expect(panel).toHaveText(panels[0]!);
  });

  test('REQ-PUB-HOME-06 subjects on home: cards from API-PUB-01, status/«Открыть →» only when open', async ({
    page,
  }) => {
    await page.goto('/ru');
    const cards = page.getByTestId('home-subjects').getByTestId('subject-card');
    // PH-01 — все базовые предметы каталога (решение владельца 2026-10-16); статус и «Открыть →» — только у open.
    await expect(cards).toHaveCount(12);
    await expect(cards.first()).toContainText('Биология');
    await expect(page.getByTestId('home-subjects').getByTestId('subject-status')).toHaveCount(1);
    await expect(cards.first()).toContainText(ru.subjects.open);
    await expect(page.getByTestId('home-subjects').getByText(ru.home.subjects.subtitle)).toBeVisible();
  });

  test('REQ-PUB-SUBJ-01..03, BR-VIS-04 /subjects: «Открыт для знакомства» → catalog for a guest, «Скоро» group last, no search', async ({
    page,
  }) => {
    await page.goto('/ru/subjects');
    const available = page.getByTestId('subject-card');
    await expect(available.first()).toHaveAttribute('data-status', 'open');
    await expect(available.first().getByTestId('subject-status')).toHaveText(ru.subjects.status.open);
    await expect(available.first().getByRole('link')).toHaveAttribute(
      'href',
      /^\/ru\/learn\/sections\/[0-9a-f-]{36}$/,
    );
    const soon = page.getByTestId('subjects-soon');
    await expect(soon.getByRole('heading', { name: ru.subjects.soonGroup })).toBeVisible();
    await expect(soon.getByTestId('subject-card')).toHaveCount(11);
    await expect(soon.getByRole('link')).toHaveCount(0);
    await expect(page.locator('main input, main [role="search"]')).toHaveCount(0);
  });

  test('REQ-PUB-ABOUT-01 /about: 11 blocks in order; atlas links fall back to PH-10 label', async ({
    page,
  }) => {
    await page.goto('/ru/about');
    const order = await page
      .locator('main [data-testid^="about-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([
      'about-hero',
      'about-mission',
      'about-problem',
      'about-audience',
      'about-why',
      'about-how',
      'about-inside',
      'about-origins',
      'about-team',
      'about-sdg',
      'about-join',
    ]);
    await expect(page.getByText(ru.about.mission.quote)).toBeVisible();
    await expect(page.getByTestId('about-origins').getByText(ru.about.origins.soon)).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'zabolotnyyalexandr@gmail.com' })).toBeVisible();
  });

  test('REQ-PUB-AI-01 /ai: left column texts', async ({ page }) => {
    await page.goto('/ru/ai');
    await expect(page.getByText(ru.ai.label)).toBeVisible();
    await expect(page.getByText(ru.ai.text)).toBeVisible();
  });

  test('REQ-PUB-SCH-01..03 /schools: buttons, 6 cards, 4 steps, privacy link, trial; no prices', async ({
    page,
  }) => {
    await page.goto('/ru/schools');
    await expect(page.getByRole('link', { name: ru.schools.hero.ask })).toHaveAttribute(
      'href',
      '/ru/support?category=school_onboarding',
    );
    await expect(page.getByTestId('schools-gets').getByRole('listitem')).toHaveCount(6);
    await expect(page.getByTestId('schools-connect').getByRole('listitem')).toHaveCount(4);
    await expect(
      page.getByTestId('schools-data').getByRole('link', { name: ru.schools.data.privacyLink }),
    ).toHaveAttribute('href', '/ru/privacy');
    await expect(page.getByText(ru.schools.trial.text)).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/₸|тенге|KZT/);
  });

  test('REQ-PUB-SUP-01, REQ-PUB-REQ-01 form pages show their titles (forms — iteration 4)', async ({
    page,
  }) => {
    await page.goto('/ru/support');
    await expect(page.getByText(ru.support.subtitle)).toBeVisible();
    await page.goto('/ru/schools/request');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.schoolRequest.title);
    await expect(page.getByRole('link', { name: ru.common.backHome })).toBeVisible();
  });

  for (const [doc, count] of [
    ['terms', 13],
    ['privacy', 13],
    ['cookies', 7],
  ] as const) {
    test(`REQ-PUB-LEGAL-01 /${doc}: updated date, PH-14 banner, ${count} sections, bottom links`, async ({
      page,
    }) => {
      await page.goto(`/ru/${doc}`);
      await expect(page.getByText('Обновлено: 2026-09-14')).toBeVisible();
      await expect(page.getByTestId('legal-draft-banner')).toHaveText(ru.legal.draftBanner);
      await expect(page.getByTestId('legal-sections').locator(':scope > li')).toHaveCount(count);
      const nav = page.getByRole('navigation', { name: ru.legal.docsLabel });
      for (const link of [
        ru.legal.myData,
        ru.legal.terms,
        ru.legal.privacy,
        ru.legal.cookies,
        ru.common.backHome,
      ]) {
        await expect(nav.getByRole('link', { name: link })).toBeVisible();
      }
    });
  }

  test('REQ-NFR-PERF-01 home page loads ≤ 500 KB of compressed resources', async ({ page }) => {
    test.skip(isMobile(page), 'бюджет считается один раз');
    await page.goto('/ru', { waitUntil: 'networkidle' });
    const bytes = await page.evaluate(() => {
      const entries = [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
      ] as PerformanceResourceTiming[];
      return entries.reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0);
    });
    expect(bytes).toBeLessThanOrEqual(500 * 1024);
  });
});
