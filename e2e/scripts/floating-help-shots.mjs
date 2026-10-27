// Снимки «после» для плавающих кнопок на телефоне (REQ-GEN-SHELL-04): формы входа и регистрации ученика и учителя,
// урок, квиз, Battle и профиль на 320 и 390 px, тёмная тема. Для каждой страницы два снимка окна: начало страницы
// (под кнопками поля — кнопки убраны) и конец содержимого (кнопки видны в отступе под ними).
// → docs/media/mobile-fab/*.webp (WebP q85, CLAUDE.md). Нужны запущенные web и api. Запуск из папки e2e:
// node scripts/floating-help-shots.mjs
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, request } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const out = `${root}docs/media/mobile-fab/`;
mkdirSync(out, { recursive: true });

// Ученик и тема базовой программы — через API.
const api = await request.newContext({ baseURL: base });
await api.post('/api/auth/register-student', {
  data: { displayName: 'Асель Нурова', login: `fab.${randomUUID().slice(0, 8)}`, password: 'student-pass-1' },
});
const catalog = await (await api.get('/api/public/catalog')).json();
const biology = catalog.sections.find((s) => s.title === 'Биология');
const section = await (await api.get(`/api/public/sections/${biology.id}`)).json();
const anatomy = section.subjects.find((s) => s.title === 'Анатомия человека');
const subject = await (await api.get(`/api/public/subjects/${anatomy.id}`)).json();
const topic = subject.topics.find((t) => t.title === 'Сердечно-сосудистая система').id;
const { cookies } = await api.storageState();

const guestPages = [
  ['teacher-register', '/ru/auth/start?role=teacher'],
  ['teacher-login', '/ru/auth/login?role=teacher'],
  ['student-register', '/ru/auth/start?role=student'],
];
const studentPages = [
  ['lesson', `/ru/learn/topics/${topic}`],
  ['quiz', `/ru/learn/topics/${topic}?tab=quiz`],
  ['battle', '/ru/learn/battles'],
  ['profile', '/ru/account/profile'],
];

const shot = async (page, file) => {
  // Кнопки обновляются раз в кадр.
  await page.evaluate(
    () =>
      new Promise((r) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => setTimeout(r, 200))),
      ),
  );
  const png = await page.screenshot();
  await sharp(png).webp({ quality: 85 }).toFile(`${out}${file}.webp`);
  console.warn(file);
};

const browser = await chromium.launch();
for (const width of [320, 390]) {
  for (const [signedIn, pages] of [
    [false, guestPages],
    [true, studentPages],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 320 ? 640 : 844 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'consent', value: 'necessary', url: base },
      ...(signedIn ? cookies.map(({ name, value }) => ({ name, value, url: base })) : []),
    ]);
    const page = await context.newPage();
    for (const [name, path] of pages) {
      await page.goto(`${base}${path}`);
      await page.evaluate(() => globalThis.document.fonts.ready);
      await shot(page, `${name}-${width}-top`);
      await page.evaluate(() => {
        const { document, scrollY, innerHeight } = globalThis;
        const end = document.getElementById('main').getBoundingClientRect().bottom + scrollY;
        globalThis.scrollTo({ top: end - innerHeight, behavior: 'instant' });
      });
      await shot(page, `${name}-${width}-end`);
    }
    await context.close();
  }
}
await browser.close();
await api.dispose();
