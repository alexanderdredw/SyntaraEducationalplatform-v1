import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;

/** ID «Химии» и её тем — через гостевой API (API-PUB-10..12). */
async function chemistryIds(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const chemistry = section.subjects.find((s: { title: string }) => s.title === 'Химия');
  const subject = await (await api.get(`/api/public/subjects/${chemistry.id}`)).json();
  const topic = (title: string) =>
    subject.topics.find((t: { title: string }) => t.title === title).id as string;
  return {
    sectionId: natural.id as string,
    subjectId: chemistry.id as string,
    oxygen: topic('Кислород'),
    chemists: topic('Учёные-химики'),
  };
}

async function signInStudent(page: Page, baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register-student', {
    data: {
      displayName: 'Айдана Химик',
      login: `chem.${randomUUID().slice(0, 8)}`,
      password: 'student-pass-1',
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
  return api;
}

/** Перенос атласа химии (docs/CHEM_TZ.md): главы, уроки элементов, «Учёные-химики». */
test.describe('Химия из «Молекулярного атласа»', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-CHEM-02, BR-CHAP-03 a guest: «Химия» is open; topics by 2 chapters, the first one open, «Тема N» through the subject', async ({
    page,
    baseURL,
  }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/sections/${ids.sectionId}`);
    await page.getByTestId('catalog-subject').filter({ hasText: 'Химия' }).click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/subjects/${ids.subjectId}$`));
    const chapters = page.getByTestId('subject-chapter');
    await expect(chapters).toHaveText([/Химические элементы/, /Учёные-химики/]);
    // У гостя статусов нет — нет и «Освоено m из n»; раскрыта первая глава.
    await expect(page.getByTestId('chapter-progress')).toHaveCount(0);
    const topics = page.getByTestId('student-topic');
    await expect(topics).toHaveCount(60);
    await expect(topics.first()).toContainText('Тема 1');
    await expect(topics.first()).toContainText('Водород');
    await expect(topics.nth(59)).toContainText('Неодим');
    await page.getByRole('button', { name: /Учёные-химики/ }).click();
    await expect(page.getByRole('link', { name: /Тема 61\s*Учёные-химики/ })).toBeVisible();
  });

  test('BR-CHAP-03 a student: «Освоено m из n» in every chapter; the first unmastered chapter is open', async ({
    page,
    baseURL,
  }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await signInStudent(page, baseURL!);
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    await expect(page.getByTestId('chapter-progress')).toHaveText([
      ru.student.subject.chapterProgress.replace('{mastered}', '0').replace('{total}', '60'),
      ru.student.subject.chapterProgress.replace('{mastered}', '0').replace('{total}', '1'),
    ]);
    await expect(page.getByRole('button', { name: /Химические элементы/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByRole('button', { name: /Учёные-химики/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.getByTestId('student-topic').first()).toHaveAttribute('data-status', 'not_started');
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-CHEM-03, AC-CHEM-06 an element lesson: overview, fun fact, own atom scheme with alt, sections, «Источники», quiz of 5', async ({
    page,
    baseURL,
  }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await signInStudent(page, baseURL!);
    await page.goto(`/ru/learn/topics/${ids.oxygen}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Кислород' })).toBeVisible();
    await expect(page.getByTestId('lesson-fun-fact')).toContainText('46%');
    const overview = page.getByTestId('lesson-overview');
    await expect(overview.getByRole('img', { name: /Модель атома по Бору: кислород, O/ })).toBeVisible();
    const sections = overview.getByRole('button');
    await expect(sections.first()).toContainText('Основные факты');
    await expect(sections.last()).toContainText('Источники');
    await sections.last().click();
    await expect(overview.getByRole('link', { name: /PubChem/ })).toHaveAttribute(
      'href',
      /pubchem\.ncbi\.nlm\.nih\.gov/,
    );
    await page.goto(`/ru/learn/topics/${ids.oxygen}?tab=quiz`);
    await expect(
      page.getByTestId('student-quiz').getByRole('list').first().getByRole('listitem'),
    ).toHaveCount(5);
  });

  test('AC-CHEM-04 KK and EN lessons are marked «На проверке»', async ({ page, baseURL }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    for (const locale of ['kk', 'en'] as const) {
      await page.goto(`/${locale}/learn/topics/${ids.oxygen}`);
      await expect(page.getByTestId('lesson-needs-review')).toBeVisible();
    }
  });

  test('AC-CHEM-07 «Анатомия человека» (no chapters) is unchanged: a plain list of topics', async ({
    page,
    baseURL,
  }) => {
    const catalog = await (await (await request.newContext({ baseURL })).get('/api/public/catalog')).json();
    const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
    await page.goto(`/ru/learn/sections/${biology.id}`);
    await page.getByTestId('catalog-subject').filter({ hasText: 'Анатомия человека' }).click();
    await expect(page.getByTestId('student-topic')).toHaveCount(3);
    await expect(page.getByTestId('subject-chapters')).toHaveCount(0);
  });

  for (const width of [320, 390]) {
    test(`AC-CHEM-11 phone ${width} px: the subject page and a lesson have no horizontal scroll`, async ({
      page,
      baseURL,
    }) => {
      const ids = await chemistryIds(await request.newContext({ baseURL }));
      await page.setViewportSize({ width, height: 800 });
      for (const path of [`/ru/learn/subjects/${ids.subjectId}`, `/ru/learn/topics/${ids.chemists}`]) {
        await page.goto(path);
        await expect(page.locator('#main')).not.toBeEmpty();
        expect(await hasHorizontalScroll(page), path).toBe(false);
      }
    });
  }

  test('AC-CHEM-08, REQ-GLOS-02…06 a guest: «Глоссарий» from the subject page; sections, search ignoring case and ё/е with highlight; «Ничего не найдено»', async ({
    page,
    baseURL,
  }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    await page.getByTestId('subject-glossary-link').click();
    await expect(page).toHaveURL(new RegExp(`/ru/learn/subjects/${ids.subjectId}/glossary$`));
    await expect(page.getByRole('heading', { level: 1, name: ru.student.glossary.title })).toBeVisible();
    const crumbs = page.getByRole('navigation', { name: ru.student.lesson.breadcrumbs });
    await expect(crumbs).toHaveText(/Каталог\s*\/\s*Химия\s*\/\s*Глоссарий/);
    await expect(page.getByTestId('glossary-section')).toHaveCount(5);
    await expect(page.getByTestId('glossary-term')).toHaveCount(212);
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

  test('AC-CHEM-08 a student: the glossary in KK and EN is «На проверке»; «Каталог» is active; subjects without a glossary have no button', async ({
    page,
    baseURL,
  }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
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
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/ru/learn/subjects/${ids.subjectId}/glossary`);
    const terms = page.getByTestId('glossary-term');
    await expect(terms.nth(1)).toBeVisible();
    const [a, b] = [await terms.nth(0).boundingBox(), await terms.nth(1).boundingBox()];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    await page.mouse.wheel(0, 3000);
    await expect(page.getByTestId('glossary-search')).toBeInViewport();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
  test('AC-CHEM-09, REQ-PTBL-02…07 the periodic table: 118 cells, 60 lessons and «Скоро», aria-label, legend filter, keyboard', async ({
    page,
    baseURL,
  }) => {
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    const table = page.getByTestId('periodic-table');
    await expect(table.getByRole('heading', { name: ru.student.periodicTable.title })).toBeVisible();
    const cells = table.getByTestId('ptable-cell');
    await expect(cells).toHaveCount(118);
    await expect(table.locator('a[data-testid="ptable-cell"]')).toHaveCount(60);
    await expect(table.locator('[data-testid="ptable-cell"][data-status="soon"]')).toHaveCount(58);
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
    const hydrogen = table.locator('[data-number="1"]');
    await hydrogen.focus();
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
    const ids = await chemistryIds(await request.newContext({ baseURL }));
    await signInStudent(page, baseURL!);
    await page.goto(`/ru/learn/topics/${ids.oxygen}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Кислород' })).toBeVisible();
    await page.goto(`/ru/learn/subjects/${ids.subjectId}`);
    const oxygen = page.getByTestId('periodic-table').locator('[data-number="8"]');
    await expect(oxygen).toHaveAttribute('data-status', 'started');
    await expect(oxygen).toHaveAttribute('aria-label', /в процессе$/);
  });

  for (const width of [320, 390]) {
    test(`AC-CHEM-09, REQ-PTBL-08 phone ${width} px: the table scrolls inside the block, the page does not; «Списком» shows 118 elements`, async ({
      page,
      baseURL,
    }) => {
      const ids = await chemistryIds(await request.newContext({ baseURL }));
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
    test(`AC-CHEM-11 ${theme} theme: the subject page with the table has no serious axe violations; reduced motion — no transitions`, async ({
      page,
      context,
      baseURL,
    }) => {
      const ids = await chemistryIds(await request.newContext({ baseURL }));
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
});
