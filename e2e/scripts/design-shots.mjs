// Скриншоты ключевых экранов для сравнения «до/после» (задача «основа дизайна»).
// Запуск: node e2e/scripts/design-shots.mjs <каталог> [baseURL]; нужны запущенные web и api с seed `demo`.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3100';
mkdirSync(out, { recursive: true });
const uid = randomUUID().slice(0, 6);

const browser = await chromium.launch();
const cookies = (theme) => [
  { name: 'consent', value: 'necessary', url: base },
  { name: 'theme', value: theme, url: base },
];

async function shot(
  name,
  path,
  { width = 1440, height = 900, theme = 'dark', auth, prepare, fullPage = true } = {},
) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await ctx.addCookies(cookies(theme));
  if (auth) await ctx.addCookies(auth);
  const page = await ctx.newPage();
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  if (prepare) await prepare(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  await ctx.close();
}

// Учитель с классом и учеником в нём — для экранов кабинетов.
const api = await request.newContext({ baseURL: base });
await api.post('/api/auth/register', {
  data: {
    role: 'teacher',
    email: `design.${uid}@example.kz`,
    displayName: 'Алия Учитель',
    password: 'teacher-pass-1',
  },
});
const teacherState = await api.storageState();
const csrf = teacherState.cookies.find((c) => c.name === 'csrf').value;
const cls = await (
  await api.post('/api/teacher/classes', { data: { name: '7 «А»' }, headers: { 'X-CSRF-Token': csrf } })
).json();
const code = await (
  await api.post(`/api/teacher/classes/${cls.id}/invite-codes`, { headers: { 'X-CSRF-Token': csrf } })
).json();
const student = await request.newContext({ baseURL: base });
await student.post('/api/auth/register-student', {
  data: { displayName: 'Асель', login: `design.${uid}`, password: 'student-pass-1', code: code.code },
});
const studentState = await student.storageState();
const toCookies = (state) => state.cookies.map(({ name, value }) => ({ name, value, url: base }));

await shot('home-1440', '/ru', { fullPage: false });
await shot('student-auth-390', '/ru/auth/start?role=student', { width: 390, height: 844 });
await shot('login-390', '/ru/auth/login', { width: 390, height: 844, fullPage: false });
await shot('join-390', '/ru/join', { width: 390, height: 844, fullPage: false });
await shot('login-1440', '/ru/auth/login', { fullPage: false });
await shot('support-form-1440', '/ru/support', { fullPage: false });
await shot('teacher-classes-1440', '/ru/teacher/classes', {
  auth: toCookies(teacherState),
  fullPage: false,
  prepare: async (page) => {
    await page.getByRole('button', { name: 'Ученики' }).first().click();
  },
});
await shot('student-subjects-1440', '/ru/learn/subjects', { auth: toCookies(studentState), fullPage: false });
await shot('student-auth-light-390', '/ru/auth/start?role=student', {
  width: 390,
  height: 844,
  theme: 'light',
  fullPage: false,
});

await api.dispose();
await student.dispose();
await browser.close();
process.stdout.write(`screenshots → ${out}\n`);
