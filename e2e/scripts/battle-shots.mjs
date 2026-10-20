/* global document -- код внутри page.evaluate выполняется в браузере */
// Скриншоты экранов Battle (итерация 10.5, BATTLE_TZ раздел 13): docs/media/battle/<этап>-<экран>-<ширина>.png.
// Запуск: node e2e/scripts/battle-shots.mjs [baseURL]. Нужны web, api и seed `demo`. Тёмная тема, RU.
// Данные создаются через API: новый учитель, Battle-тест с вопросами.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/media/battle');
mkdirSync(out, { recursive: true });
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const NO_MOTION = `*,*::before,*::after{transition:none!important;animation:none!important}nextjs-portal{display:none!important}`;
const WIDTHS = [1440, 390];

const browser = await chromium.launch();

/** Контекст с принятыми cookie и темой; `setup` — действия через API от имени пользователя контекста. */
async function context(theme = 'dark') {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    baseURL: base,
  });
  await ctx.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: theme, url: base },
  ]);
  return ctx;
}

async function api(page, method, path, data) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'csrf')?.value ?? '';
  const res = await page.request.fetch(path, { method, data, headers: { 'X-CSRF-Token': csrf } });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function shot(page, name, path, { fullPage = true } = {}) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: NO_MOTION });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage });
    log('shot', `${name}-${width}`);
  }
}

const choice = (text, options, correct, timeLimitSec = 20) => ({
  type: 'single_choice',
  text,
  timeLimitSec,
  options: options.map((o, i) => ({ text: o, isCorrect: i === correct })),
});

// ---- B1: «Мои Battle» и редактор ----
const teacherCtx = await context();
const teacher = await teacherCtx.newPage();
await teacher.goto('/ru');
await api(teacher, 'POST', '/api/auth/register', {
  role: 'teacher',
  email: `battle.shots.${randomUUID().slice(0, 8)}@example.kz`,
  displayName: 'Айгерим Кереева',
  password: 'teacher-pass-1',
});
const { id: battleId } = await api(teacher, 'POST', '/api/teacher/battles', {
  title: 'Сердце и кровообращение',
  description: 'Разминка перед контрольной',
  locale: 'ru',
});
await api(
  teacher,
  'POST',
  `/api/teacher/battles/${battleId}/questions`,
  choice('Сколько камер в сердце человека?', ['Две', 'Три', 'Четыре', 'Пять'], 2, 20),
);
await api(
  teacher,
  'POST',
  `/api/teacher/battles/${battleId}/questions`,
  choice('Какой сосуд несёт кровь от сердца к телу?', ['Аорта', 'Полая вена', 'Капилляр'], 0, 30),
);
await api(teacher, 'POST', `/api/teacher/battles/${battleId}/questions`, {
  type: 'true_false',
  text: 'Сердце — это мышца',
  timeLimitSec: 10,
  options: [
    { text: '', isCorrect: true },
    { text: '', isCorrect: false },
  ],
});
await api(teacher, 'POST', '/api/teacher/battles', { title: 'Дыхательная система', locale: 'kk' });
await shot(teacher, 'b1-teacher-battles', '/ru/teacher/battles');
await shot(teacher, 'b1-teacher-editor', `/ru/teacher/battles/${battleId}`);

await teacherCtx.close();
await browser.close();
