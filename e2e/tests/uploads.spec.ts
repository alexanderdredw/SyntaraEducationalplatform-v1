import { randomUUID } from 'node:crypto';
import { expect, request, test } from '@playwright/test';
import { attachLegacySpreadsheet, mediaFilesOf } from './db';
import { makePng, makePptx, makeXlsx } from './files';
import { acceptCookies, bundles } from './support';

const ru = bundles.ru;
const tt = ru.teacher;
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Регрессия (2026-10-24): в редакторе темы обложка и материалы не загружались — «Файл не загрузился». Причина —
 * CSP без адреса хранилища (web не получал S3_ENDPOINT). Здесь — настоящая загрузка из браузера в MinIO по
 * подписанной ссылке (API-T-16/17), проверка worker (ClamAV, olevba; BR-FILE-03) и статус «Готов». Нужны web,
 * api, worker, MinIO, ClamAV и olevba — без заглушек хранилища и проверки.
 */
test.describe('Загрузка файлов учителем (7.8)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('BR-FILE-01..03, BR-FILE-07 cover and materials with Cyrillic, spaces and an em dash → MinIO → «Готов»; the name is kept, the key is safe', async ({
    page,
    context,
    baseURL,
  }) => {
    test.slow();
    const email = `upload.${randomUUID().slice(0, 8)}@example.kz`;
    const teacher = await request.newContext({ baseURL });
    expect(
      (
        await teacher.post('/api/auth/register', {
          data: { role: 'teacher', email, displayName: 'Учитель', password: 'teacher-pass-1' },
        })
      ).status(),
    ).toBe(201);
    const csrf = (await teacher.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
    const post = async (path: string, data: object = {}) =>
      (await teacher.post(path, { data, headers: { 'X-CSRF-Token': csrf } })).json();
    const subject = await post('/api/teacher/subjects', {
      translations: { ru: { title: 'Алгебра' } },
      inPublicCatalog: false,
    });
    const topic = await post(`/api/teacher/subjects/${subject.id}/topics`);
    const { cookies } = await teacher.storageState();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL! })));

    const failures: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') failures.push(m.text());
    });
    await page.goto(`/ru/teacher/topics/${topic.id}`);

    // Обложка: имя с кириллицей, пробелами и длинным тире.
    const coverName = 'Обложка — урок 1.png';
    await page
      .getByTestId('cover-file')
      .setInputFiles({ name: coverName, mimeType: 'image/png', buffer: makePng(800, 450) });
    const cover = page.getByTestId('gallery-item');
    await expect(cover).toHaveCount(1);
    await expect(cover).toHaveAttribute('aria-pressed', 'true');
    // «Готов» — картинка показывается из хранилища (до проверки — подпись статуса).
    await expect(cover.locator('img')).toBeVisible({ timeout: 60_000 });

    // Материалы: русское имя (как у учителя) и латинское.
    const ruName = 'Формулы I четверти — 9 класс.pptx';
    const enName = 'formulas-q1.pptx';
    for (const name of [ruName, enName]) {
      await page
        .getByTestId('material-file')
        .setInputFiles({ name, mimeType: PPTX_MIME, buffer: makePptx() });
      await expect(page.getByTestId('material').filter({ hasText: name })).toHaveCount(1);
    }
    await expect(page.getByTestId('topic-materials').getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('material-errors')).toHaveCount(0);

    // Статус «Готов» после проверки worker — видно после перезагрузки редактора.
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId('material').filter({ hasText: ruName })).toContainText(
        tt.topic.scan.clean,
        { timeout: 2_000 },
      );
      await expect(page.getByTestId('material').filter({ hasText: enName })).toContainText(
        tt.topic.scan.clean,
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 90_000 });
    expect(failures.filter((f) => /Content Security Policy|Fetch API cannot load/.test(f))).toEqual([]);

    // Имя для пользователя — как есть; ключ объекта — безопасный (вид + uuid, без имени файла).
    const rows = await mediaFilesOf(email);
    expect(rows.map((r) => [r.kind, r.originalName, r.scanStatus])).toEqual([
      ['cover', coverName, 'clean'],
      ['material', ruName, 'clean'],
      ['material', enName, 'clean'],
    ]);
    for (const r of rows) expect(r.storageKey).toMatch(/^(cover|material)\/[0-9a-f-]{36}$/);

    // Скачивание: имя в Content-Disposition (RFC 5987) — с кириллицей, пробелами и тире.
    const href = await page
      .getByTestId('material')
      .filter({ hasText: ruName })
      .getByRole('link', { name: ruName })
      .getAttribute('href');
    const download = await page.request.get(href!);
    expect(download.status()).toBe(200);
    const disposition = download.headers()['content-disposition']!;
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)![1]!;
    expect(decodeURIComponent(encoded)).toBe(ruName);
    expect((await download.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('BR-FILE-09 spreadsheets: not offered in the file picker, refused at once before upload; an old one is marked for the teacher', async ({
    page,
    context,
    baseURL,
  }) => {
    const email = `sheets.${randomUUID().slice(0, 8)}@example.kz`;
    const teacher = await request.newContext({ baseURL });
    await teacher.post('/api/auth/register', {
      data: { role: 'teacher', email, displayName: 'Учитель', password: 'teacher-pass-1' },
    });
    const csrf = (await teacher.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
    const post = async (path: string, data: object = {}) =>
      (await teacher.post(path, { data, headers: { 'X-CSRF-Token': csrf } })).json();
    const subject = await post('/api/teacher/subjects', {
      translations: { ru: { title: 'Таблицы' } },
      inPublicCatalog: false,
    });
    const topic = await post(`/api/teacher/subjects/${subject.id}/topics`);
    await attachLegacySpreadsheet(topic.id, email);
    const { cookies } = await teacher.storageState();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL! })));

    const uploadRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/files/upload-url')) uploadRequests.push(r.url());
    });
    await page.goto(`/ru/teacher/topics/${topic.id}`);

    // Окно выбора файла: только PDF, DOCX, PPTX, ODT, TXT; обложка и картинки — только изображения.
    expect(await page.getByTestId('material-file').getAttribute('accept')).toBe('.pdf,.docx,.pptx,.odt,.txt');
    expect(await page.getByTestId('cover-file').getAttribute('accept')).not.toMatch(/xls|csv|ods|sheet/);
    await expect(page.getByTestId('topic-materials')).toContainText(tt.topic.materialsHint);

    // Таблица, выбранная в обход фильтра, и книга Excel под видом .docx — сообщение сразу, запроса нет.
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await page.getByTestId('material-file').setInputFiles([
      { name: 'Оценки.xlsx', mimeType: 'application/vnd.ms-excel', buffer: makeXlsx() },
      { name: 'Список.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n1;2\n') },
      { name: 'Конспект.docx', mimeType: docxMime, buffer: makeXlsx() },
    ]);
    const errors = page.getByTestId('material-errors');
    for (const name of ['Оценки.xlsx', 'Список.csv', 'Конспект.docx']) {
      await expect(errors).toContainText(`${name}: ${ru.validation.fileTypeNotAllowed}`);
    }
    expect(uploadRequests).toEqual([]);

    // Старая таблица: пометка «Формат больше не поддерживается» и «✕».
    const legacy = page.getByTestId('material').filter({ hasText: 'Оценки.xlsx' });
    await expect(legacy.getByTestId('material-not-supported')).toHaveText(tt.topic.formatNotSupported);
    await legacy.getByRole('button', { name: tt.topic.removeFile.replace('{name}', 'Оценки.xlsx') }).click();
    await expect(page.getByTestId('material')).toHaveCount(0);
  });
});
