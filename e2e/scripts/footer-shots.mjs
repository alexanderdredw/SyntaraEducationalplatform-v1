/* global document, window -- код внутри page.evaluate выполняется в браузере */
// Скриншоты бага «футер посередине экрана» (до/после): короткие страницы кабинетов ученика и учителя (с баннером
// «Подтвердите email»), панель развёрнутая и свёрнутая, публичная страница гостя; 1440×900 и 390×844.
// Печатает зазор между нижним краем футера и окна, прокрученного до конца (0 — футер внизу). Запуск: node e2e/scripts/footer-shots.mjs <каталог> <префикс>
// [baseURL]. Нужны web и api.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const prefix = process.argv[3] ?? 'footer';
const base = process.argv[4] ?? 'http://localhost:3000';
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
  displayName: 'Асель',
  login: `foot.${uid}`,
  password: 'student-pass-1',
});
const teacher = await account('/api/auth/register', {
  role: 'teacher',
  email: `foot.${uid}@example.kz`,
  displayName: 'Алия Сапарова',
  password: 'teacher-pass-1',
});

const browser = await chromium.launch();
async function pageFor(ctx, viewport, collapsed) {
  const context = await browser.newContext({ viewport, colorScheme: 'dark' });
  const cookies = ctx ? (await ctx.storageState()).cookies : [];
  await context.addCookies([
    ...cookies.map(({ name, value }) => ({ name, value, url: base })),
    { name: 'consent', value: 'necessary', url: base },
  ]);
  if (collapsed) await context.addInitScript(() => localStorage.setItem('syntara.sidebar', 'collapsed'));
  return context.newPage();
}
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
async function shot(ctx, path, file, viewport, collapsed = false) {
  const page = await pageFor(ctx, viewport, collapsed);
  await page.goto(`${base}/ru${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  // Телефон — вся страница, компьютер — окно.
  await page.screenshot({ path: `${out}/${prefix}-${file}.png`, fullPage: viewport === PHONE });
  const gap = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const footer = document.querySelector('[data-testid="site-footer"]').getBoundingClientRect();
    return Math.round(window.innerHeight - footer.bottom);
  });
  log('✓', `${prefix}-${file}.png`, `зазор под футером: ${gap} px`);
  await page.context().close();
}

await shot(student, '/learn/assignments', 'student-assignments-1440', DESKTOP);
await shot(student, '/learn/assignments', 'student-assignments-collapsed-1440', DESKTOP, true);
await shot(student, '/learn/assignments', 'student-assignments-390', PHONE);
await shot(teacher, '/teacher/assignments', 'teacher-assignments-banner-1440', DESKTOP);
await shot(teacher, '/teacher/assignments', 'teacher-assignments-banner-390', PHONE);
await shot(null, '/join', 'guest-join-1440', DESKTOP);
await shot(null, '/join', 'guest-join-390', PHONE);
await browser.close();
