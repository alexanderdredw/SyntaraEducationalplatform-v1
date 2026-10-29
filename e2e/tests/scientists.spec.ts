import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const S = ru.atlas.sci;
const uid = () => randomUUID().slice(0, 8);
const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((acc, [k, x]) => acc.replace(`{${k}}`, String(x)), s);

async function chemistry(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  return { id, base: `/ru/learn/subjects/${id}` };
}

async function student(page: Page, baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register-student', {
    data: { displayName: 'Айдана Учёные', login: `sci.${uid()}`, password: 'student-pass-1' },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
  return cookies;
}

/** Раздел «Учёные» атласа (docs/SCIENTISTS_TZ.md, этап S1). */
test.describe('«Учёные» — лента, панель, изучено, окно (docs/SCIENTISTS_TZ.md, S1)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-SCI-01, AC-SCI-02, AC-SCI-03 the lifelines on a computer and a phone; the «Проверь себя» panel on top', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/scientists`);
    const rows = page.getByTestId('atlas-lifeline');
    await expect(rows).toHaveCount(9);
    // Подпись строки для диктора: «Дмитрий Менделеев, 1834–1907, 1869 — Периодический закон».
    await expect(rows.and(page.locator('[data-code="mendeleev"]'))).toHaveAttribute(
      'aria-label',
      'Дмитрий Менделеев, 1834–1907, 1869 — Периодический закон',
    );
    // Полосы жизни пропорциональны оси: Хоткин (1910–1994) правее Лавуазье (1743–1794).
    const left = async (code: string) =>
      page
        .locator(`[data-testid="atlas-lifeline"][data-code="${code}"] .sci-life`)
        .evaluate((el) => el.getBoundingClientRect().left);
    expect(await left('hodgkin')).toBeGreaterThan(await left('lavoisier'));
    // Наведение на строку — мини-карточка; на карточку сетки — подсветка строки, и наоборот.
    await rows.and(page.locator('[data-code="curie"]')).hover();
    await expect(page.locator('[data-code="curie"] .sci-card-pop')).toBeVisible();
    await page.locator('[data-testid="atlas-scientist-card"][data-code="bohr"]').hover();
    await expect(rows.and(page.locator('[data-code="bohr"]'))).toHaveAttribute('data-active', 'true');
    // Клавиатура: стрелка вниз — следующая строка, Enter — окно учёного.
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/scientists\/dalton$/);
    await page.getByTestId('atlas-scientist-window').getByRole('button', { name: ru.common.close }).click();

    // Панель «Проверь себя»: две подписанные карточки; нижнего блока нет.
    const panel = page.getByTestId('atlas-check-panel');
    await expect(panel).toContainText(S.panel.gameTitle);
    await expect(panel).toContainText(S.panel.testTitle);
    await expect(page.getByTestId('atlas-scientists-take-test')).toHaveCount(0);
    await page.getByTestId('atlas-check-game-go').click();
    await expect(page).toHaveURL(/scientists\?game=1$/);
    await expect(page.getByTestId('atlas-quiz-intro')).toContainText(ru.atlas.scientistsQuiz.title);
    await expectNoSeriousA11yViolations(page);

    // Телефон: вертикальная лента на 390 и 320 px, нажатие открывает учёного, без горизонтальной прокрутки.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${chem.base}/scientists`);
      await expect(page.getByTestId('atlas-lifelines')).toBeHidden();
      await expect(page.getByTestId('atlas-timeline-vertical-row')).toHaveCount(9);
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await page.getByTestId('atlas-timeline-vertical-row').nth(3).click();
    await expect(page).toHaveURL(/\/scientists\/mendeleev$/);
  });

  test('AC-SCI-04 «Отметить как изученное» is stored on the server; «Изучено N из 9»; the invitation after 3 closes', async ({
    page,
    browser,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const cookies = await student(page, baseURL!);
    for (const [i, code] of ['lavoisier', 'mendeleev', 'curie'].entries()) {
      await page.goto(`${chem.base}/scientists/${code}`);
      const toggle = page.getByTestId('atlas-sci-studied');
      await expect(toggle).toHaveText(S.markStudied);
      await toggle.click();
      await expect(toggle).toHaveText(S.studiedDone);
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('atlas-sci-studied-count')).toHaveText(
        fill(S.studiedCount, { count: i + 1, total: 9 }),
      );
    }
    await page.getByTestId('atlas-scientist-window').getByRole('button', { name: ru.common.close }).click();
    await expect(page.getByTestId('atlas-sci-studied-total')).toHaveText(
      fill(S.studiedCount, { count: 3, total: 9 }),
    );
    await expect(page.getByTestId('atlas-sci-card-studied')).toHaveCount(3);
    const invite = page.getByTestId('atlas-sci-invite');
    await expect(invite).toContainText(fill(S.invite, { count: 3, total: 9 }));
    await page.getByTestId('atlas-sci-invite-close').click();
    await expect(invite).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('atlas-sci-studied-total')).toBeVisible();
    await expect(invite).toHaveCount(0);

    // «Другой браузер» — те же отметки с сервера; там приглашение не закрыто.
    const other = await browser.newContext();
    await acceptCookies(other, baseURL);
    await other.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL! })));
    const second = await other.newPage();
    await second.goto(`${chem.base}/scientists`);
    await expect(second.getByTestId('atlas-sci-card-studied')).toHaveCount(3);
    await expect(second.getByTestId('atlas-sci-invite')).toBeVisible();
    await other.close();
  });

  test('AC-SCI-05, AC-SCI-09, AC-SCI-10 the scientist window: tabs by keyboard, full text; quote; contemporaries; navigation', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/scientists/mendeleev`);
    const win = page.getByTestId('atlas-scientist-window');
    // «Слоёв» и «Подробнее» нет; вкладки — роль tablist.
    await expect(win.locator('.layers-control')).toHaveCount(0);
    await expect(win.locator('.read-more-btn')).toHaveCount(0);
    const tabs = win.getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByRole('tabpanel')).toContainText('В 1869 году Менделеев совершил прорыв');
    await page.keyboard.press('End');
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    // Текст полностью — без обрезки.
    await expect(win.getByRole('tabpanel')).toContainText(
      'Он показал, что в любом хаосе можно найти закономерность.',
    );
    await page.keyboard.press('Home');
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    // Окно не уходит «назад» по стрелкам во вкладках.
    await expect(page).toHaveURL(/\/scientists\/mendeleev$/);

    // Современники по пересечению лет жизни (≥ 10 лет); навигация по году открытия.
    await expect(page.getByTestId('atlas-contemporaries')).toContainText('Альфред Нобель');
    await expect(page.getByTestId('atlas-sci-prev')).toContainText('Альфред Нобель · 1867');
    await page.getByTestId('atlas-sci-next').click();
    await expect(page).toHaveURL(/\/scientists\/curie$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/scientists\/mendeleev$/);
    // Цитата — карточкой с подписью и пометкой «приписывается».
    await page.goto(`${chem.base}/scientists/curie`);
    const quote = page.getByTestId('atlas-sci-quote');
    await expect(quote).toContainText('— Мария Кюри');
    await expect(quote).toContainText('(приписывается)');
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-SCI-06 the element window: tabs by the lesson sections, «Основные факты» first; the rest unchanged', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/explore/oxygen`);
    const win = page.getByTestId('atlas-element-window');
    await expect(win.locator('.layers-control')).toHaveCount(0);
    await expect(win.locator('.read-more-btn')).toHaveCount(0);
    const tabs = win.getByRole('tab');
    await expect(tabs.first()).toHaveText('Основные факты');
    expect(await tabs.count()).toBeGreaterThan(3);
    await tabs.first().focus();
    await page.keyboard.press('End');
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByTestId('atlas-take-test')).toBeVisible();
    await expect(win.getByTestId('atlas-assistant')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-SCI-08 «Спросить Syntara AI» with the scientist context and three questions; a guest is asked to sign in', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/scientists/bohr`);
    const ask = page.getByTestId('atlas-sci-ask');
    for (const q of ['explain', 'table', 'today'] as const) await expect(ask).toContainText(S.ai[q]);
    await page.getByTestId('atlas-sci-ask-explain').click();
    await expect(page).toHaveURL(/\/ai\?scientists=1&scientist=bohr&ask=explain$/);
    await expect(page.getByTestId('atlas-guest-invite')).toBeVisible();

    await student(page, baseURL!);
    await page.goto(`${chem.base}/scientists/bohr`);
    await page.getByTestId('atlas-sci-ask-table').click();
    await expect(
      page.getByText(fill(S.ai.message, { name: 'Нильс Бор', question: S.ai.table })),
    ).toBeVisible();
  });

  test('AC-SCI-10 light theme and «Экономия трафика»: axe passes, the lifelines are drawn without animation', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.context().addCookies([{ name: 'theme', value: 'light', url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/scientists`);
    await expect(page.getByTestId('atlas-lifeline')).toHaveCount(9);
    await expectNoSeriousA11yViolations(page);
    await page.evaluate(() => document.documentElement.setAttribute('data-data-saver', 'true'));
    const animation = await page
      .locator('.sci-life')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe('none');
  });
});
