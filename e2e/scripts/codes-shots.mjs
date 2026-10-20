/* global document -- код внутри page.evaluate выполняется в браузере */
// Скриншоты CODES_TZ (раздел 7): docs/media/codes/<экран>-390.png — поля «Код класса» и «Код Battle»,
// обе подсказки «не туда». Запуск: node e2e/scripts/codes-shots.mjs [baseURL]. Нужны web, api, seed `demo`
// и DATABASE_URL / SESSION_SECRET (из окружения или корневого .env) — для старого кода класса вида LLLDDD.
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import postgres from 'postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile(resolve(root, '.env'));
} catch {
  // .env нет — переменные из окружения.
}
const base = process.argv[2] ?? 'http://localhost:3000';
const out = resolve(root, 'docs/media/codes');
mkdirSync(out, { recursive: true });
const NO_MOTION = `*,*::before,*::after{transition:none!important;animation:none!important}nextjs-portal{display:none!important}`;
const uid = () => randomUUID().slice(0, 8);
const pick = (chars, n) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join('');

const browser = await chromium.launch();

async function context() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    baseURL: base,
  });
  await ctx.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: 'dark', url: base },
  ]);
  return ctx;
}

async function api(page, path, data) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'csrf')?.value ?? '';
  const res = await page.request.post(path, { data, headers: { 'X-CSRF-Token': csrf } });
  if (!res.ok()) throw new Error(`POST ${path} → ${res.status()} ${await res.text()}`);
  return res.json();
}

async function shot(page, name, target) {
  await page.addStyleTag({ content: NO_MOTION });
  await page.evaluate(() => document.fonts.ready);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-390.png` });
  process.stdout.write(`shot ${name}-390\n`);
}

// Учитель: класс с кодом и запущенная сессия Battle.
const tctx = await context();
const teacher = await tctx.newPage();
await api(teacher, '/api/auth/register', {
  role: 'teacher',
  email: `codes.shots.${uid()}@example.kz`,
  displayName: 'Айгерим К.',
  password: 'teacher-pass-1',
});
const cls = await api(teacher, '/api/teacher/classes', { name: '7 «А»' });
const quiz = await api(teacher, '/api/teacher/battles', { title: 'Сердце', locale: 'ru' });
await api(teacher, `/api/teacher/battles/${quiz.id}/questions`, {
  type: 'single_choice',
  text: 'Сколько камер в сердце человека?',
  timeLimitSec: 20,
  options: ['Две', 'Четыре'].map((text, i) => ({ text, isCorrect: i === 1 })),
});
const session = await api(teacher, `/api/teacher/battles/${quiz.id}/sessions`, { classId: cls.id });

// Старый код класса вида LLLDDD (до BR-CODE-03) — для подсказки «Это код класса».
const legacy = pick('ABCDEFGHJKLMNPQRSTUVWXYZ', 3) + pick('23456789', 3);
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const hash = createHmac('sha256', process.env.SESSION_SECRET).update(`class-code:${legacy}`).digest();
await sql`
  INSERT INTO class_invite_codes (id, class_id, code_hash, expires_at, created_by)
  SELECT gen_random_uuid(), id, ${hash}, now() + interval '1 day', teacher_id FROM classes WHERE id = ${cls.id}`;
await sql.end();

// Ученик без класса.
const sctx = await context();
const student = await sctx.newPage();
const reg = await student.request.post('/api/auth/register-student', {
  data: { displayName: 'Асель Каримова', login: `codes.shots.${uid()}`, password: 'student-pass-1' },
});
if (!reg.ok()) throw new Error(`register-student → ${reg.status()}`);

// 1. Поле «Код класса» и 3. подсказка «Это код Battle».
await student.goto('/ru/learn/subjects', { waitUntil: 'networkidle' });
const card = student.getByTestId('student-join');
await shot(student, 'class-field', card);
await card.getByLabel('Код класса').fill(session.code);
await card.getByRole('button', { name: 'Подключиться' }).click();
await student.getByRole('dialog').getByRole('button', { name: 'Присоединиться' }).click();
await card.getByRole('alert').waitFor();
await shot(student, 'hint-battle-code-in-class-field', card);

// 2. Поле «Код Battle» и 4. подсказка «Это код класса».
await student.goto('/ru/learn/battles', { waitUntil: 'networkidle' });
const join = student.getByTestId('battle-join');
await shot(student, 'battle-field', join);
await join.getByLabel('Символ 1 из 6').click();
await student.keyboard.type(legacy);
await join.getByRole('button', { name: 'Войти в игру' }).click();
await join.getByRole('alert').waitFor();
await shot(student, 'hint-class-code-in-battle-field', join);

await browser.close();
