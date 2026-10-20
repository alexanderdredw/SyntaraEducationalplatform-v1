import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const tb = ru.battle.teacher;
const uid = () => randomUUID().slice(0, 8);

async function signUpTeacher(page: Page) {
  const res = await page.request.post('/api/auth/register', {
    data: {
      role: 'teacher',
      email: `battle.${uid()}@example.kz`,
      displayName: 'Учитель',
      password: 'teacher-pass-1',
    },
  });
  expect(res.status()).toBe(201);
}

const addQuestion = (page: Page) =>
  page.getByRole('button', { name: tb.editor.addQuestion.replace(/^\+\s*/, ''), exact: true }).click();
const saved = (page: Page) => expect(page.getByTestId('battle-save-state')).toHaveText(tb.editor.saved);

/** Заполняет последний вопрос в редакторе: текст и варианты, правильный — `correct` (0-based). */
async function fillLastQuestion(page: Page, text: string, options: string[], correct: number) {
  const card = page.getByTestId('battle-question').last();
  await card.getByLabel(tb.editor.questionText).fill(text);
  for (const [i, value] of options.entries()) {
    if (i >= 2) await card.getByRole('button', { name: tb.editor.addOption }).click();
    await card.getByLabel(tb.editor.option.replace('{letter}', 'ABCD'[i]!), { exact: true }).fill(value);
  }
  await card.getByRole('radio', { name: tb.editor.correctFor.replace('{letter}', 'ABCD'[correct]!) }).check();
  return card;
}

/** Итерация 10.5, этап B1: «Мои Battle» и редактор Battle-теста (REQ-BTL-T01, REQ-BTL-T02, AC-BTL-01). */
test.describe('Battle: тесты учителя (B1)', () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await acceptCookies(context, baseURL);
    await signUpTeacher(page);
  });

  test('REQ-BTL-T01, REQ-BTL-T02, AC-BTL-01 create a test, add questions, import 2 from a topic, reorder, autosave', async ({
    page,
  }) => {
    await page.goto('/ru/teacher/courses');
    await page.getByTestId('cabinet-sidebar').getByRole('link', { name: ru.cabinet.nav.battle }).click();
    await expect(page).toHaveURL(/\/ru\/teacher\/battles$/);
    await expect(page.getByRole('heading', { level: 1, name: tb.list.title })).toBeVisible();
    await expect(page.getByText(tb.list.emptyTitle)).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('button', { name: tb.list.new }).click();
    await page.getByRole('dialog').getByLabel(tb.editor.name).fill('Сердце и сосуды');
    await page.getByRole('dialog').getByRole('button', { name: tb.create.submit }).click();
    await expect(page.getByRole('heading', { level: 1, name: tb.editor.title })).toBeVisible();
    await expect(page.getByTestId('battle-readiness')).toHaveText(tb.editor.noQuestions);

    // Три своих вопроса: выбор варианта (4 варианта), ещё один выбор и «Верно/Неверно».
    await addQuestion(page);
    await fillLastQuestion(page, 'Сколько камер в сердце человека?', ['2', '3', '4', '5'], 2);
    await saved(page);
    await addQuestion(page);
    await fillLastQuestion(page, 'Что несёт кровь от сердца?', ['Артерии', 'Вены'], 0);
    await saved(page);
    await addQuestion(page);
    const tf = page.getByTestId('battle-question').last();
    await tf.getByLabel(tb.editor.questionText).fill('Сердце — мышца');
    await tf.getByRole('radio', { name: ru.teacher.quiz.types.true_false }).click();
    await tf.getByRole('radio', { name: tb.editor.seconds.replace('{n}', '10') }).click();
    await saved(page);

    // Импорт двух вопросов базовой темы.
    await page.getByRole('button', { name: tb.editor.import }).click();
    const modal = page.getByTestId('battle-import');
    await modal.getByRole('combobox', { name: tb.import.subject }).click();
    await page.getByRole('option', { name: new RegExp('Анатомия человека') }).click();
    await modal.getByRole('combobox', { name: tb.import.topic }).click();
    await page.getByRole('option', { name: /Сердечно-сосудистая система/ }).click();
    await modal.getByRole('checkbox', { name: tb.import.all }).click(); // снять все
    const boxes = modal.getByRole('checkbox');
    await boxes.nth(1).click();
    await boxes.nth(2).click();
    await modal.getByRole('button', { name: tb.import.submit }).click();
    await expect(page.getByTestId('battle-question')).toHaveCount(5);
    await expect(page.getByTestId('battle-question').filter({ hasText: tb.editor.imported })).toHaveCount(2);
    await expect(page.getByTestId('battle-readiness')).toHaveText(
      tb.editor.ready.replace(/\{count.*\}\}/, '5 вопросов'),
    );

    // ↑ для второго вопроса — порядок сохраняется на сервере.
    await page.getByRole('button', { name: tb.editor.moveUp.replace('{number}', '2') }).click();
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('battle-question').first().getByLabel(tb.editor.questionText)).toHaveValue(
      'Что несёт кровь от сердца?',
    );
    await expect(page.getByTestId('battle-question').nth(2)).toContainText(ru.teacher.quiz.optionTrue);
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expectNoSeriousA11yViolations(page);

    // Удаление вопроса с подтверждением.
    await page.getByRole('button', { name: tb.editor.delete.replace('{number}', '5') }).click();
    await page.getByRole('dialog').getByRole('button', { name: tb.editor.deleteConfirm }).click();
    await expect(page.getByTestId('battle-question')).toHaveCount(4);

    // Ошибка: без правильного варианта нельзя — вопрос помечен «Не сохранено».
    await addQuestion(page);
    const bad = page.getByTestId('battle-question').last();
    await bad.getByLabel(tb.editor.questionText).fill('Без вариантов');
    await expect(bad).toHaveAttribute('data-state', 'invalid');
    await expect(bad.getByText(tb.editor.unsaved)).toBeVisible();
    await expect(page.getByTestId('battle-readiness')).toContainText('5');
  });

  test('REQ-BTL-T01 list: card counts, duplicate, archive and restore', async ({ page }) => {
    const csrf = (await page.context().cookies()).find((c) => c.name === 'csrf')!.value;
    const headers = { 'X-CSRF-Token': csrf };
    const created = await page.request.post('/api/teacher/battles', {
      data: { title: 'Клетка', locale: 'ru' },
      headers,
    });
    const { id } = (await created.json()) as { id: string };
    await page.request.post(`/api/teacher/battles/${id}/questions`, {
      headers,
      data: {
        type: 'single_choice',
        text: 'Q',
        timeLimitSec: 20,
        options: [
          { text: 'A', isCorrect: true },
          { text: 'B', isCorrect: false },
        ],
      },
    });
    await page.goto('/ru/teacher/battles');
    const card = page.getByTestId('battle-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Клетка');
    await expect(card).toContainText('1 вопрос');
    await expect(card).toContainText(tb.list.neverPlayed);

    await card.getByRole('button', { name: tb.list.more.replace('{title}', 'Клетка') }).click();
    await page.getByRole('menuitem', { name: tb.list.duplicate }).click();
    await expect(page.getByTestId('battles-status')).toHaveText(tb.list.duplicated);
    await expect(page.getByTestId('battle-card')).toHaveCount(2);

    await page
      .getByTestId('battle-card')
      .first()
      .getByRole('button', { name: /Клетка/ })
      .click();
    await page.getByRole('menuitem', { name: tb.list.archive }).click();
    await expect(page.getByTestId('battle-card')).toHaveCount(1);
    await page.getByRole('radio', { name: tb.list.archived }).click();
    await expect(page.getByTestId('battle-card')).toHaveCount(1);
    await page
      .getByTestId('battle-card')
      .getByRole('button', { name: /Клетка/ })
      .click();
    await page.getByRole('menuitem', { name: tb.list.unarchive }).click();
    await expect(page.getByText(tb.list.emptyArchive)).toBeVisible();
    await page.getByRole('radio', { name: tb.list.active }).click();
    await expect(page.getByTestId('battle-card')).toHaveCount(2);

    await page.getByTestId('battle-card').first().getByRole('link', { name: tb.list.edit }).click();
    await expect(page.getByRole('heading', { level: 1, name: tb.editor.title })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('BR-BTL-12 another teacher’s test → 404 page', async ({ page, browser, baseURL }) => {
    const csrf = (await page.context().cookies()).find((c) => c.name === 'csrf')!.value;
    const created = await page.request.post('/api/teacher/battles', {
      data: { title: 'Чужой', locale: 'ru' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const { id } = (await created.json()) as { id: string };
    const other = await browser.newContext({ baseURL });
    const otherPage = await other.newPage();
    await acceptCookies(other, baseURL);
    await signUpTeacher(otherPage);
    const res = await otherPage.goto(`/ru/teacher/battles/${id}`);
    expect(res?.status()).toBe(404);
    await other.close();
  });
});
