import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const tt = ru.teacher;
const uid = () => randomUUID().slice(0, 8);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Учитель через API в контексте страницы (cookie сессии попадают в браузер). */
async function signUpTeacher(page: Page) {
  const res = await page.request.post('/api/auth/register', {
    data: {
      role: 'teacher',
      email: `content.${uid()}@example.kz`,
      displayName: 'Учитель',
      password: 'teacher-pass-1',
    },
  });
  expect(res.status()).toBe(201);
}

const csrf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'csrf')!.value;

async function apiPost(page: Page, path: string, data: object = {}) {
  const res = await page.request.post(path, { data, headers: { 'X-CSRF-Token': await csrf(page) } });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return res.json();
}

/** Предмет и тема-черновик через API — для сценариев редактора. */
async function subjectWithTopic(page: Page, title = 'Биология') {
  const subject = (await apiPost(page, '/api/teacher/subjects', {
    translations: { ru: { title } },
    inPublicCatalog: false,
  })) as { id: string };
  const topic = (await apiPost(page, `/api/teacher/subjects/${subject.id}/topics`)) as { id: string };
  return { subjectId: subject.id, topicId: topic.id };
}

test.describe('Кабинет учителя: контент (итерация 7)', () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await acceptCookies(context, baseURL);
    await signUpTeacher(page);
  });

  test('AC-TCH-01, REQ-TCH-SUBJ-01, REQ-GEN-PREF-05 a subject with only a KK title; RU/EN input survives tab switches', async ({
    page,
  }) => {
    await page.goto('/ru/teacher/courses');
    await page.getByRole('link', { name: tt.courses.newSubject }).click();
    await expect(page.getByRole('heading', { level: 1, name: tt.subjectForm.newTitle })).toBeVisible();
    const form = page.getByTestId('subject-form');
    const tab = (code: string) => form.getByRole('radio', { name: new RegExp(`^${code}`) });
    const title = form.getByLabel(tt.subjectForm.name, { exact: true });

    await tab('RU').click();
    await title.fill('Черновое название');
    await tab('EN').click();
    await title.fill('Draft title');
    await tab('KK').click();
    await title.fill('Биология');
    // Ввод на других вкладках не потерян.
    await tab('RU').click();
    await expect(title).toHaveValue('Черновое название');
    await tab('EN').click();
    await expect(title).toHaveValue('Draft title');
    // Оставляем только KK.
    await title.fill('');
    await tab('RU').click();
    await title.fill('');
    await page.getByTestId('subject-submit').click();

    await expect(page).toHaveURL(/\/ru\/teacher\/subjects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Биология' })).toBeVisible();
    await expect(page.getByText(tt.subject.noTopics)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('REQ-TCH-SUBJ-02 no title in any language → hint as an error, nothing created', async ({ page }) => {
    await page.goto('/ru/teacher/subjects/new');
    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/teacher/subjects')) posted = true;
    });
    await page.getByTestId('subject-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: tt.subjectForm.hint })).toBeVisible();
    expect(posted).toBe(false);
    await expect(page).toHaveURL(/subjects\/new$/);
  });

  test('REQ-TCH-ACC-01/02, REQ-GEN-SHELL-03 grant to a class and revoke; add a topic → editor', async ({
    page,
  }) => {
    await apiPost(page, '/api/teacher/classes', { name: '7 «А»' });
    const { subjectId } = await subjectWithTopic(page, 'Химия');
    await page.goto(`/ru/teacher/subjects/${subjectId}`);
    await expect(page.getByText(tt.subject.accessHint)).toBeVisible();
    // «Мои курсы» активен в боковой панели и на странице предмета.
    await expect(
      page.getByTestId('cabinet-sidebar').getByRole('link', { name: ru.cabinet.nav.courses }),
    ).toHaveAttribute('aria-current', 'page');
    const row = page.getByTestId('access-class').filter({ hasText: '7 «А»' });
    await row.getByRole('button', { name: tt.subject.grant }).click();
    await expect(row.getByText(tt.subject.granted)).toBeVisible();
    await row.getByRole('button', { name: tt.subject.revoke }).click();
    await expect(row.getByRole('button', { name: tt.subject.grant })).toBeVisible();

    await expect(page.getByTestId('subject-topic')).toHaveCount(1);
    await expect(page.getByTestId('subject-topic').first()).toContainText(tt.subject.untitled);
    await page.getByRole('button', { name: tt.subject.addTopic }).click();
    await expect(page).toHaveURL(/\/ru\/teacher\/topics\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: tt.topic.newTitle })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-TCH-04, REQ-TCH-TOP-02 the AI draft fills RU and KK in the form; nothing is saved', async ({
    page,
  }) => {
    const { topicId } = await subjectWithTopic(page);
    await page.goto(`/ru/teacher/topics/${topicId}`);
    const editor = page.getByTestId('topic-editor');
    const tab = (code: string) => editor.getByRole('radio', { name: new RegExp(`^${code}`) });
    await editor.getByLabel(tt.topic.name, { exact: true }).fill('Как работает сердце');
    await page.getByTestId('ai-draft').click();
    await expect(page.getByTestId('ai-status')).toHaveText(tt.topic.aiFilled);
    await expect(editor.getByLabel(tt.topic.description, { exact: true })).toHaveValue(/Как работает сердце/);
    await expect(editor.getByLabel(tt.topic.funFact, { exact: true })).not.toHaveValue('');
    await tab('KK').click();
    await expect(editor.getByLabel(tt.topic.description, { exact: true })).toHaveValue(/Как работает сердце/);
    await expect(editor.getByLabel(tt.topic.body, { exact: true })).toHaveValue(/## Как работает сердце/);

    // Тема не сохранена и не опубликована.
    const saved = await (await page.request.get(`/api/teacher/topics/${topicId}`)).json();
    expect(saved.translations).toEqual({});
    expect(saved.status).toBe('draft');
    await expect(page.getByTestId('topic-status')).toHaveText(tt.topic.statusDraft);
  });

  test('REQ-TCH-TOP-03/06, REQ-TCH-PUB-01..05 save, Markdown preview, publish, versions, student view, unpublish', async ({
    page,
  }) => {
    const { topicId } = await subjectWithTopic(page);
    await page.goto(`/ru/teacher/topics/${topicId}`);
    const editor = page.getByTestId('topic-editor');
    await editor.getByLabel(tt.topic.name, { exact: true }).fill('Строение сердца');
    await editor.getByLabel(tt.topic.description, { exact: true }).fill('Четыре камеры');
    await editor
      .getByLabel(tt.topic.body, { exact: true })
      .fill('## Камеры\n\n- **предсердия**\n\n<script>window.x=1</script>');
    await page.getByTestId('markdown-preview-tab').click();
    const preview = page.getByTestId('markdown-preview');
    await expect(preview.getByRole('heading', { name: 'Камеры' })).toBeVisible();
    await expect(preview.locator('strong')).toHaveText('предсердия');
    await expect(preview.locator('script')).toHaveCount(0);

    await page.getByTestId('topic-save').click();
    await expect(page.getByTestId('topic-save-status')).toHaveText(tt.topic.saved);
    await expect(page.getByTestId('topic-status')).toHaveText(tt.topic.statusDraft);

    await page.getByLabel(tt.topic.changeNote).fill('Первая версия');
    await page.getByTestId('publish').click();
    await expect(page.getByTestId('publish-status')).toHaveText(
      tt.topic.publishedDone.replace('{version}', '1'),
    );
    await expect(page.getByTestId('topic-status')).toHaveText(tt.topic.statusPublished);

    await page.getByRole('button', { name: tt.topic.preview }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('lesson-view')).toContainText('Строение сердца');
    await expect(dialog.getByRole('heading', { name: 'Камеры' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: tt.topic.history }).click();
    await expect(page.getByTestId('versions')).toContainText('Первая версия');
    await page.keyboard.press('Escape');

    await page.getByTestId('unpublish').click();
    await expect(page.getByTestId('topic-status')).toHaveText(tt.topic.statusDraft);
  });

  test('BR-FILE-01/02, REQ-TCH-TOP-04/05 cover upload is selected; a material shows its check status', async ({
    page,
  }) => {
    const { topicId } = await subjectWithTopic(page);
    await page.goto(`/ru/teacher/topics/${topicId}`);
    await page.getByTestId('topic-editor').getByLabel(tt.topic.name, { exact: true }).fill('С файлами');
    await page
      .getByTestId('cover-file')
      .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId('gallery-item')).toHaveCount(1);
    await expect(page.getByTestId('gallery-item')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('material-file').setInputFiles({
      name: 'Конспект.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Сердце: четыре камеры'),
    });
    const material = page.getByTestId('material');
    await expect(material).toHaveCount(1);
    // Без worker файл остаётся «Проверяется»; с worker — становится «Готов».
    await expect(material).toContainText(new RegExp(`${tt.topic.scan.pending}|${tt.topic.scan.clean}`));

    await page
      .getByTestId('material-file')
      .setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
    await expect(page.getByTestId('material-errors')).toContainText(ru.validation.fileSignature);

    await page.getByTestId('topic-save').click();
    await expect(page.getByTestId('topic-save-status')).toHaveText(tt.topic.saved);
    const saved = await (await page.request.get(`/api/teacher/topics/${topicId}`)).json();
    expect(saved.coverMediaId).toEqual(expect.any(String));
    expect(saved.materials.map((m: { name: string }) => m.name)).toEqual(['Конспект.txt']);
  });

  test('AC-TCH-07, REQ-TCH-QZ-01..04 one option or no correct one → error and no question; a valid one is created', async ({
    page,
  }) => {
    const { topicId } = await subjectWithTopic(page);
    await page.goto(`/ru/teacher/topics/${topicId}/quiz`);
    const form = page.getByTestId('question-form').first();
    let created = 0;
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes('/quiz/questions') && r.status() === 201)
        created += 1;
    });
    await form.getByLabel(tt.quiz.text, { exact: true }).fill('Какая камера направляет кровь в аорту?');
    await form.getByLabel(tt.quiz.option.replace('{number}', '1'), { exact: true }).fill('Левый желудочек');
    await form.getByLabel(tt.quiz.option.replace('{number}', '2'), { exact: true }).fill('Правое предсердие');

    // Правильный не отмечен.
    await page.getByTestId('question-submit').first().click();
    await expect(form.getByTestId('options-error')).toHaveText(ru.validation.exactlyOneCorrect);

    // Один вариант.
    await form
      .getByRole('radio', { name: `${tt.quiz.correct}: ${tt.quiz.option.replace('{number}', '1')}` })
      .check();
    await form.getByRole('button', { name: tt.quiz.removeOption.replace('{number}', '2') }).click();
    await page.getByTestId('question-submit').first().click();
    await expect(form.getByTestId('options-error')).toHaveText(ru.validation.min2);
    expect(created).toBe(0);
    await expect(page.getByText(tt.quiz.empty)).toBeVisible();

    // Исправляем: второй вариант и создание.
    await form.getByRole('button', { name: tt.quiz.addOption }).click();
    await form.getByLabel(tt.quiz.option.replace('{number}', '2'), { exact: true }).fill('Правое предсердие');
    await form
      .getByLabel(tt.quiz.explanation, { exact: true })
      .fill('Левый желудочек выталкивает кровь в аорту');
    await expect(form.getByTestId('question-option').first()).toHaveAttribute('data-correct', 'true');
    await page.getByTestId('question-submit').first().click();
    await expect(page.getByTestId('quiz-status')).toHaveText(tt.quiz.created);
    await expect(page.getByTestId('quiz-question')).toHaveCount(1);
    expect(created).toBe(1);
    await expectNoSeriousA11yViolations(page);

    // «Верно/Неверно» — фиксированные варианты.
    await form.getByRole('radio', { name: tt.quiz.types.true_false }).click();
    await form.getByLabel(tt.quiz.text, { exact: true }).fill('Сердце — мышца');
    await form
      .getByRole('radio', { name: `${tt.quiz.correct}: ${tt.quiz.option.replace('{number}', '1')}` })
      .check();
    await page.getByTestId('question-submit').first().click();
    await expect(page.getByTestId('quiz-question')).toHaveCount(2);
    await expect(page.getByTestId('quiz-question').nth(1)).toContainText(tt.quiz.optionTrue);

    // Архивирование.
    await page.getByTestId('quiz-question').nth(1).getByRole('button', { name: tt.quiz.archive }).click();
    await page.getByTestId('archive-confirm').click();
    await expect(page.getByTestId('quiz-question')).toHaveCount(1);
  });

  test('BR-ACL-01 another teacher’s topic page → 404; pages fit 320 px', async ({
    page,
    browser,
    baseURL,
  }) => {
    const { topicId, subjectId } = await subjectWithTopic(page);
    const other = await browser.newContext({ baseURL });
    await acceptCookies(other, baseURL);
    const otherPage = await other.newPage();
    await signUpTeacher(otherPage);
    const res = await otherPage.goto(`/ru/teacher/topics/${topicId}`);
    expect(res?.status()).toBe(404);
    expect((await otherPage.goto(`/ru/teacher/subjects/${subjectId}`))?.status()).toBe(404);
    await other.close();

    for (const path of [
      `/ru/teacher/topics/${topicId}`,
      `/ru/teacher/subjects/${subjectId}`,
      `/ru/teacher/topics/${topicId}/quiz`,
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await hasHorizontalScroll(page), path).toBe(false);
    }
  });
});
