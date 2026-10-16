// Скриншоты экранов итерации 8 (интерфейс ученика: обучение) на реальном стеке.
// Запуск: node e2e/scripts/student-shots.mjs <каталог> [baseURL]
// Нужны web, api, worker (проверка обложки), MinIO, ClamAV и seed `demo`.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const uid = randomUUID().slice(0, 6);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

/** PNG с градиентом — обложка темы. */
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
      row.set([30 + (x * 60) / width, 120 + (y * 80) / height, 70 + (x * 40) / width], 1 + x * 3);
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

const csrf = async (ctx) => (await ctx.storageState()).cookies.find((c) => c.name === 'csrf').value;
async function call(ctx, method, path, data) {
  const res = await ctx.fetch(path, { method, data, headers: { 'X-CSRF-Token': await csrf(ctx) } });
  if (res.status() >= 300) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 1. Учитель: класс, предмет, выдача классу, тема с обложкой, фактом и квизом.
const teacher = await request.newContext({ baseURL: base });
await teacher.post('/api/auth/register', {
  data: {
    role: 'teacher',
    email: `st.${uid}@example.kz`,
    displayName: 'Алия Сапарова',
    password: 'teacher-pass-1',
  },
});
const cls = await call(teacher, 'POST', '/api/teacher/classes', { name: '8 «Б»' });
const { code } = await call(teacher, 'POST', `/api/teacher/classes/${cls.id}/invite-codes`);
const subject = await call(teacher, 'POST', '/api/teacher/subjects', {
  translations: { ru: { title: 'ботаника', description: 'растения, животные' } },
  inPublicCatalog: false,
});
await call(teacher, 'POST', `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
const topic = await call(teacher, 'POST', `/api/teacher/subjects/${subject.id}/topics`);
const second = await call(teacher, 'POST', `/api/teacher/subjects/${subject.id}/topics`);
const png = makePng(672, 380);
const upload = await call(teacher, 'POST', '/api/files/upload-url', {
  kind: 'cover',
  fileName: 'leaf.png',
  mime: 'image/png',
  size: png.length,
});
await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: png });
await call(teacher, 'POST', `/api/files/${upload.mediaId}/complete`);
for (let i = 0; i < 30; i++) {
  const gallery = await call(teacher, 'GET', '/api/teacher/gallery');
  if (gallery.find((g) => g.id === upload.mediaId)?.scanStatus === 'clean') break;
  await new Promise((r) => setTimeout(r, 1000));
}
await call(teacher, 'PUT', `/api/teacher/topics/${topic.id}`, {
  translations: {
    ru: {
      title: 'Строение листа',
      description: 'Из чего состоит лист и как он помогает растению питаться.',
      funFact: 'Лист может поворачиваться вслед за солнцем, чтобы получать больше света.',
      bodyMd:
        '## Пластинка и черешок\nЛист состоит из **пластинки** и *черешка*. Пластинка улавливает свет, черешок соединяет лист со стеблем.\n\n## Жилки\n- проводят воду и питательные вещества\n- служат каркасом листа',
    },
    kk: { title: 'Жапырақтың құрылысы', description: 'Жапырақ неден тұрады.' },
  },
  coverMediaId: upload.mediaId,
  materialIds: [],
});
await call(teacher, 'PUT', `/api/teacher/topics/${second.id}`, {
  translations: { ru: { title: 'Корень и стебель' } },
  materialIds: [],
});
const questions = [
  [
    'easy',
    'Из чего состоит лист?',
    ['Пластинка и черешок', 'Корень и стебель', 'Цветок и плод', 'Почка и побег'],
  ],
  ['medium', 'Что проводят жилки листа?', ['Воду и питательные вещества', 'Только свет', 'Пыльцу', 'Семена']],
  [
    'hard',
    'Зачем лист поворачивается к солнцу?',
    ['Чтобы получать больше света', 'Чтобы остыть', 'Чтобы упасть', 'Случайно'],
  ],
];
for (const [difficulty, text, options] of questions) {
  await call(teacher, 'POST', `/api/teacher/topics/${topic.id}/quiz/questions`, {
    type: 'single_choice',
    difficulty,
    translations: { ru: { text, explanation: `Правильно: ${options[0]}.` } },
    options: options.map((o, i) => ({ translations: { ru: o }, isCorrect: i === 0 })),
  });
}
await call(teacher, 'POST', `/api/teacher/topics/${topic.id}/publish`, { changeNote: 'Первая версия' });
await call(teacher, 'POST', `/api/teacher/topics/${second.id}/publish`, {});
log('teacher: subject', subject.id, 'topic', topic.id);

// 2. Ученик класса.
const studentApi = await request.newContext({ baseURL: base });
await studentApi.post('/api/auth/register-student', {
  data: { displayName: 'Асель', login: `shots.${uid}`, password: 'student-pass-1', code },
});
const cookies = (await studentApi.storageState()).cookies.map(({ name, value }) => ({
  name,
  value,
  url: base,
}));

const browser = await chromium.launch();
async function session(width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: 'dark', url: base },
    ...cookies,
  ]);
  const page = await context.newPage();
  page.on(
    'load',
    () =>
      void page
        .addStyleTag({ content: '[data-testid=cabinet-header]{position:static !important}' })
        .catch(() => {}),
  );
  return { context, page };
}
const { page } = await session();
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(400);
  if (opts.target) await opts.target.screenshot({ path: `${out}/${name}.png` });
  else await page.screenshot({ path: `${out}/${name}.png`, fullPage: opts.fullPage ?? false });
  log('screenshot', name);
};

await page.goto(`${base}/ru`);
await shot('u01-home-continue-before');
await page.goto(`${base}/ru/learn/subjects`);
await page.getByTestId('catalog-subject').first().waitFor();
await shot('u13-catalog', { fullPage: true });
await page.getByTestId('catalog-section').first().click();
await page.getByTestId('catalog-subject').first().waitFor();
await shot('u03-section');
await page.goto(`${base}/ru/learn/subjects/${subject.id}`);
await page.getByTestId('student-topic').first().waitFor();
await shot('subject-page');
await page.getByTestId('student-topic').first().click();
await page.getByTestId('lesson-fun-fact').waitFor();
await page.waitForTimeout(800);
await shot('u04-lesson-overview', { fullPage: true });
await page.getByRole('tab', { name: 'Квиз' }).click();
await page.getByTestId('quiz-progress').waitFor();
await shot('u05-quiz-question');
await page.getByTestId('quiz-option').nth(1).click();
await page.getByTestId('quiz-feedback').getByText('Неверно').waitFor();
await shot('u05-quiz-incorrect');
await page.getByTestId('quiz-next').click();
for (let i = 1; i < questions.length; i++) {
  await page.getByTestId('quiz-option').first().click();
  await page.getByTestId('quiz-feedback').getByText('Верно').waitFor();
  if (i === 1) await shot('u05-quiz-correct');
  await page.getByTestId('quiz-next').click();
}
await page.getByTestId('quiz-result').waitFor();
await shot('u05-quiz-result');
log('header:', await page.getByTestId('cabinet-stats').innerText());
await page.goto(`${base}/ru`);
await shot('u01-home-continue');
log('continue →', await page.getByTestId('hero-continue').getAttribute('href'));

// 3. Английская версия и мобильная ширина.
await page.goto(`${base}/en/learn/topics/${topic.id}`);
await page.getByTestId('lesson-overview').waitFor();
await shot('u09-lesson-en');
const mobile = await session(390, 844);
await mobile.page.goto(`${base}/ru/learn/topics/${topic.id}?tab=quiz`);
await mobile.page.getByTestId('quiz-result').or(mobile.page.getByTestId('quiz-progress')).first().waitFor();
await mobile.page.waitForTimeout(400);
await mobile.page.screenshot({ path: `${out}/u05-quiz-390.png` });
log('screenshot u05-quiz-390');

await browser.close();
await teacher.dispose();
await studentApi.dispose();
log(`screenshots → ${out}`);
