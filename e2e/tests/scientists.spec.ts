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
    // Вкладки — компьютер и планшет (телефон — статья, отдельный тест).
    await page.setViewportSize({ width: 1440, height: 900 });
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
    // REQ-SCI-05 (S1b): вкладки — «Биография · Открытие · Наследие · Факты»; текст полностью — без обрезки.
    await expect(tabs).toHaveText([S.tabs.biography, S.tabs.discovery, S.tabs.legacy, S.tabs.facts]);
    await page.keyboard.press('ArrowRight');
    await expect(win.getByRole('tabpanel')).toContainText(
      'Он показал, что в любом хаосе можно найти закономерность.',
    );
    await page.keyboard.press('End');
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByRole('tabpanel')).toContainText('думал над таблицей 20 лет');
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
    const quote = page.locator('[data-testid="atlas-sci-quote"]:visible');
    await expect(quote).toContainText('— Мария Кюри');
    await expect(quote).toContainText('(приписывается)');
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-SCI-06, AC-EXP-06 the element window: 5 group tabs (REQ-EXP-07), «Основные факты» first in «Обзор»; the rest unchanged', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/explore/oxygen`);
    const win = page.getByTestId('atlas-element-window');
    await expect(win.locator('.layers-control')).toHaveCount(0);
    await expect(win.locator('.read-more-btn')).toHaveCount(0);
    const tabs = win.getByRole('tab');
    // docs/EXPLORE_TZ.md, REQ-EXP-07: вкладки по разделам урока заменены 5 группами.
    await expect(tabs.first()).toHaveText(ru.atlas.tabGroup.overview);
    await expect(win.getByRole('tabpanel').locator('h3').first()).toHaveText('Основные факты');
    await expect(tabs).toHaveCount(5);
    await tabs.first().focus();
    await page.keyboard.press('End');
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByTestId('atlas-take-test')).toBeVisible();
    await expect(win.getByTestId('atlas-ai-card')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-SCI-07 (S1b) key facts, related elements (with a lesson → element window, «Скоро» → table cell), sources, prompts', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/scientists/rutherford`);
    const facts = page.getByTestId('atlas-sci-facts');
    await expect(facts.locator('dt')).toHaveText([
      S.facts.lived,
      S.facts.born,
      S.facts.country,
      S.facts.field,
      S.facts.discovery,
      S.facts.awards,
    ]);
    await expect(facts).toContainText('Брайтуотер');
    await expect(facts).toContainText('1871–1937');
    // В-3: «Биография» дополнена (рождение, образование, где работал).
    await expect(page.getByRole('tabpanel')).toContainText(
      'Эрнест Резерфорд родился в 1871 году в Брайтуотере',
    );
    // REQ-SCI-13: к Википедии — Britannica и NobelPrize.org.
    const resources = page.locator('.resource-link');
    await expect(resources).toContainText([
      'Википедия — Эрнест Резерфорд',
      'Britannica — Эрнест Резерфорд',
      'NobelPrize.org — Эрнест Резерфорд',
    ]);
    // REQ-SCI-09.2: подсказки — утверждённые по учёному.
    await expect(page.getByTestId('atlas-ai-prompt').first()).toContainText(
      'Как Резерфорд из Новой Зеландии попал в Кембридж?',
    );
    // REQ-SCI-08: подписи связей; азот с уроком — окно элемента, резерфордий без урока — ячейка таблицы.
    const chips = page.getByTestId('atlas-sci-element');
    await expect(chips).toHaveCount(3);
    await expect(chips.first()).toContainText(S.rel.transmuted);
    await expect(chips.last()).toContainText(S.rel.named_after);
    await expect(chips.last()).toHaveAttribute('data-soon', 'true');
    await expectNoSeriousA11yViolations(page);
    await chips.last().click();
    await expect(page).toHaveURL(/\/explore\?view=table&cell=104$/);
    await expect(page.locator('[data-testid="atlas-ptable-cell"][data-number="104"]')).toBeFocused();
    await page.goto(`${chem.base}/scientists/rutherford`);
    await chips.first().click();
    await expect(page).toHaveURL(/\/explore\/nitrogen$/);
    await expect(page.getByTestId('atlas-element-window')).toBeVisible();

    // В-1: у Лавуазье «Наград» нет; у Дальтона нет связанных элементов — блок не показывается.
    await page.goto(`${chem.base}/scientists/lavoisier`);
    await expect(page.getByTestId('atlas-sci-facts').locator('dt')).not.toContainText([S.facts.awards]);
    await page.goto(`${chem.base}/scientists/dalton`);
    await expect(page.getByTestId('atlas-sci-facts')).toBeVisible();
    await expect(page.getByTestId('atlas-sci-elements')).toHaveCount(0);

    // Телефон: без горизонтального переполнения.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${chem.base}/scientists/curie`);
      await expect(page.getByTestId('atlas-sci-elements')).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
  });

  test('AC-SCI-08 (REQ-SCI-09 ред. 2) the «AI-помощник» card: tab prompts, the answer panel on the page; a guest is asked to sign in', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const A = ru.atlas.ai;
    // Вкладки и боковая панель — компьютер (шторка телефона — следующий тест).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${chem.base}/scientists/curie`);
    const card = page.getByTestId('atlas-ai-card');
    await expect(card).toContainText(fill(A.cardTitle, { name: 'Мария Кюри' }));
    const prompts = card.getByTestId('atlas-ai-prompt');
    await expect(prompts).toHaveCount(3);
    // Смена вкладки — другие подсказки.
    const first = await prompts.first().textContent();
    await page.getByTestId('atlas-scientist-window').getByRole('tab').nth(1).click();
    await expect(prompts.first()).not.toHaveText(first!);
    // Гость: панель на этой же странице приглашает войти; Esc закрывает только панель, фокус — на подсказку.
    await prompts.first().click();
    const panel = page.getByTestId('atlas-ai-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('atlas-guest-invite')).toBeVisible();
    await expect(page).toHaveURL(/\/scientists\/curie$/);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('atlas-scientist-window')).toBeVisible();
    await expect(prompts.first()).toBeFocused();

    // Ученик: вопрос уходит с именем и вкладкой, можно спросить ещё; «Открыть полный чат →».
    await student(page, baseURL!);
    await page.goto(`${chem.base}/scientists/bohr`);
    const tab = await page.getByTestId('atlas-scientist-window').getByRole('tab').first().textContent();
    const question = (await prompts.first().textContent())!.replace('→', '').trim();
    await prompts.first().click();
    await expect(panel.getByTestId('tutor-user-message').first()).toHaveText(
      // Имя уже в подсказке — в контексте только вкладка.
      question.includes('Нильс Бор')
        ? fill(A.messageTab, { question, tab: tab!.trim() })
        : fill(A.message, { question, name: 'Нильс Бор', tab: tab!.trim() }),
    );
    await expect(panel.getByTestId('atlas-ai-full')).toHaveAttribute('href', /\/ai\?scientists=1$/);
    await panel.getByTestId('atlas-ai-panel-close').click();
    await expect(panel).toHaveCount(0);
    await expect(prompts.first()).toBeFocused();
    // Свой вопрос из поля карточки.
    await card.getByTestId('atlas-ai-custom').fill('Что такое квант?');
    await card.getByTestId('atlas-ai-custom').press('Enter');
    await expect(panel.getByTestId('tutor-user-message').last()).toContainText('Что такое квант?');
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-SCI-09.4, REQ-SCI-09.5 the element window card and the phone sheet; 320 and 390 px — nothing overflows', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const A = ru.atlas.ai;
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${chem.base}/explore/oxygen`);
      const card = page.getByTestId('atlas-ai-card');
      await expect(card.getByTestId('atlas-ai-prompt')).toHaveText([
        `${A.element.brief}→`,
        `${A.element.detail}→`,
        `${fill(A.element.uses, { name: 'Кислород' })}→`,
      ]);
      // «Пройти тест» — отдельная кнопка; «Кратко / Подробно / Тест» нет.
      await expect(page.getByTestId('atlas-take-test')).toBeVisible();
      await expect(page.locator('.ai-actions')).toHaveCount(0);
      expect(await hasHorizontalScroll(page)).toBe(false);
      // На телефоне разделы элемента — аккордеон (вкладок нет).
      await expect(page.getByTestId('atlas-accordion')).toBeVisible();
      await expect(page.getByTestId('atlas-element-window').getByRole('tab')).toHaveCount(0);
      // Шторка ~85 % высоты, прижата к низу; закрывается крестиком.
      await card.getByTestId('atlas-ai-prompt').first().click();
      const sheet = page.getByTestId('atlas-ai-panel');
      // После появления (анимация сдвига) — прижата к низу экрана.
      await expect
        .poll(async () => Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height))
        .toBe(800);
      const s = (await sheet.boundingBox())!;
      expect(s.height).toBeGreaterThan(800 * 0.8);
      expect(s.width).toBe(width);
      await sheet.getByTestId('atlas-ai-panel-close').click();
      await expect(sheet).toHaveCount(0);
      await page.goto(`${chem.base}/scientists/mendeleev`);
      await expect(page.getByTestId('atlas-ai-card')).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
  });

  test('REQ-SCI-05, REQ-SCI-06 (phone) the scientist article with a sticky table of contents; the element accordion; 320/390/430 px', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${chem.base}/scientists/mendeleev`);
      const win = page.getByTestId('atlas-scientist-window');
      // Вкладок нет — статья: все разделы подряд с заголовками h3, оглавление — список ссылок равной ширины.
      await expect(win.getByRole('tab')).toHaveCount(0);
      const sections = win.getByTestId('atlas-article-section');
      await expect(sections).toHaveCount(4);
      await expect(sections.locator('h3')).toHaveCount(4);
      const links = win.getByTestId('atlas-toc-link');
      await expect(links).toHaveCount(4);
      const toc = (await win.getByTestId('atlas-toc').boundingBox())!;
      for (let i = 0; i < 4; i++) {
        const box = (await links.nth(i).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(toc.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(toc.x + toc.width + 1);
      }
      await expect(links.first()).toHaveAttribute('aria-current', 'true');
      expect(await hasHorizontalScroll(page)).toBe(false);
      // Нажатие — к разделу, он подсвечен; закреплённое оглавление не закрывает его заголовок.
      await links.nth(2).click();
      await expect(links.nth(2)).toHaveAttribute('aria-current', 'true');
      await expect
        .poll(async () => {
          const head = (await sections.nth(2).locator('h3').boundingBox())!;
          const bar = (await win.getByTestId('atlas-toc').boundingBox())!;
          return head.y >= bar.y + bar.height - 1;
        })
        .toBe(true);
      // Порядок блоков: разделы → цитата → AI-помощник → современники → «Изучено» и навигация.
      const y = async (testId: string) =>
        (await win.locator(`[data-testid="${testId}"]:visible`).first().boundingBox())!.y;
      const order = [
        await y('atlas-article'),
        await y('atlas-ai-card'),
        await y('atlas-contemporaries'),
        await y('atlas-sci-prev'),
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      // Окно элемента — аккордеон: первый раздел открыт, «Следующий» открывает следующий (один открыт).
      await page.goto(`${chem.base}/explore/oxygen`);
      const heads = page.getByTestId('atlas-acc-head');
      await expect(heads.first()).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('atlas-acc-panel').and(page.locator(':visible'))).toHaveCount(1);
      await page.getByTestId('atlas-acc-next').first().click();
      await expect(heads.nth(1)).toHaveAttribute('aria-expanded', 'true');
      await expect(heads.first()).toHaveAttribute('aria-expanded', 'false');
      expect(await hasHorizontalScroll(page)).toBe(false);
    }
    await expectNoSeriousA11yViolations(page);
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
