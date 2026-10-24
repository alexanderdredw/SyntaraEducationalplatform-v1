import { randomUUID } from 'node:crypto';
import { expect, request, test, type BrowserContext, type Page } from '@playwright/test';
import { bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const ai = ru.student.ai;
const as = ru.student.assistant;

/** Новый ученик (самостоятельная регистрация) — сессия переносится в браузер. */
async function student(context: BrowserContext, baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/register-student', {
    data: { displayName: 'Асель', login: `ai.${randomUUID().slice(0, 8)}`, password: 'student-pass-1' },
  });
  expect(res.status()).toBe(201);
  const { cookies } = await ctx.storageState();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
  return ctx;
}

async function cardioId(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const catalog = await (await api.get('/api/public/catalog')).json();
  const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
  const section = await (await api.get(`/api/public/sections/${biology.id}`)).json();
  const anatomy = section.subjects.find((s: { title: string }) => s.title === 'Анатомия человека');
  const subject = await (await api.get(`/api/public/subjects/${anatomy.id}`)).json();
  return subject.topics.find((t: { title: string }) => t.title === 'Сердечно-сосудистая система')
    .id as string;
}

const lastAnswer = (page: Page) => page.getByTestId('tutor-assistant-message').last();

/**
 * Итерация 9 — учебный ИИ (8.4.5). Поставщик в e2e — детерминированный поток (AI_TUTOR_FIXTURE): ответ идёт по
 * словам и содержит <script>, внешнюю и внутреннюю ссылки. Режим mock (PH-19) проверяют integration-тесты.
 */
test.describe('Учебный ИИ (итерация 9)', () => {
  test('REQ-ST-AI-01, REQ-ST-AI-02 lesson tab: greeting, level, quick actions; streamed answer, sanitized links', async ({
    page,
    context,
    baseURL,
  }) => {
    await student(context, baseURL!);
    const topicId = await cardioId(baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=ai`);
    const chat = page.getByTestId('tutor-chat');
    await expect(chat.getByTestId('tutor-greeting')).toHaveText(
      ai.greeting.replace('{topic}', 'Сердечно-сосудистая система'),
    );
    await expect(chat.getByTestId('tutor-level')).toHaveText(ai.level);
    await expect(chat.getByTestId('tutor-quick').getByRole('button')).toHaveText([
      ai.quick.simpler,
      ai.quick.more_detail,
      ai.quick.check_me,
    ]);
    await expect(chat.getByPlaceholder(ai.placeholderTopic)).toBeVisible();
    await expect(chat).toContainText(ai.disclaimer);
    await expectNoSeriousA11yViolations(page);

    // Быстрое действие «Объясни проще» → сообщение ученика справа, ответ Syntara потоком.
    await chat.getByRole('button', { name: ai.quick.simpler }).click();
    const mine = chat.getByTestId('tutor-user-message').last();
    await expect(mine).toContainText(ai.you);
    await expect(mine).toContainText(ai.quickText.simpler);
    await expect(chat.getByTestId('tutor-stop')).toBeVisible();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'complete', { timeout: 15_000 });
    const answer = lastAnswer(page);
    await expect(answer).toContainText(ai.assistant);
    await expect(answer).toContainText('word40');
    // REQ-NFR-SEC-06: <script> и внешняя ссылка вырезаны, внутренняя ссылка — переход по сайту.
    await expect(answer.locator('script')).toHaveCount(0);
    await expect(answer.getByRole('link', { name: 'external' })).toHaveCount(0);
    await expect(answer.getByRole('link', { name: 'catalog' })).toHaveAttribute('href', '/ru/learn/subjects');
    await expect(chat.getByTestId('tutor-stop')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('AC-ST-06, BR-AI-04 «Остановить» during the answer → «Ответ прерван», kept after a reload', async ({
    page,
    context,
    baseURL,
  }) => {
    await student(context, baseURL!);
    const topicId = await cardioId(baseURL!);
    await page.goto(`/ru/learn/topics/${topicId}?tab=ai`);
    // Диалог открыт (API-S-11) — до этого Enter не отправляет (как в остальных сценариях).
    await expect(page.getByTestId('tutor-chat')).toHaveAttribute('data-ready', 'true');
    const input = page.getByPlaceholder(ai.placeholderTopic);
    await input.fill('Почему у сердца четыре камеры?');
    await input.press('Enter');
    await expect(lastAnswer(page)).toContainText('Fixture answer');
    await page.getByTestId('tutor-stop').click();
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'partial');
    await expect(lastAnswer(page).getByTestId('tutor-interrupted')).toHaveText(ru.ai.chat.interrupted);
    await expect(input).toHaveValue('');

    // Сообщение сохранено на сервере со status = partial (API-S-13) — видно после перезагрузки.
    await page.reload();
    await expect(page.getByTestId('tutor-user-message')).toContainText('Почему у сердца четыре камеры?');
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'partial');
    await expect(lastAnswer(page)).toContainText(ru.ai.chat.interrupted);
    await expect(lastAnswer(page)).not.toContainText('word40');
  });

  test('REQ-ST-AI-03 /learn/assistant: «Начать обучение с ИИ» focuses the field, «Как это работает», general chat', async ({
    page,
    context,
    baseURL,
  }) => {
    await student(context, baseURL!);
    await page.goto('/ru/learn/assistant');
    await expect(page.getByRole('heading', { level: 1, name: as.title })).toBeVisible();
    await expect(page.getByTestId('assistant-page')).toContainText(as.subtitle);
    const chat = page.getByTestId('tutor-chat');
    await expect(chat).toHaveAttribute('data-context', 'general_tutor');
    await expect(chat).toHaveAttribute('data-ready', 'true');
    await expect(chat.getByTestId('tutor-online')).toHaveText(as.online);
    await expect(chat).toContainText(as.mode);
    await expect(chat.getByTestId('tutor-help')).toContainText(as.helpTitle);
    await expect(chat.getByTestId('tutor-help').getByRole('listitem')).toHaveText([
      as.help.explain,
      as.help.connect,
      as.help.weak,
      as.help.tests,
      as.help.summary,
    ]);
    await expect(chat.getByTestId('tutor-quick')).toHaveCount(0);

    await page.getByTestId('assistant-start').click();
    await expect(page.getByPlaceholder(ai.placeholderGeneral)).toBeFocused();

    await page.getByTestId('assistant-how').click();
    const dialog = page.getByRole('dialog', { name: as.how });
    await expect(dialog).toContainText(ai.level);
    await expect(dialog).toContainText(ai.quickText.check_me);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('assistant-how')).toBeFocused();

    const input = page.getByPlaceholder(ai.placeholderGeneral);
    await input.fill('Что такое фотосинтез?');
    await page.getByTestId('tutor-ask').click();
    await expect(chat.getByTestId('tutor-user-message')).toContainText('Что такое фотосинтез?');
    await expect(lastAnswer(page)).toHaveAttribute('data-status', 'complete', { timeout: 15_000 });
    await expect(chat.getByTestId('tutor-help')).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test('REQ-ST-AI-02 Shift+Enter adds a new line, Enter sends', async ({ page, context, baseURL }) => {
    await student(context, baseURL!);
    await page.goto('/ru/learn/assistant');
    await expect(page.getByTestId('tutor-chat')).toHaveAttribute('data-ready', 'true');
    const input = page.getByPlaceholder(ai.placeholderGeneral);
    await input.click();
    await input.pressSequentially('строка 1');
    await input.press('Shift+Enter');
    await input.pressSequentially('строка 2');
    await expect(input).toHaveValue('строка 1\nстрока 2');
    await input.press('Enter');
    await expect(page.getByTestId('tutor-user-message')).toContainText('строка 1');
    await expect(input).toHaveValue('');
  });
});
