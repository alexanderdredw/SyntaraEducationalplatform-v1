import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { makePng } from './files';
import { acceptCookies, bundles, expectNoSeriousA11yViolations, hasHorizontalScroll } from './support';

const ru = bundles.ru;
const td = ru.teacher.delete;
const tt = ru.teacher;

/** Учитель через API: предмет с опубликованной темой и черновиками; картинки галереи — настоящая загрузка. */
async function setup(baseURL: string) {
  const teacher = await request.newContext({ baseURL });
  expect(
    (
      await teacher.post('/api/auth/register', {
        data: {
          role: 'teacher',
          email: `del.${randomUUID().slice(0, 8)}@example.kz`,
          displayName: 'Алия Сапарова',
          password: 'teacher-pass-1',
        },
      })
    ).status(),
  ).toBe(201);
  const csrf = (await teacher.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
  const call = async (method: string, path: string, data: object = {}) => {
    const res = await teacher.fetch(path, { method, data, headers: { 'X-CSRF-Token': csrf } });
    expect(res.status(), `${method} ${path} ${await res.text()}`).toBeLessThan(300);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  const subject = await call('POST', '/api/teacher/subjects', {
    translations: { ru: { title: 'Химия' } },
    inPublicCatalog: false,
  });
  const topic = async (title?: string) => {
    const t = await call('POST', `/api/teacher/subjects/${subject.id}/topics`);
    if (title)
      await call('PUT', `/api/teacher/topics/${t.id}`, { translations: { ru: { title } }, materialIds: [] });
    return t.id as string;
  };
  const cover = async (name: string) => {
    const bytes = makePng(160, 90);
    const issued = await call('POST', '/api/files/upload-url', {
      kind: 'cover',
      fileName: name,
      mime: 'image/png',
      size: bytes.length,
    });
    const put = await fetch(issued.uploadUrl, {
      method: 'PUT',
      headers: issued.headers,
      body: new Uint8Array(bytes),
    });
    expect(put.status).toBe(200);
    await call('POST', `/api/files/${issued.mediaId}/complete`);
    return issued.mediaId as string;
  };
  return { teacher, call, subjectId: subject.id as string, topic, cover };
}

async function signIn(page: Page, ctx: APIRequestContext, baseURL: string) {
  const { cookies } = await ctx.storageState();
  await page.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL })));
}

test.describe('Удаление черновиков и картинок галереи (docs/DELETE_TZ.md)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-DEL-01/02/04 a draft is deleted from the subject page and from the editor; a published topic has no trash; numbering has no gaps', async ({
    page,
    baseURL,
  }) => {
    const s = await setup(baseURL!);
    const published = await s.topic('Строение атома');
    await s.call('POST', `/api/teacher/topics/${published}/publish`);
    const first = await s.topic();
    const second = await s.topic('Окисление');
    await signIn(page, s.teacher, baseURL!);

    await page.goto(`/ru/teacher/subjects/${s.subjectId}`);
    const rows = page.getByTestId('subject-topics').getByRole('listitem');
    await expect(rows).toHaveCount(3);
    // Корзина — только у черновиков (BR-DEL-01).
    await expect(rows.nth(0).getByTestId('delete-topic')).toHaveCount(0);
    const trash = rows.nth(1).getByRole('button', {
      name: td.topicAria.replace('{title}', tt.subject.untitled),
    });
    await expect(trash).toBeVisible();

    // Окно подтверждения: фокус — на «Отмена»; «Отмена» ничего не удаляет.
    await trash.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: td.topicConfirmTitle.replace('{title}', tt.subject.untitled),
    });
    await expect(dialog).toContainText(td.topicConfirmText);
    await expect(dialog.getByRole('button', { name: td.cancel, exact: true })).toBeFocused();
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(3);

    await trash.click();
    await dialog.getByRole('button', { name: td.confirm, exact: true }).click();
    await expect(rows).toHaveCount(2);
    // «Тема N» без пропусков (BR-DEL-03).
    await expect(rows.nth(1)).toContainText(tt.subject.number.replace('{number}', '2'));
    await expect(rows.nth(1)).toContainText('Окисление');

    // Из редактора: «Удалить черновик» → подтверждение → страница предмета и «Черновик удалён».
    await page.goto(`/ru/teacher/topics/${second}`);
    await page.getByRole('button', { name: td.topicButton }).click();
    await page
      .getByRole('dialog', { name: td.topicConfirmTitle.replace('{title}', 'Окисление') })
      .getByRole('button', { name: td.confirm, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/ru/teacher/subjects/${s.subjectId}$`));
    // Radix Toast дублирует текст для экранного диктора (aria-live) — видимое уведомление первое.
    await expect(page.getByText(td.topicDeleted).first()).toBeVisible();
    await expect(rows).toHaveCount(1);
    // У опубликованной темы в редакторе кнопки нет; API — 409 topicHasHistory.
    await page.goto(`/ru/teacher/topics/${published}`);
    await expect(page.getByTestId('topic-save')).toBeVisible();
    await expect(page.getByTestId('delete-topic')).toHaveCount(0);
    expect((await s.teacher.get(`/api/teacher/topics/${first}`)).status()).toBe(404);
  });

  test('AC-DEL-05/06/09 gallery: «✕» deletes a free image after confirmation; a used cover has an inactive «✕» with a hint; images become «Готов»', async ({
    page,
    baseURL,
  }) => {
    test.slow();
    const s = await setup(baseURL!);
    const topicId = await s.topic('Строение атома');
    const used = await s.cover('Атом.png');
    await s.cover('Колба.png');
    await s.call('PUT', `/api/teacher/topics/${topicId}`, {
      translations: { ru: { title: 'Строение атома' } },
      coverMediaId: used,
      materialIds: [],
    });
    await signIn(page, s.teacher, baseURL!);
    await page.goto(`/ru/teacher/topics/${topicId}`);
    const items = page.getByTestId('topic-cover').getByRole('listitem');
    await expect(items).toHaveCount(2);
    // AC-DEL-09: проверка завершается — миниатюры показываются (статус «Готов»), без зависания в «Проверяется».
    await expect(page.locator('[data-testid="gallery-item"] img')).toHaveCount(2, { timeout: 90_000 });

    // Используемая: «✕» неактивна, подсказка — где используется.
    const usedItem = items.filter({ has: page.getByRole('button', { name: /Атом/ }) });
    const usedX = usedItem.getByTestId('gallery-delete');
    await expect(usedX).toHaveAttribute('aria-disabled', 'true');
    await expect(usedX).toHaveAccessibleDescription(td.usedInTopic.replace('{title}', 'Строение атома'));
    await usedX.focus();
    await expect(usedItem.getByTestId('gallery-used-hint')).toBeVisible();
    // Неактивна: Enter на ней не открывает подтверждение.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('confirm-delete')).toHaveCount(0);

    // Свободная: подтверждение «Удалить изображение из галереи?» → удалена.
    const freeItem = items.filter({ has: page.getByRole('button', { name: /Колба/ }) });
    await freeItem.getByRole('button', { name: td.imageAria }).click();
    const dialog = page.getByRole('dialog', { name: td.imageConfirmTitle });
    await expect(dialog.getByRole('button', { name: td.cancel, exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: td.confirm, exact: true }).click();
    await expect(items).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
  });

  test('AC-DEL-08 «Убрать обложку»: the topic has no cover; the student view shows no empty picture; the image can then be deleted', async ({
    page,
    baseURL,
  }) => {
    const s = await setup(baseURL!);
    const topicId = await s.topic('Строение атома');
    const image = await s.cover('Атом.png');
    await s.call('PUT', `/api/teacher/topics/${topicId}`, {
      translations: { ru: { title: 'Строение атома' } },
      coverMediaId: image,
      materialIds: [],
    });
    await signIn(page, s.teacher, baseURL!);
    await page.goto(`/ru/teacher/topics/${topicId}`);
    await page.getByRole('button', { name: td.removeCover }).click();
    await expect(page.getByTestId('gallery-item')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('topic-save').click();
    await expect(page.getByTestId('topic-save-status')).toHaveText(tt.topic.saved);
    await expect(page.getByRole('button', { name: td.removeCover })).toHaveCount(0);
    await page.getByRole('button', { name: tt.topic.preview }).click();
    const view = page.getByRole('dialog').getByTestId('lesson-view');
    await expect(view).toContainText('Строение атома');
    await expect(view.locator('img')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Теперь картинка свободна — «✕» активна.
    await page.reload();
    await expect(page.getByTestId('gallery-delete')).not.toHaveAttribute('aria-disabled', 'true');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`AC-DEL-10 phone 390 px, ${theme}: trash and «✕» are visible without hover; no horizontal scroll; axe`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
      const s = await setup(baseURL!);
      const topicId = await s.topic();
      await s.cover('Колба.png');
      await signIn(page, s.teacher, baseURL!);
      await page.goto(`/ru/teacher/subjects/${s.subjectId}`);
      await expect(page.getByTestId('delete-topic')).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
      await expectNoSeriousA11yViolations(page);
      await page.goto(`/ru/teacher/topics/${topicId}`);
      const x = page.getByTestId('gallery-delete');
      await expect(x).toBeVisible();
      expect(await x.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await expect(page.getByRole('button', { name: td.topicButton })).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
      await expectNoSeriousA11yViolations(page);
    });
  }
});
