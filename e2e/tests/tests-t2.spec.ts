import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { answerAtlas, type QuizElement } from './atlas-solver';
import {
  acceptCookies,
  bundles,
  expectNoSeriousA11yViolations,
  hasHorizontalScroll,
  isPhone,
} from './support';

const ru = bundles.ru;
const T = ru.test;
const M = ru.atlas.quiz.modes;
const uid = () => randomUUID().slice(0, 8);
const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((acc, [k, x]) => acc.replace(`{${k}}`, String(x)), s);
const TEACHER = {
  email: 'teacher@syntara.local',
  password: process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password',
};

async function chemistry(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const atlas = await (await api.get(`/api/public/subjects/${id}/atlas`)).json();
  return { id, base: `/ru/learn/subjects/${id}`, elements: atlas.elements as QuizElement[] };
}

async function signInAs(page: Page, baseURL: string, path: string, data: object) {
  const api = await request.newContext({ baseURL });
  const res = await api.post(path, { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const { cookies } = await api.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}
const student = (page: Page, baseURL: string) =>
  signInAs(page, baseURL, '/api/auth/register-student', {
    displayName: 'Айдана Т2',
    login: `t2.${uid()}`,
    password: 'student-pass-1',
  });

/** Ответить на вопрос и перейти к следующему; `right` — правильно. */
async function step(page: Page, elements: QuizElement[], right = true) {
  await answerAtlas(page, elements, !right);
  await expect(page.getByTestId('atest-feedback')).toContainText(right ? T.correct : T.incorrect);
  await page.getByTestId('atest-next').click();
}

/** Квиз «Проверь знания» — этап T2 (docs/TESTS_TZ.md, REQ-TST-10…12). */
test.describe('Тестирование T2 — квиз атласа (docs/TESTS_TZ.md)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-TST-10, AC-TST-11 «Быстрый»: mixed types answered right — 10 of 10; the start screen has four modes', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await student(page, baseURL!);
    await page.goto(`${chem.base}/quiz`);
    const modes = page.getByTestId('atlas-quiz-modes');
    for (const mode of ['quick', 'family', 'mistakes', 'table'] as const)
      await expect(modes).toContainText(M[mode]);
    await expect(page.getByTestId('atlas-quiz-mode-quick')).toBeChecked();
    await expectNoSeriousA11yViolations(page);
    await page.getByTestId('atlas-quiz-start').click();
    for (let i = 1; i <= 10; i++) {
      await expect(page.getByTestId('atest-progress')).toHaveText(fill(T.progress, { index: i, count: 10 }));
      // Схема Бора — без надписей, выдающих ответ (REQ-TST-10.2).
      if (await page.getByTestId('atest-bohr').isVisible())
        await expect(page.locator('.atest-bohr text')).toHaveCount(0);
      await step(page, chem.elements);
    }
    const result = page.getByTestId('atlas-quiz-result');
    await expect(result.locator('.atest-result-title')).toHaveText(
      fill(T.result.score, { correct: 10, total: 10 }),
    );
    await expect(page.getByTestId('atlas-quiz-mistakes')).toHaveCount(0);
  });

  test('REQ-TST-10.3, AC-TST-10 «Таблица-челлендж»: keyboard (arrows, Enter), «50/50» highlights two periods; a phone scrolls inside the block', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await student(page, baseURL!);
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-table').check();
    await page.getByTestId('atlas-quiz-start').click();
    const table = page.getByTestId('atest-table');
    await expect(table).toBeVisible();
    await expect(page.getByTestId('atest-question')).toContainText(/Найдите на таблице/);
    // В ячейках только символы (названия выдали бы ответ); кликабельны только 60 элементов с уроками.
    await expect(page.getByTestId('atest-cell')).toHaveCount(60);
    await expect(table.locator('.atlas-ptable-name')).toHaveCount(0);
    expect(await hasHorizontalScroll(page)).toBe(false);
    if (isPhone(page)) {
      const scroll = table.locator('.atlas-ptable-scroll');
      expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    await expectNoSeriousA11yViolations(page);

    // «50/50»: два периода подсвечены, остальные приглушены; подсказка отмечена.
    await page.getByTestId('atest-hint').click();
    await expect(table.locator('.atest-table-status')).toContainText(T.table.hint);
    const bright = await page
      .getByTestId('atest-cell')
      .evaluateAll((cells) => [
        ...new Set(
          cells.filter((c) => !(c as HTMLElement).style.opacity).map((c) => c.getAttribute('data-period')),
        ),
      ]);
    expect(bright).toHaveLength(2);

    // Клавиатура: фокус на ячейке, стрелка вправо — соседняя ячейка, Enter — выбор, «Ответить».
    const first = page.getByTestId('atest-cell').first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-symbol'));
    expect(focused).toBe('He');
    await page.keyboard.press('Enter');
    await expect(table.locator('.atest-table-picked')).toHaveText(fill(T.table.picked, { symbol: 'He' }));
    await expect(page.locator('[data-testid="atest-cell"][data-symbol="He"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Ответ — решателем (правильная ячейка); после ответа она зелёная.
    await answerAtlas(page, chem.elements);
    await expect(page.locator('[data-testid="atest-cell"][data-state="correct"]')).toHaveCount(1);
    await expect(page.getByTestId('atest-feedback')).toContainText(T.correct);
    await page.getByTestId('atest-next').click();
    for (let i = 2; i <= 10; i++) {
      await expect(page.getByTestId('atest-table')).toBeVisible();
      await step(page, chem.elements, i % 2 === 0);
    }
    await expect(page.getByTestId('atlas-quiz-result')).toBeVisible();
    await expect(page.getByTestId('atlas-quiz-result')).toContainText(fill(T.result.hinted, { count: 1 }));
  });

  test('AC-TST-11 «По семейству» — only the chosen family; «Работа над ошибками» without mistakes says so and offers «Быстрый»', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await student(page, baseURL!);
    await page.goto(`${chem.base}/quiz`);
    // Ошибок ещё нет.
    await page.getByTestId('atlas-quiz-mode-mistakes').check();
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atlas-quiz-no-mistakes')).toContainText(M.noMistakes);
    await expectNoSeriousA11yViolations(page);

    // «По семейству»: галогены — все объяснения про галогены, в итогах одно семейство.
    await page.getByTestId('atlas-quiz-mode-family').check();
    const family = page.getByTestId('atlas-quiz-family');
    await expect(family.locator('option')).not.toHaveCount(0);
    await expect(family.locator('option', { hasText: ru.atlas.group.actinide })).toHaveCount(0);
    await family.selectOption('halogen');
    await page.getByTestId('atlas-quiz-start').click();
    for (let i = 1; i <= 10; i++) {
      await answerAtlas(page, chem.elements, i <= 2);
      await expect(page.getByTestId('atest-explanation')).toContainText(
        ru.student.periodicTable.families.halogen,
      );
      await page.getByTestId('atest-next').click();
    }
    const families = page.getByTestId('atlas-quiz-families').locator('li');
    await expect(families).toHaveCount(1);
    await expect(families).toContainText(ru.student.periodicTable.families.halogen);

    // Теперь есть ошибки — «Работа над ошибками» берёт ошибочные элементы.
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-mistakes').check();
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atest-progress')).toBeVisible();
    await expect(page.getByTestId('atest-progress')).toHaveText(/ (1|2)$/);
  });

  test('REQ-TST-10 «Впишите символ» and «Верно/Неверно» answered by keyboard; light theme passes axe (AC-TST-13)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await student(page, baseURL!);
    await page.context().addCookies([{ name: 'theme', value: 'light', url: baseURL! }]);
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-start').click();
    let checked = { input: false, boolean: false };
    for (let i = 1; i <= 10; i++) {
      const input = page.locator('.atest-input');
      if (!checked.input && (await input.isVisible())) {
        // «ca» вместо «Ca» — неверно, с подсказкой про заглавную букву и правильным символом.
        const s = await page.getByTestId('atest-question').textContent();
        const name = /«(.+)»/.exec(s ?? '')![1];
        const symbol = chem.elements.find((e) => e.title === name)!.symbol;
        await input.fill(symbol.toLowerCase());
        await input.press('Enter');
        await expect(page.getByTestId('atest-case')).toHaveText(T.caseHint);
        await expect(page.getByTestId('atest-feedback')).toContainText(
          fill(T.correctAnswer, { answer: symbol }),
        );
        checked = { ...checked, input: true };
        await expectNoSeriousA11yViolations(page);
        await page.getByTestId('atest-next').click();
        continue;
      }
      if (!checked.boolean && (await page.locator('.atest-tf').isVisible())) {
        await page.keyboard.press('1');
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('atest-feedback')).not.toBeEmpty();
        checked = { ...checked, boolean: true };
        await expectNoSeriousA11yViolations(page);
        await page.getByTestId('atest-next').click();
        continue;
      }
      // Верные ответы поднимают уровень — на сложном есть «Впишите символ».
      await step(page, chem.elements);
    }
    await expect(page.getByTestId('atlas-quiz-result')).toBeVisible();
    test.info().annotations.push({ type: 'types', description: JSON.stringify(checked) });
  });

  test('AC-TST-12 a teacher previews «Таблица-челлендж» without records and XP; «Работа над ошибками» — no mistakes', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const chem = await chemistry(await request.newContext({ baseURL }));
    await signInAs(page, baseURL!, '/api/auth/login', TEACHER);
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-mistakes').check();
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atlas-quiz-no-mistakes')).toContainText(M.noMistakes);
    await page.getByTestId('atlas-quiz-quick').click();
    await expect(page.getByTestId('atest-progress')).toHaveText(fill(T.progress, { index: 1, count: 10 }));

    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-table').check();
    await page.getByTestId('atlas-quiz-start').click();
    await expect(page.getByTestId('atlas-quiz-preview')).toContainText(ru.atlas.preview.note);
    await page.getByTestId('atest-hint').click();
    await expect(page.locator('.atest-table-status')).toContainText(T.table.hint);
    for (let i = 1; i <= 10; i++) await step(page, chem.elements);
    await expect(page.getByTestId('atlas-quiz-result')).toBeVisible();
    await expect(page.getByTestId('atlas-quiz-xp')).toHaveCount(0);
  });
});
