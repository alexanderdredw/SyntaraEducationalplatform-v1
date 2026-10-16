// Скриншоты экранов итерации 7 (кабинет учителя: контент) и проверка сквозного сценария на реальном стеке.
// Запуск: node e2e/scripts/teacher-shots.mjs <каталог> [baseURL]
// Нужны запущенные web, api (AI_DRAFT_FIXTURE=true — для черновика ИИ), worker, MinIO, ClamAV, olevba и seed `demo`.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const uid = randomUUID().slice(0, 6);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

/** Минимальный ZIP (stored) — DOCX-фикстуры: чистый и с проектом макросов (AC-TCH-05). */
function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    local.push(h, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const DOCX = { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' };
/** Валидный PNG 320×180 с градиентом — обложка для галереи. */
function makePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row.set([200 - (x * 120) / width, 40 + (y * 60) / height, 60 + (x * 160) / width], 1 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG = makePng(320, 180);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addCookies([
  { name: 'consent', value: 'necessary', url: base },
  { name: 'theme', value: 'dark', url: base },
]);
const page = await context.newPage();
// На снимках отдельных блоков липкий хедер не должен перекрывать содержимое.
const unstickHeader = () =>
  page.addStyleTag({ content: '[data-testid=cabinet-header]{position:static !important}' });
page.on('load', () => void unstickHeader().catch(() => {}));
const shot = async (name, { fullPage = false, target } = {}) => {
  await page.waitForTimeout(300);
  if (target) await target.screenshot({ path: `${out}/${name}.png` });
  else await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  log('screenshot', name);
};
const csrf = async () => (await context.cookies()).find((c) => c.name === 'csrf').value;

// 1. Учитель, класс с учеником.
const reg = await page.request.post(`${base}/api/auth/register`, {
  data: {
    role: 'teacher',
    email: `teacher.${uid}@example.kz`,
    displayName: 'Алия Сапарова',
    password: 'teacher-pass-1',
  },
});
log('register teacher', reg.status());
const cls = await (
  await page.request.post(`${base}/api/teacher/classes`, {
    data: { name: '8 «Б»' },
    headers: { 'X-CSRF-Token': await csrf() },
  })
).json();
const code = await (
  await page.request.post(`${base}/api/teacher/classes/${cls.id}/invite-codes`, {
    headers: { 'X-CSRF-Token': await csrf() },
  })
).json();
const student = await request.newContext({ baseURL: base });
await student.post('/api/auth/register-student', {
  data: { displayName: 'Асель', login: `shots.${uid}`, password: 'student-pass-1', code: code.code },
});

// 2. «Мои курсы» → «Новый предмет».
await page.goto(`${base}/ru/teacher/courses`);
await page.getByRole('link', { name: 'Новый предмет' }).click();
const subjectForm = page.getByTestId('subject-form');
await subjectForm.getByLabel('Название', { exact: true }).fill('Биология: сердце и кровообращение');
await subjectForm
  .getByLabel('Описание', { exact: true })
  .fill('Материалы урока о строении сердца и движении крови.');
await subjectForm.getByRole('radio', { name: /^KK/ }).click();
await subjectForm.getByLabel('Название', { exact: true }).fill('Биология: жүрек және қан айналымы');
await subjectForm.getByRole('radio', { name: /^RU/ }).click();
await shot('t05-new-subject');
await page.getByTestId('subject-submit').click();
await page.waitForURL(/\/teacher\/subjects\/[0-9a-f-]{36}$/);
const subjectId = page.url().split('/').pop();
log('subject', subjectId);

// 3. Выдача классу.
await page
  .getByTestId('access-class')
  .filter({ hasText: '8 «Б»' })
  .getByRole('button', { name: 'Выдать классу' })
  .click();
await page.getByTestId('access-class').getByText('Выдан').waitFor();
await page.getByTestId('subject-access').scrollIntoViewIfNeeded();
await shot('t04-subject-access');

// 4. Тема: «+ Добавить тему» → редактор.
await page.getByRole('button', { name: '+ Добавить тему' }).click();
await page.waitForURL(/\/teacher\/topics\/[0-9a-f-]{36}$/);
const topicId = page.url().split('/').pop();
const editor = page.getByTestId('topic-editor');
await editor.getByLabel('Название', { exact: true }).fill('Как работает сердце');
await page.getByTestId('ai-draft').click();
await page.getByTestId('ai-status').getByText('Черновик ИИ добавлен').waitFor();
log('AI draft: RU description =', await editor.getByLabel('Описание', { exact: true }).inputValue());
// Учитель правит черновик.
await editor
  .getByLabel('Описание', { exact: true })
  .fill('Разбираем четыре камеры сердца и два круга кровообращения.');
await editor
  .getByLabel('Интересный факт', { exact: true })
  .fill('Клапаны помогают крови двигаться в одном направлении.');
await editor
  .getByLabel('Текст урока', { exact: true })
  .fill(
    '## Четыре камеры сердца\nСердце состоит из двух предсердий и двух желудочков. **Предсердия** принимают кровь, а *желудочки* выталкивают её в сосуды.\n\n## Два круга кровообращения\n- Малый круг — к лёгким\n- Большой круг — к органам тела\n\n## Проверьте себя\nПочему важно, чтобы кровь двигалась в одном направлении?',
  );
await shot('t06-topic-editor', { fullPage: false });
await page.getByTestId('markdown-preview-tab').click();
await shot('t06-markdown-preview', { target: page.getByTestId('markdown-preview') });
await page.getByRole('button', { name: 'Текст', exact: true }).click();

// 5. Обложка и материалы: чистые файлы, DOCX с макросом, подмена типа.
await page.getByTestId('cover-file').setInputFiles({ name: 'heart.png', mimeType: 'image/png', buffer: PNG });
await page.getByTestId('gallery-item').first().waitFor();
await page.getByTestId('material-file').setInputFiles([
  { name: 'Конспект.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%конспект\n') },
  {
    name: 'Задание.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeZip(DOCX),
  },
  {
    name: 'С макросом.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeZip({ ...DOCX, 'word/vbaProject.bin': 'Attribute VB_Name = "Module1"' }),
  },
  { name: 'Не PDF.pdf', mimeType: 'application/pdf', buffer: Buffer.from('это не pdf') },
]);
await page.getByTestId('material').nth(2).waitFor();
await shot('t07-materials-checking', { target: page.getByTestId('topic-materials') });
// Worker проверяет файлы (ClamAV + olevba); статусы обновляются сами.
for (let i = 0; i < 30; i++) {
  const statuses = await page.getByTestId('material').evaluateAll((els) => els.map((e) => e.dataset.status));
  if (!statuses.includes('pending')) break;
  await page.waitForTimeout(2000);
}
log(
  'materials:',
  JSON.stringify(
    await page
      .getByTestId('material')
      .evaluateAll((els) => els.map((e) => [e.textContent.slice(0, 40), e.dataset.status])),
  ),
);
await page.getByTestId('gallery-item').first().click();
await page.getByTestId('gallery-item').first().click();
await page.getByTestId('topic-cover').scrollIntoViewIfNeeded();
await shot('t07-cover-materials');
// ИИ заполнил KK-описание и текст — название на KK добавляет учитель.
await editor.getByRole('radio', { name: /^KK/ }).click();
await editor.getByLabel('Название', { exact: true }).fill('Жүрек қалай жұмыс істейді');
await editor.getByRole('radio', { name: /^RU/ }).click();
// Отклонённый файл убирается из темы перед сохранением.
for (const btn of await page.getByRole('button', { name: /Убрать С макросом/ }).all()) await btn.click();
await page.getByTestId('topic-save').click();
await page.getByTestId('topic-save-status').getByText('Сохранено').waitFor();

// 6. Публикация, предпросмотр, история версий.
await page.getByLabel('Что изменилось (необязательно)').fill('Первая версия урока');
await page.getByTestId('publish').click();
await page.getByTestId('publish-status').getByText('Опубликовано').waitFor();
await page.getByTestId('publish-panel').scrollIntoViewIfNeeded();
await shot('t07-publication', { target: page.getByTestId('publish-panel') });
await page.getByRole('button', { name: 'Посмотреть глазами ученика' }).click();
await page.getByRole('dialog').getByTestId('lesson-view').waitFor();
await shot('t07-preview-as-student');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'История версий' }).click();
await page.getByTestId('versions').waitFor();
await shot('t07-versions');
await page.keyboard.press('Escape');

// 7. Ученик класса видит опубликованную тему; файлы — только прошедшие проверку.
await student.post('/api/auth/login', { data: { email: `shots.${uid}`, password: 'student-pass-1' } });
const catalog = await (await student.get('/api/student/catalog')).json();
log(
  'student catalog has subject:',
  catalog.subjects.some((s) => s.id === subjectId),
);
const lesson = await (await student.get(`/api/student/topics/${topicId}`)).json();
log(
  'student lesson:',
  lesson.title,
  '| materials:',
  JSON.stringify(lesson.materials.map((m) => m.name)),
  '| cover:',
  Boolean(lesson.illustrationUrl),
);

// 8. Квиз.
await page.getByRole('link', { name: /Редактировать квиз/ }).click();
await page.waitForURL(/\/quiz$/);
const qform = page.getByTestId('question-form').first();
await qform
  .getByLabel('Текст вопроса', { exact: true })
  .fill('Какая камера сердца направляет кровь в аорту?');
await qform.getByLabel('Вариант 1', { exact: true }).fill('Левый желудочек');
await qform.getByLabel('Вариант 2', { exact: true }).fill('Правое предсердие');
await qform.getByRole('button', { name: '+ Добавить вариант' }).click();
await qform.getByLabel('Вариант 3', { exact: true }).fill('Левое предсердие');
await qform.getByRole('radio', { name: 'Правильный вариант: Вариант 1' }).check();
await qform
  .getByLabel('Объяснение', { exact: true })
  .fill('Левый желудочек выталкивает кровь в аорту, откуда она поступает к органам тела.');
await shot('t08-quiz-question', { target: page.getByTestId('question-form').first().locator('xpath=..') });
await page.getByTestId('question-submit').first().click();
await page.getByTestId('quiz-question').first().waitFor();
// AC-TCH-07: один вариант → ошибка, вопрос не создаётся.
await qform.getByLabel('Текст вопроса', { exact: true }).fill('Вопрос с одним вариантом');
await qform.getByLabel('Вариант 1', { exact: true }).fill('Единственный');
await qform.getByRole('radio', { name: 'Правильный вариант: Вариант 1' }).check();
await qform.getByRole('button', { name: 'Удалить вариант 2' }).click();
await page.getByTestId('question-submit').first().click();
await page.getByTestId('options-error').waitFor();
await shot('t08-quiz-validation', { target: page.getByTestId('question-form').first().locator('xpath=..') });
await page.goto(`${base}/ru/teacher/topics/${topicId}/quiz`);
await shot('t08-quiz-list', { fullPage: true });

// 9. «Мои курсы» и мобильная ширина.
await page.goto(`${base}/ru/teacher/courses`);
await shot('teacher-courses');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/ru/teacher/topics/${topicId}`);
await page.getByTestId('topic-editor').waitFor();
await shot('t06-topic-editor-390');

await student.dispose();
await browser.close();
log(`screenshots → ${out}`);
