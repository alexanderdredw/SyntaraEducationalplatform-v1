/* global document -- код внутри page.evaluate выполняется в браузере */
// Скриншоты docs/NAV_TZ.md (раздел «Отчёт», п. 5): панель ученика и учителя развёрнутая и свёрнутая (1440 px),
// урок с панелью, «О проекте» у вошедшего ученика, меню на телефоне (390 px) для обеих ролей.
// Запуск: node e2e/scripts/nav-shots.mjs <каталог> [baseURL]. Нужны web, api и базовые уроки (pnpm content:import).
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const uid = randomUUID().slice(0, 6);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

async function account(path, data) {
  const ctx = await request.newContext({ baseURL: base });
  const res = await ctx.post(path, { data });
  if (res.status() >= 300) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
  return ctx;
}
const student = await account('/api/auth/register-student', {
  displayName: 'Асель Нурова',
  login: `nav.${uid}`,
  password: 'student-pass-1',
});
const teacher = await account('/api/auth/register', {
  role: 'teacher',
  email: `nav.${uid}@example.kz`,
  displayName: 'Алия Сапарова',
  password: 'teacher-pass-1',
});

// Первая тема базовой программы — через публичный каталог (API-PUB-10..12).
const anon = await request.newContext({ baseURL: base });
const json = async (path) => (await anon.get(path)).json();
const catalog = await json('/api/public/catalog');
const section = await json(`/api/public/sections/${catalog.sections[0].id}`);
const subject = section.subjects.find((s) => s.status === 'available');
const topicId = (await json(`/api/public/subjects/${subject.id}`)).topics[0].id;

const browser = await chromium.launch();
async function pageFor(ctx, width, collapsed) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'dark' });
  const { cookies } = await ctx.storageState();
  await context.addCookies([
    ...cookies.map(({ name, value }) => ({ name, value, url: base })),
    { name: 'consent', value: 'necessary', url: base },
  ]);
  if (collapsed) await context.addInitScript(() => localStorage.setItem('syntara.sidebar', 'collapsed'));
  return context.newPage();
}
async function shot(page, path, file, after) {
  await page.goto(`${base}/ru${path}`);
  await page.waitForLoadState('networkidle');
  if (after) await after(page);
  await page.screenshot({ path: `${out}/${file}` });
  log('✓', file);
}
const openMenu = async (page) => {
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByTestId('mobile-menu-panel').waitFor();
  // Анимация открытия (UX-10) — снимок после неё.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
};

for (const [role, ctx, path] of [
  ['student', student, '/learn/subjects'],
  ['teacher', teacher, '/teacher/courses'],
]) {
  await shot(await pageFor(ctx, 1440, false), path, `${role}-panel-expanded-1440.png`);
  await shot(await pageFor(ctx, 1440, true), path, `${role}-panel-collapsed-1440.png`);
  await shot(await pageFor(ctx, 390, false), path, `${role}-menu-390.png`, openMenu);
}
await shot(await pageFor(student, 1440, false), `/learn/topics/${topicId}`, 'student-lesson-1440.png');
await shot(await pageFor(student, 1440, false), '/about', 'student-about-1440.png');
await shot(await pageFor(teacher, 1440, false), `/learn/topics/${topicId}`, 'teacher-base-lesson-1440.png');
await browser.close();
