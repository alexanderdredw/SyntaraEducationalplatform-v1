import { expect, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, switchLocale } from './support';

const ru = bundles.ru;
const d = ru.home.demo;
const c = ru.ai.chat;

const demo = (page: Page) => page.getByTestId('demo-question');
const option = (page: Page, text: string) => demo(page).getByRole('radio', { name: text });

test.describe('Пробный вопрос (SM-DEMO)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-PUB-04 the question arrives without the correct answer; «Проверить ответ» is disabled until a choice', async ({
    page,
  }) => {
    const response = page.waitForResponse((r) => r.url().includes('/api/public/demo-question'));
    await page.goto('/ru');
    const body = await (await response).text();
    expect(body).not.toMatch(/isCorrect|is_correct|correctOptionId|explanation/);
    await expect(demo(page).getByText('Какой сосуд несёт кровь от сердца к телу?')).toBeVisible();
    await expect(demo(page).getByRole('radio')).toHaveCount(4);
    const check = demo(page).getByRole('button', { name: d.check });
    await expect(check).toBeDisabled();
    await option(page, 'Капилляр').click();
    await expect(check).toBeEnabled();
  });

  test('AC-PUB-05 wrong answer: «Пока неверно» with icon, chosen and correct options marked, explanation', async ({
    page,
  }) => {
    await page.goto('/ru');
    await option(page, 'Полая вена').click();
    await demo(page).getByRole('button', { name: d.check }).click();
    const result = page.getByTestId('demo-result');
    await expect(result).toContainText(d.incorrect);
    await expect(result.locator('svg')).toHaveCount(1);
    const options = demo(page).getByTestId('demo-option');
    await expect(options.filter({ hasText: 'Полая вена' })).toHaveAttribute('data-state', 'wrong');
    await expect(options.filter({ hasText: 'Полая вена' })).toContainText(d.yourChoice);
    await expect(options.filter({ hasText: 'Аорта' })).toHaveAttribute('data-state', 'correct');
    await expect(options.filter({ hasText: 'Аорта' })).toContainText(d.correctOption);
    await expect(page.getByTestId('demo-explanation')).toContainText('Аорта — главная артерия');
    // PH-02: вопрос один — «Другой вопрос» скрыта.
    await expect(demo(page).getByRole('button', { name: d.another })).toHaveCount(0);
    await expect(demo(page).getByRole('link', { name: d.toSubject })).toHaveAttribute('href', '/ru/subjects');

    await demo(page).getByRole('button', { name: d.tryAgain }).click();
    await expect(page.getByTestId('demo-result')).toHaveCount(0);
    await expect(demo(page).getByRole('button', { name: d.check })).toBeDisabled();
    await expect(option(page, 'Полая вена')).not.toBeChecked();
  });

  test('SM-DEMO right answer → «Верно»; options are a keyboard radio group', async ({ page }) => {
    await page.goto('/ru');
    await option(page, 'Полая вена').click();
    // Radix выбирает вариант при фокусе, пока стрелка нажата: держим клавишу до проверки.
    await page.keyboard.down('ArrowUp');
    await expect(option(page, 'Аорта')).toBeFocused();
    await expect(option(page, 'Аорта')).toBeChecked();
    await page.keyboard.up('ArrowUp');
    await demo(page).getByRole('button', { name: d.check }).click();
    await expect(page.getByTestId('demo-result')).toContainText(d.correct);
    await expect(page.getByTestId('demo-result')).not.toContainText(d.incorrect);
  });

  test('SM-DEMO load error → «Не удалось загрузить вопрос» and «Повторить загрузку»', async ({ page }) => {
    await page.route('**/api/public/demo-question*', (route) => route.abort('failed'));
    await page.goto('/ru');
    await expect(demo(page).getByRole('alert')).toHaveText(d.loadError);
    await page.unroute('**/api/public/demo-question*');
    await demo(page).getByRole('button', { name: d.retryLoad }).click();
    await expect(demo(page).getByRole('radio')).toHaveCount(4);
  });

  test('REQ-NFR-A11Y-01 axe: home page with an answered demo question', async ({ page }) => {
    await page.goto('/ru');
    await option(page, 'Капилляр').click();
    await demo(page).getByRole('button', { name: d.check }).click();
    await expect(page.getByTestId('demo-result')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('Публичный помощник /ai', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  const input = (page: Page) => page.getByRole('textbox', { name: c.inputLabel });
  const lastAnswer = (page: Page) => page.getByTestId('ai-assistant-message').last();

  test('REQ-PUB-AI-01 left column texts, greeting, quick questions, placeholder and «Отправить →»', async ({
    page,
  }) => {
    await page.goto('/ru/ai');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ru.ai.title);
    const chat = page.getByTestId('ai-chat');
    await expect(chat.getByText(c.greeting)).toBeVisible();
    for (const q of ['platform', 'start', 'language', 'registration'] as const) {
      await expect(chat.getByRole('button', { name: ru.ai.quick[q].question })).toBeVisible();
    }
    await expect(input(page)).toHaveAttribute('placeholder', c.placeholder);
    await expect(chat.getByRole('button', { name: c.send })).toBeDisabled();
  });

  test('AC-PUB-06 quick question → PH-19 answer; own question → «Помощник пока недоступен…» with /support link', async ({
    page,
  }) => {
    await page.goto('/ru/ai');
    await page.getByRole('button', { name: ru.ai.quick.platform.question }).click();
    await expect(page.getByTestId('ai-user-message')).toHaveText(new RegExp(ru.ai.quick.platform.question));
    await expect(lastAnswer(page)).toContainText(ru.ai.quick.platform.answer);
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'complete');

    await input(page).fill('Как получить сертификат?');
    await input(page).press('Enter');
    await expect(lastAnswer(page)).toContainText('Помощник пока недоступен.');
    await expect(lastAnswer(page).getByRole('link', { name: c.supportLink })).toHaveAttribute(
      'href',
      '/ru/support',
    );
    await expect(page.getByTestId('ai-user-message')).toHaveCount(2);
  });

  test('REQ-PUB-AI-02 Shift+Enter adds a line, empty message is not sent, counter after 1800 characters', async ({
    page,
  }) => {
    await page.goto('/ru/ai');
    await input(page).fill('строка 1');
    await input(page).press('Shift+Enter');
    await input(page).pressSequentially('строка 2');
    await expect(input(page)).toHaveValue('строка 1\nстрока 2');
    await expect(page.getByTestId('ai-user-message')).toHaveCount(0);

    await input(page).fill('   ');
    await input(page).press('Enter');
    await expect(page.getByTestId('ai-user-message')).toHaveCount(0);

    await input(page).fill('a'.repeat(1800));
    await expect(page.getByTestId('ai-counter')).toHaveCount(0);
    await input(page).fill('a'.repeat(1801));
    await expect(page.getByTestId('ai-counter')).toHaveText('1801 / 2000');
    await expect(input(page)).toHaveAttribute('maxlength', '2000');
  });

  test('REQ-PUB-AI-03 «Готовлю ответ...» and «Остановить» → «Ответ прерван»', async ({ page }) => {
    await page.goto('/ru/ai');
    await page.getByRole('button', { name: ru.ai.quick.start.question }).click();
    await expect(page.getByText(c.thinking)).toBeVisible();
    await page.getByRole('button', { name: c.stop }).click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'partial');
    await expect(page.getByTestId('ai-interrupted')).toHaveText(c.interrupted);
    await expect(page.getByText(c.thinking)).toHaveCount(0);
  });

  test('REQ-PUB-AI-04 429 → «Слишком много вопросов…»; error → question kept and «Повторить» resends it', async ({
    page,
  }) => {
    await page.goto('/ru/ai');
    await page.route('**/api/public/assistant', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'RATE_LIMITED', retryAfterSeconds: 42 }),
      }),
    );
    await input(page).fill('Мой вопрос');
    await input(page).press('Enter');
    await expect(page.getByTestId('ai-error')).toContainText(
      'Слишком много вопросов. Попробуйте через 42 сек.',
    );
    await expect(input(page)).toHaveValue('Мой вопрос');

    await page.unroute('**/api/public/assistant');
    await page.route('**/api/public/assistant', (route) => route.abort('failed'));
    await input(page).press('Enter');
    await expect(page.getByTestId('ai-error')).toContainText(c.error);
    await expect(input(page)).toHaveValue('Мой вопрос');

    await page.unroute('**/api/public/assistant');
    await page.getByRole('button', { name: c.retry }).click();
    await expect(page.getByTestId('ai-user-message')).toHaveText(/Мой вопрос/);
    await expect(lastAnswer(page)).toContainText('Помощник пока недоступен.');
  });

  test('REQ-PUB-AI-06 history lives in the tab: survives a language switch, «Очистить диалог» empties it', async ({
    page,
  }) => {
    await page.goto('/ru/ai');
    await page.getByRole('button', { name: ru.ai.quick.language.question }).click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'complete');
    await switchLocale(page, 'en');
    await expect(page).toHaveURL(/\/en\/ai$/);
    await expect(page.getByTestId('ai-user-message')).toHaveCount(1);
    await page.getByRole('button', { name: bundles.en.ai.chat.clear }).click();
    await expect(page.getByTestId('ai-user-message')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain(
      ru.ai.quick.language.answer,
    );
  });

  test('REQ-NFR-A11Y-01 axe: /ai with a conversation', async ({ page }) => {
    await page.goto('/ru/ai');
    await page.getByRole('button', { name: ru.ai.quick.registration.question }).click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'complete');
    await expectNoSeriousA11yViolations(page);
  });
});
