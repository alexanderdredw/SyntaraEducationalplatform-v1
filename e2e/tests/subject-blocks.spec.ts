import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;

/**
 * ID тестового предмета и его тем — через гостевой API (API-PUB-10..12). Предмет — e2e/fixtures/content (seed
 * `e2e`): «Химия» показывается модулем атласа, общие блоки проверяются на нём (решение владельца 2026-10-28).
 */
async function fixtureIds(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const fixtures = catalog.sections.find((s: { title: string }) => s.title === 'Тестовый раздел');
  const section = await (await api.get(`/api/public/sections/${fixtures.id}`)).json();
  const fixture = section.subjects.find((s: { title: string }) => s.title === 'Тестовый предмет');
  const subject = await (await api.get(`/api/public/subjects/${fixture.id}`)).json();
  const topic = (title: string) =>
    subject.topics.find((t: { title: string }) => t.title === title).id as string;
  return {
    sectionId: fixtures.id as string,
    subjectId: fixture.id as string,
    oxygen: topic('Кислород'),
    scientists: topic('Учёные'),
  };
}

async function signInStudent(page: Page, baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register-student', {
    data: {
      displayName: 'Айдана Тест',
      login: `blocks.${randomUUID().slice(0, 8)}`,
      password: 'student-pass-1',
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
  return api;
}

/** Общие блоки предмета (docs/CHEM_TZ.md, REQ-ATL-07): главы, глоссарий, таблица Менделеева, лента времени. */
test.describe('Общие блоки предмета (тестовый предмет)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('BR-CHAP-03 a guest: topics by 2 chapters, the first one open, «Тема N» through the subject', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/sections/${ids.sectionId}`);
    await page.getByTestId('catalog-subject').filter({ hasText: 'Тестовый предмет' }).click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/subjects/${ids.subjectId}$`));
    await expect(page.getByTestId('subject-chapter')).toHaveText([/Элементы/, /Учёные/]);
    // У гостя статусов нет — нет и «Освоено m из n»; раскрыта первая глава.
    await expect(page.getByTestId('chapter-progress')).toHaveCount(0);
    const topics = page.getByTestId('student-topic');
    await expect(topics).toHaveCount(3);
    await expect(topics.first()).toContainText('Тема 1');
    await expect(topics.first()).toContainText('Водород');
    await expect(topics.nth(2)).toContainText('Кислород');
    await page.getByRole('button', { name: /Учёные/ }).click();
    await expect(page.getByRole('link', { name: /Тема 4\s*Учёные/ })).toBeVisible();
  });

  test('BR-CHAP-03 a student: «Освоено m из n» in every chapter; the first unmastered chapter is open', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await signInStudent(page, baseURL!);
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    await expect(page.getByTestId('chapter-progress')).toHaveText([
      ru.student.subject.chapterProgress.replace('{mastered}', '0').replace('{total}', '3'),
      ru.student.subject.chapterProgress.replace('{mastered}', '0').replace('{total}', '1'),
    ]);
    await expect(page.getByRole('button', { name: /Элементы/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: /Учёные/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('student-topic').first()).toHaveAttribute('data-status', 'not_started');
    await expectNoSeriousA11yViolations(page);
  });

  test('BR-CNT-05 KK and EN lessons are marked «На проверке»', async ({ page, baseURL }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    for (const locale of ['kk', 'en'] as const) {
      await page.goto(`/${locale}/learn/topics/${ids.oxygen}`);
      await expect(page.getByTestId('lesson-needs-review')).toBeVisible();
    }
  });

  for (const width of [320, 390]) {
    test(`BR-CHAP-03 phone ${width} px: the subject page and a lesson have no horizontal scroll`, async ({
      page,
      baseURL,
    }) => {
      const ids = await fixtureIds(await request.newContext({ baseURL }));
      await page.setViewportSize({ width, height: 800 });
      for (const path of [`/ru/learn/subjects/${ids.subjectId}`, `/ru/learn/topics/${ids.scientists}`]) {
        await page.goto(path);
        await expect(page.locator('#main')).not.toBeEmpty();
        expect(await hasHorizontalScroll(page), path).toBe(false);
      }
    });
  }

  test('REQ-GLOS-02…06 a guest: «Глоссарий» from the subject page; sections, search ignoring case and ё/е with highlight; «Ничего не найдено»', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    await page.getByTestId('subject-glossary-link').click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/subjects/${ids.subjectId}/glossary$`));
    await expect(page.getByRole('heading', { level: 1, name: ru.student.glossary.title })).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: ru.student.lesson.breadcrumbs });
    await expect(crumbs).toHaveText(/Каталог\s*\/\s*Тестовый предмет\s*\/\s*Глоссарий/);
    await expect(page.getByTestId('glossary-section')).toHaveCount(2);
    await expect(page.getByTestId('glossary-term')).toHaveCount(13);
    const search = page.getByRole('searchbox', { name: ru.student.glossary.search });
    // «ЗАВЕРШЕННОЙ» находит «завершённой»; совпадение подсвечено.
    await search.fill('ЗАВЕРШЕННОЙ');
    await expect(page.getByTestId('glossary-term')).toHaveCount(1);
    await expect(page.getByTestId('glossary-term').locator('mark')).toHaveText('завершённой');
    await search.fill('атом');
    await expect(page.getByTestId('glossary-term').first().locator('mark').first()).toBeVisible();
    await search.fill('нет такого термина');
    await expect(page.getByText(ru.student.glossary.empty)).toBeVisible();
    await expect(page.getByTestId('glossary-term')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-GLOS-01 a student: the glossary in KK and EN is «На проверке»; «Каталог» is active; subjects without a glossary have no button', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await signInStudent(page, baseURL!);
    await page.goto(`/ru/learn/subjects/${ids.subjectId}/glossary`);
    await expect(page.getByTestId('glossary-term').first()).toBeVisible();
    await expect(
      page.locator('[aria-current="page"]').filter({ hasText: ru.cabinet.nav.studentCatalog }),
    ).toHaveCount(1);
    for (const locale of ['kk', 'en'] as const) {
      await page.goto(`/${locale}/learn/subjects/${ids.subjectId}/glossary`);
      await expect(page.getByTestId('glossary-needs-review')).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: bundles[locale].student.glossary.title }),
      ).toBeVisible();
    }
    const catalog = await (await (await request.newContext({ baseURL })).get('/api/public/catalog')).json();
    const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
    const section = await (
      await (await request.newContext({ baseURL })).get(`/api/public/sections/${biology.id}`)
    ).json();
    const anatomy = section.subjects.find((s: { title: string }) => s.title === 'Анатомия человека');
    await page.goto(`/ru/learn/subjects/${anatomy.id}`);
    await expect(page.getByTestId('student-topic').first()).toBeVisible();
    await expect(page.getByTestId('subject-glossary-link')).toHaveCount(0);
    const res = await page.goto(`/ru/learn/subjects/${anatomy.id}/glossary`);
    expect(res?.status()).toBe(404);
  });

  test('REQ-GLOS-05 phone 390 px: one column, the search field stays on top while scrolling; no horizontal scroll', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/ru/learn/subjects/${ids.subjectId}/glossary`);
    const terms = page.getByTestId('glossary-term');
    await expect(terms.nth(1)).toBeVisible();
    const [a, b] = [await terms.nth(0).boundingBox(), await terms.nth(1).boundingBox()];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    // Список длиннее экрана: у последнего термина поле поиска остаётся сверху.
    await terms.last().scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.getByTestId('glossary-search')).toBeInViewport();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('REQ-PTBL-02…07 the periodic table: 118 cells, lessons and «Скоро», aria-label, legend filter, keyboard', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    const table = page.getByTestId('periodic-table');
    await expect(table.getByRole('heading', { name: ru.student.periodicTable.title })).toBeVisible();
    await expect(table.getByTestId('ptable-cell')).toHaveCount(118);
    await expect(table.locator('a[data-testid="ptable-cell"]')).toHaveCount(3);
    await expect(table.locator('[data-testid="ptable-cell"][data-status="soon"]')).toHaveCount(115);
    const oxygen = table.locator('[data-number="8"]');
    await expect(oxygen).toHaveAttribute('aria-label', 'Кислород, O, номер 8, неметалл');
    await expect(table.locator('[data-number="79"]')).toHaveAttribute(
      'aria-label',
      /Золото, Au, номер 79, .*Скоро/,
    );
    // Легенда-фильтр: семейство подсвечено, остальные приглушены; повторное нажатие снимает фильтр.
    const legend = table.getByRole('button', { name: /неметалл/i }).first();
    await legend.click();
    await expect(legend).toHaveAttribute('aria-pressed', 'true');
    await expect(oxygen).not.toHaveAttribute('data-dimmed');
    await expect(table.locator('[data-number="26"]')).toHaveAttribute('data-dimmed', 'true');
    await legend.click();
    await expect(table.locator('[data-dimmed]')).toHaveCount(0);
    // Клавиатура: H → (→) He, (↓) Li; Enter открывает урок.
    await table.locator('[data-number="1"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(table.locator('[data-number="2"]')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await expect(table.locator('[data-number="3"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Литий' })).toBeVisible();
  });

  test('REQ-PTBL-05 a student: the opened topic shows «в процессе» on its cell', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await signInStudent(page, baseURL!);
    await page.goto(`/ru/learn/topics/${ids.oxygen}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Кислород' })).toBeVisible();
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    const oxygen = page.getByTestId('periodic-table').locator('[data-number="8"]');
    await expect(oxygen).toHaveAttribute('data-status', 'started');
    await expect(oxygen).toHaveAttribute('aria-label', /в процессе$/);
  });

  for (const width of [320, 390]) {
    test(`REQ-PTBL-08 phone ${width} px: the table scrolls inside the block, the page does not; «Списком» shows 118 elements`, async ({
      page,
      baseURL,
    }) => {
      const ids = await fixtureIds(await request.newContext({ baseURL }));
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
      const scroller = page.getByTestId('ptable-scroll');
      await expect(scroller).toBeVisible();
      expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(await hasHorizontalScroll(page)).toBe(false);
      await page.getByRole('radio', { name: ru.student.periodicTable.asList }).click();
      await expect(page.getByTestId('ptable-list-item')).toHaveCount(118);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }

  for (const theme of ['dark', 'light'] as const) {
    test(`REQ-PTBL-07 ${theme} theme: the subject page with the table has no serious axe violations; reduced motion — no transitions`, async ({
      page,
      context,
      baseURL,
    }) => {
      const ids = await fixtureIds(await request.newContext({ baseURL }));
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
      const cell = page.getByTestId('periodic-table').locator('[data-number="8"]');
      await expect(cell).toBeVisible();
      const duration = await cell.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
      expect(duration).toBeLessThan(0.01);
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('REQ-TL-01…05 the timeline: points by real years; a point opens and scrolls to the section; keyboard; axe', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/topics/${ids.scientists}`);
    const timeline = page.getByTestId('lesson-timeline');
    await expect(timeline.getByRole('heading', { name: ru.student.lesson.timeline })).toBeVisible();
    const points = timeline.getByTestId('timeline-point');
    await expect(points).toHaveCount(3);
    await expect(points.first()).toContainText('1774');
    await expect(points.last()).toContainText('1869');
    const mendeleev = points.filter({ hasText: 'Дмитрий Менделеев' });
    await expect(mendeleev).toContainText('1834–1907');
    await mendeleev.focus();
    await page.keyboard.press('Enter');
    const section = page
      .getByTestId('lesson-overview')
      .locator('button[aria-expanded]', { hasText: 'Дмитрий Менделеев' });
    await expect(section).toHaveAttribute('aria-expanded', 'true');
    await expect(section).toBeInViewport();
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-TL-03 phone 390 px: the timeline is a vertical list; no horizontal scroll', async ({
    page,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/ru/learn/topics/${ids.scientists}`);
    const points = page.getByTestId('timeline-point');
    await expect(points).toHaveCount(3);
    const [a, b] = [await points.nth(0).boundingBox(), await points.nth(1).boundingBox()];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    expect(Math.abs(b!.x - a!.x)).toBeLessThan(2);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`REQ-GLOS-05, REQ-TL-03 ${theme}: glossary and the timeline lesson have no serious axe violations; widths 768 and 1440 without horizontal scroll`, async ({
      page,
      context,
      baseURL,
    }) => {
      const ids = await fixtureIds(await request.newContext({ baseURL }));
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      for (const width of [768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of [
          `/ru/learn/subjects/${ids.subjectId}`,
          `/ru/learn/subjects/${ids.subjectId}/glossary`,
          `/ru/learn/topics/${ids.scientists}`,
        ]) {
          await page.goto(path);
          await expect(page.locator('#main')).not.toBeEmpty();
          expect(await hasHorizontalScroll(page), `${width} ${path}`).toBe(false);
        }
      }
      await expect(page.getByTestId('lesson-timeline')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.goto(`/ru/learn/subjects/${ids.subjectId}/glossary`);
      await expect(page.getByTestId('glossary-term').first()).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  test('REQ-PTBL-07 «Экономия трафика»: no transitions in the periodic table and the legend', async ({
    page,
    context,
    baseURL,
  }) => {
    const ids = await fixtureIds(await request.newContext({ baseURL }));
    await context.addCookies([{ name: 'data_saver', value: '1', url: baseURL! }]);
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    const cell = page.getByTestId('periodic-table').locator('[data-number="8"]');
    await expect(cell).toBeVisible();
    expect(await cell.evaluate((el) => getComputedStyle(el).transitionDuration)).toMatch(/^0s/);
  });
});
