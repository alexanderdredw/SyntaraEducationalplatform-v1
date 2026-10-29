import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const TEACHER = {
  email: 'teacher@syntara.local',
  password: process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password',
};

/** ID «Химии» и данные атласа — через гостевой API (API-PUB-10..12, API-PUB-15). */
async function chemistry(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const atlas = await (await api.get(`/api/public/subjects/${id}/atlas`)).json();
  return {
    id,
    base: `/ru/learn/subjects/${id}`,
    elements: atlas.elements as Array<{ code: string; topicId: string; group: string; title: string }>,
    scientists: atlas.scientists.topicId as string,
  };
}

async function signInStudent(page: Page, baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register-student', {
    data: {
      displayName: 'Айдана Атлас',
      login: `atlas.${randomUUID().slice(0, 8)}`,
      password: 'student-pass-1',
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
  return api;
}

async function signInTeacher(page: Page, baseURL: string) {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/login', { data: TEACHER });
  expect(res.status(), await res.text()).toBe(200);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

const progressText = (i: number, n: number) =>
  ru.test.progress.replace('{index}', String(i)).replace('{count}', String(n));

/**
 * Пройти тест атласа (docs/TESTS_TZ.md, T1): «Вопрос k из N», первый доступный вариант, обратная связь, «Далее».
 */
async function passAtlasTest(page: Page, total: number): Promise<void> {
  for (let i = 1; i <= total; i++) {
    await expect(page.getByTestId('atest-progress')).toHaveText(progressText(i, total));
    await page.locator('[data-testid="atest-option"]:not([aria-disabled])').first().click();
    await expect(page.getByTestId('atest-feedback')).not.toBeEmpty();
    // REQ-TST-01: правильный вариант подсвечен; переход — только по «Далее».
    await expect(page.locator('[data-testid="atest-option"][data-state="correct"]')).toHaveCount(1);
    await page.getByTestId('atest-next').click();
  }
}

/** «{верные} из {всего}» на экране результата. */
async function resultCorrect(page: Page, testId: string): Promise<number> {
  const title = await page.getByTestId(testId).locator('.atest-result-title').textContent();
  return Number(/(\d+)/.exec(title ?? '')![1]);
}

/** Модуль «Mendeleev Atlas» (docs/CHEM_TZ_2.md, docs/ATLAS_MAP.md). */
test.describe('«Химия» — Mendeleev Atlas', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-ATL-03, REQ-ATL-02 a guest: the atlas bar with the logo and 7 sections; no «Статистика» and «О нас»; own URLs, back and reload work', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(chem.base);
    await expect(page.getByTestId('atlas-home')).toBeVisible();
    await expect(page.getByTestId('atlas-bar').getByRole('link', { name: 'Mendeleev Atlas' })).toBeVisible();
    // До 1024 px «таблетка» — в меню «☰ Меню», как в оригинале.
    const narrow = (page.viewportSize()?.width ?? 1440) <= 1024;
    if (narrow) await page.getByTestId('atlas-burger').click();
    const nav = page.getByTestId('atlas-nav').getByRole('link');
    await expect(nav).toHaveText(Object.values(ru.atlas.nav).slice(0, 7));
    await expect(page.getByTestId('atlas-nav')).not.toContainText('Статистика');
    await expect(page.getByTestId('atlas-nav')).not.toContainText('О нас');
    await page.getByTestId('atlas-nav').getByRole('link', { name: ru.atlas.nav.scientists }).click();
    await expect(page).toHaveURL(new RegExp(`${chem.base}/scientists$`));
    if (narrow) await page.getByTestId('atlas-burger').click();
    await expect(
      page.getByTestId('atlas-nav').getByRole('link', { name: ru.atlas.nav.scientists }),
    ).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByTestId('atlas-home')).toBeVisible();
    await page.goto(`${chem.base}/search`);
    await page.reload();
    await expect(page.getByTestId('atlas-search')).toBeVisible();
  });

  test('AC-ATL-09, REQ-ATL-01.2 old chemistry lesson URLs redirect to the atlas (308); the assignment is kept', async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL });
    const chem = await chemistry(api);
    const oxygen = chem.elements.find((e) => e.code === 'oxygen')!;
    const plain = await api.get(`/ru/learn/topics/${oxygen.topicId}`, { maxRedirects: 0 });
    expect(plain.status()).toBe(308);
    expect(plain.headers().location).toContain(`${chem.base}/explore/oxygen`);
    const quiz = await api.get(`/ru/learn/topics/${oxygen.topicId}?tab=quiz&assignment=abc`, {
      maxRedirects: 0,
    });
    expect(quiz.headers().location).toContain(`${chem.base}/explore/oxygen/test?assignment=abc`);
    const sci = await api.get(`/ru/learn/topics/${chem.scientists}`, { maxRedirects: 0 });
    expect(sci.headers().location).toContain(`${chem.base}/scientists`);
    await page.goto(`/ru/learn/topics/${oxygen.topicId}`);
    await expect(page.getByTestId('atlas-element-window')).toBeVisible();
  });

  test('AC-ATL-09, AC-CHEM-07 other subjects are unchanged: «Анатомия человека» — the standard subject page and lessons', async ({
    page,
    baseURL,
  }) => {
    const catalog = await (await (await request.newContext({ baseURL })).get('/api/public/catalog')).json();
    const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
    await page.goto(`/ru/learn/sections/${biology.id}`);
    await page.getByTestId('catalog-subject').filter({ hasText: 'Анатомия человека' }).click();
    await expect(page.getByTestId('student-topic')).toHaveCount(3);
    await expect(page.getByTestId('atlas')).toHaveCount(0);
    await page.getByTestId('student-topic').first().click();
    await expect(page.getByTestId('lesson-page')).toBeVisible();
  });

  test('REQ-ATL-03 Explore: 60 cards; the group filter is kept in the URL and after closing the element window (Esc)', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const halogens = chem.elements.filter((e) => e.group === 'halogen');
    await page.goto(`${chem.base}/explore`);
    await expect(page.getByTestId('atlas-card')).toHaveCount(60);
    await page.getByTestId('atlas-filter').click();
    const drawer = page.getByTestId('atlas-filter-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: ru.atlas.group.halogen }).click();
    await expect(page).toHaveURL(/group=halogen/);
    await expect(page.getByTestId('atlas-card')).toHaveCount(halogens.length);
    await page.getByTestId('atlas-card').first().click();
    const win = page.getByTestId('atlas-element-window');
    await expect(win).toBeVisible();
    await expect(win.getByRole('heading', { name: halogens[0]!.title })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(win).toHaveCount(0);
    await expect(page).toHaveURL(/explore\?group=halogen$/);
    await expect(page.getByTestId('atlas-card')).toHaveCount(halogens.length);
  });

  test('REQ-ATL-03, decision 3 the «Таблица» view: 118 cells, 60 with lessons, arrows move focus, a cell opens the element window', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/explore`);
    await page.getByTestId('atlas-view').getByRole('link', { name: ru.atlas.view.table }).click();
    await expect(page).toHaveURL(/view=table/);
    const cells = page.getByTestId('atlas-ptable-cell');
    await expect(cells).toHaveCount(118);
    await expect(page.locator('[data-testid="atlas-ptable-cell"]:not([data-status="soon"])')).toHaveCount(60);
    const h = cells.first();
    await h.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-testid="atlas-ptable-cell"][data-number="2"]')).toBeFocused();
    await expect(page.locator('[data-number="8"]')).toHaveAttribute('aria-label', /Кислород, O, номер 8/);
    await page.locator('[data-number="8"]').click();
    await expect(page).toHaveURL(/explore\/oxygen\?view=table/);
    await expect(page.getByTestId('atlas-element-window')).toBeVisible();
    // Решение А-3: «Пройти тест» под описанием; гостю — вход платформы.
    await page.getByTestId('atlas-take-test').click();
    await expect(page.getByTestId('atlas-guest-invite')).toBeVisible();
  });

  test('AC-ATL-05, BR-XP-01 a student: opening the window counts as opening the lesson; «Пройти тест» — 5 questions, XP = 4 × correct, the header updates', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const api = await signInStudent(page, baseURL!);
    await page.goto(`${chem.base}/explore/oxygen`);
    await expect(page.getByTestId('atlas-element-window')).toBeVisible();
    await expect
      .poll(async () => {
        const data = await (await api.get(`/api/student/subjects/${chem.id}/atlas`)).json();
        return data.elements.find((e: { code: string }) => e.code === 'oxygen').status;
      })
      .toBe('started');
    await page.getByTestId('atlas-take-test').click();
    await expect(page).toHaveURL(/explore\/oxygen\/test$/);
    await passAtlasTest(page, 5);
    const result = page.getByTestId('atlas-test-result');
    await expect(result).toBeVisible({ timeout: 10_000 });
    // BR-XP-01: round(20 × правильные / 5) = 4 × правильные; +5 XP — первое открытие темы.
    const correct = await resultCorrect(page, 'atlas-test-result');
    const xp = Number((await page.getByTestId('atlas-test-xp').textContent())!.replace(/\D/g, ''));
    expect(xp).toBe(4 * correct);
    const stats = await (await api.get('/api/me/stats')).json();
    expect(stats.xpTotal).toBe(5 + xp);
    // XP в шапке — без перезагрузки страницы.
    await expect(page.getByTestId('cabinet-stats')).toContainText(`${5 + xp} XP`);
  });

  test('AC-ATL-06 the quiz «Проверь знания»: 10 questions, a result with «+N XP»; a guest is asked to sign in', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atlas-guest-invite')).toBeVisible();

    const api = await signInStudent(page, baseURL!);
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page).toHaveURL(/quiz\?session=/);
    await passAtlasTest(page, 10);
    await expect(page.getByTestId('atlas-quiz-result')).toBeVisible({ timeout: 10_000 });
    const xp = Number((await page.getByTestId('atlas-quiz-xp').textContent())!.replace(/\D/g, ''));
    const stats = await (await api.get('/api/me/stats')).json();
    expect(stats.xpTotal).toBe(xp);
    expect(stats.streakDays).toBe(1);
  });

  test('REQ-ATL-03, decision А-5 «Учёные»: 9 points on the timeline, a card opens the window; the game and «Пройти тест» of the lesson', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/scientists`);
    // Лента — на экранах шире 1024 px (на телефоне и планшете оригинал её скрывает).
    if ((page.viewportSize()?.width ?? 1440) > 1024)
      await expect(page.getByTestId('atlas-timeline').getByRole('link')).toHaveCount(9);
    await expect(page.getByTestId('atlas-scientist-card')).toHaveCount(9);
    await page.locator('[data-testid="atlas-scientist-card"][data-code="curie"]').click();
    await expect(page).toHaveURL(new RegExp(`${chem.base}/scientists/curie$`));
    const win = page.getByTestId('atlas-scientist-window');
    await expect(win.getByRole('heading', { name: 'Мария Кюри' })).toBeVisible();
    await win.getByRole('button', { name: ru.common.close }).click();
    await expect(page).toHaveURL(new RegExp(`${chem.base}/scientists$`));
    await page.getByTestId('atlas-scientists-take-test').click();
    await expect(page).toHaveURL(/scientists\/test$/);
    await expect(page.getByTestId('atlas-guest-invite')).toBeVisible();
  });

  test('AC-ATL-07 Search: elements and definitions in the interface language; a definition opens the glossary at the term', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/search`);
    await page.getByTestId('atlas-search-input').fill('кисло');
    await expect(page.getByTestId('atlas-search-element').first()).toContainText('Кислород');
    await expect(page.getByTestId('atlas-search-term').first()).toBeVisible();
    await expect(page).toHaveURL(/search\?q=/);
    await page.getByTestId('atlas-search-input').fill('zzzzqq');
    await expect(page.getByTestId('atlas-search-empty')).toContainText(ru.atlas.search.noResults);
    await page.getByTestId('atlas-search-input').fill('кислоты');
    await page.getByTestId('atlas-search-term').first().click();
    await expect(page).toHaveURL(/glossary#t-/);
    await expect(page.locator('.glossary-term-pair.search-spotlight')).toBeVisible();
  });

  test('REQ-ATL-03 Glossary «Химический лексикон»: 5 sections and 212 terms', async ({ page, baseURL }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await page.goto(`${chem.base}/glossary`);
    await expect(page.getByRole('heading', { name: ru.atlas.glossary.title })).toBeVisible();
    await expect(page.getByTestId('atlas-glossary-section')).toHaveCount(5);
    await expect(page.getByTestId('atlas-glossary-term')).toHaveCount(212);
  });

  test('AC-ATL-07, AC-ATL-11 Syntara AI: a guest is asked to sign in; a student asks the platform tutor (no external requests)', async ({
    page,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    await page.goto(`${chem.base}/ai`);
    await expect(page.getByTestId('atlas-guest-invite')).toBeVisible();
    await signInStudent(page, baseURL!);
    await page.goto(`${chem.base}/ai?element=oxygen`);
    await page.getByTestId('tutor-input').fill('Почему кислород поддерживает горение?');
    await page.getByTestId('tutor-ask').click();
    await expect(page.getByTestId('tutor-assistant-message').last()).not.toBeEmpty();
    const own = new URL(baseURL!).host;
    const storage = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT;
    const allowed = [own, ...(storage ? [new URL(storage).host] : []), 'localhost:9000'];
    expect([...hosts].filter((h) => !allowed.includes(h))).toEqual([]);
  });

  test('AC-ATL-11, decision 2026-10-28 a teacher takes the same tests: one question at a time, check, result without XP; the AI is unavailable', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await signInTeacher(page, baseURL!);
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atlas-quiz-preview')).toContainText(ru.atlas.preview.note);
    await expect(page.getByTestId('atest-question')).toHaveCount(1);
    await passAtlasTest(page, 10);
    await expect(page.getByTestId('atlas-quiz-result')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('atlas-quiz-xp')).toHaveCount(0);

    await page.goto(`${chem.base}/explore/oxygen/test`);
    await expect(page.getByTestId('atlas-test-preview')).toContainText(ru.atlas.preview.note);
    await passAtlasTest(page, 5);
    await expect(page.getByTestId('atlas-test-result')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('atlas-test-xp')).toHaveCount(0);
    await expect(page.getByTestId('atlas-test-mastery')).toHaveCount(0);
    await page.goto(`${chem.base}/ai`);
    await expect(page.getByTestId('atlas-preview-note')).toHaveText(ru.atlas.preview.ai);
  });

  test('AC-ATL-04 theme and language come from the platform switches: light theme, KK and EN texts', async ({
    page,
    context,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await context.addCookies([{ name: 'theme', value: 'light', url: baseURL! }]);
    await page.goto(chem.base);
    await expect(page.getByTestId('atlas')).toHaveCSS('background-color', 'rgb(251, 251, 253)');
    await page.goto(`/kk/learn/subjects/${chem.id}/explore`);
    await expect(page.getByTestId('atlas-nav')).toContainText(bundles.kk.atlas.nav.explore);
    await page.goto(`/en/learn/subjects/${chem.id}/explore`);
    await expect(page.getByTestId('atlas-nav')).toContainText('Explore');
    await expect(page.getByTestId('atlas-card').nth(7)).toContainText('Oxygen');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`AC-ATL-10 ${theme}: atlas screens have no serious axe violations`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.setTimeout(120_000);
      const chem = await chemistry(await request.newContext({ baseURL }));
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const path of [
        '',
        '/explore',
        '/explore/oxygen',
        '/explore?view=table',
        '/scientists',
        '/scientists/curie',
        '/quiz',
        '/search?q=азот',
        '/glossary',
        '/ai',
      ]) {
        await page.goto(`${chem.base}${path}`);
        await expect(page.getByTestId('atlas')).toBeVisible();
        await expectNoSeriousA11yViolations(page);
      }
    });
  }

  test('AC-ATL-10 reduced motion and «Экономия трафика»: no running animations, the particles are a still frame', async ({
    page,
    context,
    baseURL,
  }) => {
    const chem = await chemistry(await request.newContext({ baseURL }));
    await context.addCookies([{ name: 'data_saver', value: '1', url: baseURL! }]);
    await page.goto(chem.base);
    await expect(page.getByTestId('atlas-particles')).toBeVisible();
    await page.waitForTimeout(300);
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming().duration as number) > 1)
          .length,
    );
    expect(running).toBe(0);
  });

  for (const width of [390, 320]) {
    test(`REQ-ATL-02.5 phone ${width} px: the atlas menu opens and closes (Esc), platform floating buttons are hidden; no horizontal scroll`, async ({
      page,
      baseURL,
    }) => {
      const chem = await chemistry(await request.newContext({ baseURL }));
      await page.setViewportSize({ width, height: 800 });
      for (const path of [
        '',
        '/explore',
        '/explore/oxygen',
        '/scientists',
        '/quiz',
        '/search',
        '/glossary',
        '/ai',
      ]) {
        await page.goto(`${chem.base}${path}`);
        await expect(page.getByTestId('atlas')).toBeVisible();
        expect(await hasHorizontalScroll(page), path).toBe(false);
      }
      await page.goto(chem.base);
      const burger = page.getByTestId('atlas-burger');
      await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('atlas-nav')).toBeVisible();
      await expect(page.getByTestId('floating-help')).toHaveCSS('opacity', '0');
      await page.keyboard.press('Escape');
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await expect(burger).toBeFocused();
    });
  }
});
