/* global document -- код внутри page.evaluate выполняется в браузере */
// Скриншоты docs/DELETE_TZ.md (раздел 9): корзина у черновика, окно подтверждения, «✕» в галерее, неактивная «✕»
// у используемой обложки. Запуск: node e2e/scripts/delete-shots.mjs <каталог> [baseURL].
// Нужны web, api, worker (проверка картинок), MinIO, ClamAV.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

function png(width, height, tint) {
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
    for (let x = 0; x < width; x++) row.set([tint[0] + (x % 60), tint[1] + (y % 60), tint[2]], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const teacher = await request.newContext({ baseURL: base });
await teacher.post('/api/auth/register', {
  data: {
    role: 'teacher',
    email: `del.${randomUUID().slice(0, 6)}@example.kz`,
    displayName: 'Алия Сапарова',
    password: 'teacher-pass-1',
  },
});
const csrf = (await teacher.storageState()).cookies.find((c) => c.name === 'csrf').value;
async function call(method, path, data) {
  const res = await teacher.fetch(path, { method, data, headers: { 'X-CSRF-Token': csrf } });
  if (res.status() >= 300) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function cover(name, tint) {
  const bytes = png(320, 180, tint);
  const issued = await call('POST', '/api/files/upload-url', {
    kind: 'cover',
    fileName: name,
    mime: 'image/png',
    size: bytes.length,
  });
  const put = await fetch(issued.uploadUrl, { method: 'PUT', headers: issued.headers, body: bytes });
  if (!put.ok) throw new Error(`PUT ${put.status}`);
  await call('POST', `/api/files/${issued.mediaId}/complete`);
  return issued.mediaId;
}

const subject = await call('POST', '/api/teacher/subjects', {
  translations: { ru: { title: 'Химия', description: 'Вещества и реакции' } },
  inPublicCatalog: false,
});
const titles = ['Строение атома', 'Новая тема', 'Новая тема'];
const topics = [];
for (const [i, title] of titles.entries()) {
  const topic = await call('POST', `/api/teacher/subjects/${subject.id}/topics`);
  if (i === 0)
    await call('PUT', `/api/teacher/topics/${topic.id}`, {
      translations: { ru: { title } },
      materialIds: [],
    });
  topics.push(topic.id);
}
const used = await cover('Атом.png', [40, 90, 160]);
const free = await cover('Колба.png', [150, 80, 40]);
await call('PUT', `/api/teacher/topics/${topics[0]}`, {
  translations: { ru: { title: titles[0] } },
  coverMediaId: used,
  materialIds: [],
});
await call('POST', `/api/teacher/topics/${topics[0]}/publish`, {});

const browser = await chromium.launch();
async function pageFor(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'dark' });
  await context.addCookies([
    ...(await teacher.storageState()).cookies.map(({ name, value }) => ({ name, value, url: base })),
    { name: 'consent', value: 'necessary', url: base },
  ]);
  return context.newPage();
}
const settle = (page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));

let page = await pageFor(1440);
await page.goto(`${base}/ru/teacher/subjects/${subject.id}`);
await page.getByTestId('delete-topic').first().waitFor();
await page.getByTestId('subject-topics').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/draft-trash-1440.png` });
log('✓ draft-trash-1440.png');
await page.getByTestId('delete-topic').first().click();
await page.getByTestId('confirm-delete').waitFor();
await settle(page);
await page.screenshot({ path: `${out}/confirm-dialog-1440.png` });
log('✓ confirm-dialog-1440.png');

page = await pageFor(1440);
await page.goto(`${base}/ru/teacher/topics/${topics[1]}`);
const items = page.getByTestId('gallery-item');
await items.first().waitFor();
// Картинки проверяет worker — ждём миниатюры «Готов».
await page.locator('[data-testid="gallery-item"] img').nth(1).waitFor({ timeout: 90_000 });
const gallery = page.getByTestId('topic-cover');
await gallery.scrollIntoViewIfNeeded();
const freeItem = page.locator('li', { has: page.getByRole('button', { name: /Колба/ }) });
await freeItem.hover();
await settle(page);
await gallery.screenshot({ path: `${out}/gallery-delete-1440.png` });
log('✓ gallery-delete-1440.png');
const usedItem = page.locator('li', { has: page.getByRole('button', { name: /Атом/ }) });
await usedItem.hover();
await usedItem.getByTestId('gallery-delete').hover();
await settle(page);
await page.screenshot({
  path: `${out}/gallery-used-disabled-1440.png`,
  clip: { ...(await gallery.boundingBox()), height: (await gallery.boundingBox()).height + 80 },
});
log('✓ gallery-used-disabled-1440.png');

page = await pageFor(390);
await page.goto(`${base}/ru/teacher/topics/${topics[1]}`);
await page.locator('[data-testid="gallery-item"] img').nth(1).waitFor({ timeout: 90_000 });
await page.getByTestId('topic-cover').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/gallery-390.png` });
log('✓ gallery-390.png');
await browser.close();
log('free image id', free);
