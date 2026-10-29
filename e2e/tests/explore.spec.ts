import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { setTopicMastery } from './db';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const E = ru.atlas.explore;
const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((acc, [k, x]) => acc.replace(`{${k}}`, String(x)), s);

interface Element {
  code: string;
  topicId: string;
  group: string;
  title: string;
  symbol: string;
  description: string;
}

async function chemistry(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const atlas = await (await api.get(`/api/public/subjects/${id}/atlas`)).json();
  const elements = atlas.elements as Element[];
  return {
    id,
    base: `/ru/learn/subjects/${id}`,
    elements,
    topic: (code: string) => elements.find((e) => e.code === code)!.topicId,
  };
}

/** Ученик: освоено водород (100 %) и кислород (85 %), начат литий (60 %). */
async function student(page: Page, baseURL: string, chem: Awaited<ReturnType<typeof chemistry>>) {
  const api = await request.newContext({ baseURL });
  const login = `exp.${randomUUID().slice(0, 8)}`;
  const res = await api.post('/api/auth/register-student', {
    data: { displayName: 'Айдана Исследует', login, password: 'student-pass-1' },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  await setTopicMastery(login, chem.topic('hydrogen'), 100);
  await setTopicMastery(login, chem.topic('oxygen'), 85);
  await setTopicMastery(login, chem.topic('lithium'), 60);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

const cards = (page: Page) => page.getByTestId('atlas-card');
const titles = (page: Page) => page.getByTestId('atlas-card-link');

/** «Исследовать» и окно элемента атласа (docs/EXPLORE_TZ.md, этап И1). */
test.describe('«Исследовать» и окно элемента (docs/EXPLORE_TZ.md, И1)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-EXP-01 the progress header with family rings for a student; a guest sees no personal progress', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore`);
    await expect(cards(page)).toHaveCount(60);
    await expect(page.getByTestId('atlas-progress')).toHaveCount(0);
    await expect(page.getByTestId('atlas-status-filter')).toHaveCount(0);

    await student(page, baseURL!, chem);
    await page.goto(`${chem.base}/explore`);
    await expect(page.getByTestId('atlas-progress-studied')).toHaveText(
      fill(E.studied, { count: 3, total: 60 }),
    );
    await expect(page.getByTestId('atlas-progress-mastered')).toHaveText(
      fill(E.mastered, { count: 2, threshold: 80 }),
    );
    const nonmetals = chem.elements.filter((e) => e.group === 'nonmetal').length;
    const ring = page.locator('[data-testid="atlas-ring"][data-family="nonmetal"]');
    await expect(ring).toHaveAttribute(
      'aria-label',
      fill(E.ring, { family: ru.atlas.group.nonmetal, done: 2, total: nonmetals }),
    );
    await ring.click();
    await expect(page).toHaveURL(/family=nonmetal/);
    await expect(cards(page)).toHaveCount(nonmetals);
    await expect(ring).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC-EXP-02 search by name, symbol and number; multi-select family chips; progress filter; sort; three views; state in the URL', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await student(page, baseURL!, chem);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore`);
    const search = page.getByTestId('atlas-search-input');
    for (const q of ['Fe', 'fe', '26', 'желез', 'ЖЕЛЕЗ']) {
      await search.fill(q);
      await expect(titles(page)).toHaveText(['Железо']);
    }
    await expect(page).toHaveURL(/q=%D0%96%D0%95%D0%9B%D0%95%D0%97/);
    await search.fill('');
    await expect(cards(page)).toHaveCount(60);

    // Чипы — мультивыбор; «Все» — сброс; «назад» возвращает прежнее состояние.
    const chips = page.getByTestId('atlas-family-chips');
    const alkali = chem.elements.filter((e) => e.group === 'alkali_metal').length;
    const halogens = chem.elements.filter((e) => e.group === 'halogen').length;
    await chips.getByRole('button', { name: ru.atlas.group.alkali_metal }).click();
    await expect(cards(page)).toHaveCount(alkali);
    await chips.getByRole('button', { name: ru.atlas.group.halogen }).click();
    await expect(page).toHaveURL(/family=alkali_metal%2Chalogen|family=alkali_metal,halogen/);
    await expect(cards(page)).toHaveCount(alkali + halogens);
    await page.goBack();
    await expect(cards(page)).toHaveCount(alkali);
    await chips.getByRole('button', { name: ru.atlas.filter.all }).click();
    await expect(cards(page)).toHaveCount(60);

    // Прогресс (ученик): «Освоено» — водород и кислород.
    await page.getByTestId('atlas-status-filter').getByRole('button', { name: E.status.mastered }).click();
    await expect(titles(page)).toHaveText(['Водород', 'Кислород']);
    await expect(page).toHaveURL(/status=mastered/);
    await page.getByTestId('atlas-status-filter').getByRole('button', { name: E.status.mastered }).click();
    await expect(cards(page)).toHaveCount(60);

    // Сортировка по алфавиту: первый — «Азот».
    await page.getByTestId('atlas-sort').getByRole('button', { name: E.sort.alpha }).click();
    await expect(titles(page).first()).toHaveText('Азот');
    await expect(page).toHaveURL(/sort=alpha/);

    // Виды: список — 60 строк, таблица — 118 ячеек; состояние — в адресе.
    await page.getByTestId('atlas-view').getByRole('link', { name: ru.atlas.view.list }).click();
    await expect(page).toHaveURL(/sort=alpha&view=list/);
    await expect(page.getByTestId('atlas-list-row')).toHaveCount(60);
    await expect(page.getByTestId('atlas-list-row').first()).toContainText('Азот');
    await page.getByTestId('atlas-view').getByRole('link', { name: ru.atlas.view.table }).click();
    await expect(page.getByTestId('atlas-ptable-cell')).toHaveCount(118);
    await page.goto(`${chem.base}/explore?view=list&q=26`);
    await expect(page.getByTestId('atlas-list-row')).toHaveCount(1);
    await expect(search).toHaveValue('26');
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-EXP-03 the card: tile with mass, the whole illustration, period/group, full description, progress, quick view «i», «Тест»', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await student(page, baseURL!, chem);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore`);
    const li = page.locator('[data-testid="atlas-card"][data-system="lithium"]');
    await expect(li.locator('.ex-tile-mass')).toHaveText('6,94');
    await expect(li.getByTestId('atlas-card-place')).toHaveText(fill(E.place, { period: 2, group: 1 }));
    await expect(li.locator('.ex-desc')).toHaveText(
      chem.elements.find((e) => e.code === 'lithium')!.description,
    );
    // Описание полностью — без обрезки строк; картинка — целиком (contain).
    await expect(li.locator('.ex-desc')).toHaveCSS('-webkit-line-clamp', 'none');
    await expect(li.locator('.ex-card-visual img')).toHaveCSS('object-fit', 'contain');
    await expect(li).toContainText(fill(E.best, { percent: 60 }));
    await expect(li.getByTestId('atlas-card-mark')).toHaveText(E.markStudied);
    await expect(page.locator('[data-system="hydrogen"]').getByTestId('atlas-card-mark')).toHaveText(
      E.markMastered,
    );
    await expect(li.getByTestId('atlas-card-test')).toHaveAttribute('href', /\/explore\/lithium\/test$/);

    // Быстрый просмотр: 3 первых пункта «Основных фактов», интересный факт, «Открыть урок»; Esc — фокус на «i».
    const open = li.getByTestId('atlas-quick-open');
    await open.click();
    const quick = page.getByTestId('atlas-quick');
    await expect(quick.locator('li')).toHaveText([
      'Химический символ — Li',
      'Атомный номер — 3',
      'Атомная масса — 6.94',
    ]);
    await expect(quick).toContainText(E.funFact);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(quick).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    await page.getByTestId('atlas-quick-lesson').click();
    await expect(page).toHaveURL(/\/explore\/lithium$/);

    // Масса по языку: 6.94 в EN.
    await page.goto(`/en/learn/subjects/${chem.id}/explore`);
    await expect(page.locator('[data-system="lithium"] .ex-tile-mass')).toHaveText('6.94');
  });

  test('AC-EXP-04, AC-EXP-05 the window: sticky left column (illustration ⇄ Bohr, key data, mini table, ← →), 5 tabs in one row', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore/lithium`);
    const win = page.getByTestId('atlas-element-window');
    await expect(win.locator('.detail-visual')).toHaveCSS('position', 'sticky');
    // REQ-EXP-05.3: литий — из списка 11, по умолчанию модель Бора: 3 электрона, оболочки 2 и 1.
    await expect(page.getByTestId('atlas-model-bohr')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('atlas-bohr')).toHaveAttribute('data-shells', '2,1');
    await expect(page.getByTestId('atlas-bohr-electron')).toHaveCount(3);
    await expect(page.getByTestId('atlas-bohr')).toContainText('n=1: 2e⁻');
    await page.getByTestId('atlas-model-image').click();
    await expect(page.getByTestId('atlas-element-image')).toBeVisible();
    // Ключевые данные и мини-таблица.
    const data = page.getByTestId('atlas-el-data');
    await expect(data).toContainText('6,94');
    await expect(data).toContainText('[He] 2s¹');
    await expect(page.getByTestId('atlas-mini-caption')).toHaveText(
      fill(ru.atlas.mini.caption, { period: 2, group: 1, block: 's' }),
    );
    await expect(page.getByTestId('atlas-mini-neighbor')).toHaveText([/Водород/, /Бериллий/, /Натрий/]);
    // 5 групп вкладок в одну строку.
    const tabs = win.getByRole('tab');
    await expect(tabs).toHaveText([
      ru.atlas.tabGroup.overview,
      ru.atlas.tabGroup.structure,
      ru.atlas.tabGroup.properties,
      ru.atlas.tabGroup.nature,
      ru.atlas.tabGroup.applications,
    ]);
    const tops = await tabs.evaluateAll((list) => list.map((t) => Math.round(t.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    // ← → во вкладках не переключают элемент; вне вкладок — переключают.
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/explore\/lithium$/);
    await page.getByTestId('atlas-el-data').click();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/explore\/beryllium$/);
    await expect(win.getByRole('heading', { name: 'Бериллий', exact: true })).toBeVisible();
    // Бериллий — не из списка 11: по умолчанию иллюстрация; ссылка «← Литий».
    await expect(page.getByTestId('atlas-model-image')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('atlas-el-prev').click();
    await expect(page).toHaveURL(/\/explore\/lithium$/);
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-EXP-06 all lesson sections are in the 5 groups (headings h3, original order); phone — accordion of groups', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const lesson = await (
      await (await request.newContext({ baseURL })).get(`/api/public/topics/${chem.topic('carbon')}`)
    ).json();
    const sections = (lesson.sections as Array<{ title: string; code: string }>)
      .filter((s) => s.code !== 'sources')
      .map((s) => s.title);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore/carbon`);
    const win = page.getByTestId('atlas-element-window');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await win.getByRole('tab').nth(i).click();
      seen.push(...(await win.getByRole('tabpanel').locator('h3').allTextContents()));
    }
    expect([...seen].sort()).toEqual([...sections].sort());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${chem.base}/explore/carbon`);
    const heads = page.getByTestId('atlas-acc-head');
    await expect(heads).toHaveCount(5);
    await expect(heads.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('atlas-acc-next').first()).toHaveText(
      fill(ru.atlas.detail.nextSection, { title: ru.atlas.tabGroup.structure }),
    );
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('AC-EXP-07 the boron description is fixed; AI card «Спросите об элементе «…»»; prompts follow the active group', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    expect(chem.elements.find((e) => e.code === 'boron')!.description).toBe(
      'Полуметалл, применяемый в стекловолокне, ядерных реакторах и удобрениях.',
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore/boron`);
    const card = page.getByTestId('atlas-ai-card');
    await expect(card).toContainText(fill(ru.atlas.ai.cardTitleElement, { name: 'Бор' }));
    await expect(card.getByTestId('atlas-ai-prompt').last()).toContainText('Где применяется элемент «Бор»?');
    await page.getByTestId('atlas-element-window').getByRole('tab').nth(1).click();
    await expect(card.getByTestId('atlas-ai-prompt').first()).toContainText(
      fill(ru.atlas.ai.group.structure.p1, { name: 'Бор' }),
    );
  });

  test('AC-EXP-11 phone: filters without page overflow; light theme passes axe; «Экономия трафика» stops the Bohr animation', async ({
    page,
    context,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${chem.base}/explore?family=alkali_metal,halogen`);
      await expect(page.getByTestId('atlas-family-chips')).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await context.addCookies([{ name: 'theme', value: 'light', url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore`);
    await expect(cards(page)).toHaveCount(60);
    await expectNoSeriousA11yViolations(page);
    await page.goto(`${chem.base}/explore/sodium`);
    await expect(page.getByTestId('atlas-bohr')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    // Режим «Экономия трафика» платформы — атрибут корня (переключатель шапки).
    await page.evaluate(() => document.documentElement.setAttribute('data-data-saver', 'true'));
    await expect(page.locator('.bohr-ring').first()).toHaveCSS('animation-name', 'none');
  });
});
