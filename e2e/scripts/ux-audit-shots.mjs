/* global document, window -- код внутри page.evaluate выполняется в браузере */
// Съёмка экранов ученика и учителя для сверки с эталонами docs/media (docs/UX_AI_TZ.md, шаг 1.3).
// Запуск: node e2e/scripts/ux-audit-shots.mjs [suffix] [baseURL] [--only=U04,T05]
//   suffix: current (по умолчанию) → <ID>-current.png и <ID>-compare.png; after → <ID>-after.png и <ID>-compare-after.png.
// Нужны web, api (с AI_TUTOR_FIXTURE=true — поток ИИ для U06/U07, как в e2e) и seed `visual` (pnpm db:seed --set=visual).
// Окно — размер эталона (1348 × 926, полоса прокрутки видна, как на эталоне), тёмная тема, язык эталона, анимации выключены.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, request } from '@playwright/test';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const suffix = args[0] ?? 'current';
const base = args[1] ?? 'http://localhost:3000';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const media = resolve(root, 'docs/media');
const out = resolve(media, 'ux-audit');
mkdirSync(out, { recursive: true });
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const USER = {
  email: 'alexandr@example.com',
  password: process.env.SEED_DEV_PASSWORD ?? 'syntara-dev-password',
};

// --- Данные seed `visual`: идентификаторы находим через API, а не константами ---
const api = await request.newContext({ baseURL: base });
const login = await api.post('/api/auth/login', { data: USER });
if (login.status() >= 300) throw new Error(`login: ${login.status()} — загружен ли seed visual?`);
const get = async (path) => {
  const res = await api.get(path);
  if (res.status() >= 300) throw new Error(`${path}: ${res.status()}`);
  return res.json();
};
const catalog = await get('/api/student/catalog');
const biology = catalog.sections.find((s) => s.title === 'Биология');
const anatomy = (await get(`/api/student/sections/${biology.id}`)).subjects[0];
const cardio = (await get(`/api/student/subjects/${anatomy.id}`)).topics[0];
const teacherSubjects = await get('/api/teacher/subjects');
const heart = teacherSubjects.find((s) => s.title.startsWith('Биология'));
const heartTopic = (await get(`/api/teacher/subjects/${heart.id}`)).topics[0];
const classes = await get('/api/teacher/classes');
const analyticsClass = classes.find((c) => c.studentsCount > 0) ?? classes[0];
const sessionCookies = (await api.storageState()).cookies;

// --- Браузер ---
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const NO_MOTION = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}nextjs-portal{display:none!important}`;

async function open({ role, locale = 'ru', theme = 'dark', width = 1348, height = 926 }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', locale });
  const cookies = [
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: theme, url: base },
    { name: 'locale', value: locale, url: base },
  ];
  if (role) cookies.push(...sessionCookies.map(({ name, value }) => ({ name, value, url: base })));
  await context.addCookies(cookies);
  const page = await context.newPage();
  // Тема из cookie может перебиваться сохранённой настройкой — выставляем атрибут явно.
  await page.addInitScript((t) => {
    document.addEventListener('DOMContentLoaded', () =>
      document.documentElement.setAttribute('data-theme', t),
    );
  }, theme);
  return page;
}

async function settle(page) {
  await page.addStyleTag({ content: NO_MOTION });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

/** Прокрутка так, чтобы верх элемента оказался на высоте y (как на эталоне). */
async function alignTop(page, locator, y) {
  const el = locator.first();
  if (!(await el.count())) return log('  ! не найден элемент для выравнивания');
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  await page.evaluate((dy) => window.scrollBy(0, dy), box.y - y);
  await page.waitForTimeout(300);
}

/**
 * U06 — пустой диалог: прошлые диалоги ученика архивируются (только локальная БД docker compose;
 * без контейнера шаг пропускается, и на снимке будет история).
 */
function archiveConversations() {
  try {
    execSync(
      `docker exec syntara-postgres-1 psql -U syntara -d syntara -c "update ai_conversations set archived_at = now() where archived_at is null and user_id = (select id from users where email = '${USER.email}')"`,
      { stdio: 'ignore' },
    );
  } catch {
    log('  ! не удалось архивировать диалоги ИИ');
  }
}

const SHOTS = [
  {
    id: 'U01',
    ref: 'image8.jpg',
    role: 'student',
    path: '/ru',
  },
  {
    id: 'U13',
    ref: 'image10.jpeg',
    role: 'student',
    locale: 'en',
    path: '/en/learn/subjects',
  },
  {
    id: 'U04',
    ref: 'image11.jpg',
    role: 'student',
    path: `/ru/learn/topics/${cardio.id}`,
  },
  {
    id: 'U05',
    ref: 'image12.jpg',
    role: 'student',
    path: `/ru/learn/topics/${cardio.id}?tab=quiz`,
    async prepare(page) {
      await page
        .getByRole('radiogroup')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    },
  },
  {
    id: 'U06',
    ref: 'image13.jpg',
    role: 'student',
    path: `/ru/learn/topics/${cardio.id}?tab=ai`,
    before: archiveConversations,
    async prepare(page) {
      const field = page.getByRole('textbox').last();
      await field.waitFor();
      await field.fill('Почему у сердца четыре камеры?');
      await alignTop(page, field, 430);
    },
  },
  {
    id: 'U07',
    ref: 'image14.jpg',
    role: 'student',
    path: `/ru/learn/topics/${cardio.id}?tab=ai`,
    async prepare(page) {
      const field = page.getByRole('textbox').last();
      await field.waitFor();
      await field.fill('Почему у сердца четыре камеры?');
      await page.getByRole('button', { name: 'Спросить' }).click();
      await page
        .getByRole('button', { name: 'Остановить' })
        .waitFor({ state: 'detached', timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(800);
      await alignTop(page, page.getByRole('textbox').last(), 518);
    },
  },
  {
    id: 'U02',
    ref: 'image9.jpg',
    role: 'student',
    path: '/ru/learn/assistant',
  },
  {
    id: 'U08',
    ref: 'image15.jpg',
    role: 'student',
    path: '/ru/learn/progress',
    async prepare(page) {
      await page
        .getByTestId('progress-card')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    },
  },
  {
    id: 'U10',
    ref: 'image16.jpg',
    role: 'student',
    path: '/ru/learn/achievements',
  },
  {
    id: 'U12',
    ref: 'image18.jpg',
    role: 'student',
    theme: 'light',
    path: `/ru/learn/topics/${cardio.id}`,
  },
  {
    id: 'U09',
    ref: 'image17.jpg',
    role: 'student',
    locale: 'en',
    path: `/en/learn/topics/${cardio.id}`,
    async prepare(page) {
      await page
        .getByRole('button', { name: /language|язык/i })
        .first()
        .click()
        .catch(() => {});
      await page.waitForTimeout(300);
    },
  },
  {
    id: 'AUTH',
    ref: 'student-auth.png',
    path: '/ru/auth/start?role=student',
    width: 377,
    height: 1203,
    async prepare(page) {
      await alignTop(page, page.getByRole('heading', { name: 'Вход или регистрация' }), 180);
    },
  },
  {
    id: 'T04',
    ref: 'image1.jpg',
    role: 'teacher',
    path: `/ru/teacher/subjects/${heart.id}`,
    async prepare(page) {
      await alignTop(page, page.getByRole('heading', { name: 'Выдать предмет классу' }), 155);
    },
  },
  {
    id: 'T05',
    ref: 'image2.jpg',
    role: 'teacher',
    path: '/ru/teacher/subjects/new',
    async prepare(page) {
      await page.getByLabel('Название').first().fill('Биология: сердце и кровообращение');
      await page.getByLabel('Описание').first().fill('Материалы урока о строении сердца и движении крови.');
    },
  },
  {
    id: 'T06',
    ref: 'image3.jpg',
    role: 'teacher',
    path: `/ru/teacher/topics/${heartTopic.id}`,
  },
  {
    id: 'T07',
    ref: 'image4.jpg',
    role: 'teacher',
    path: `/ru/teacher/topics/${heartTopic.id}`,
    async prepare(page) {
      await alignTop(page, page.getByText('Обложка темы', { exact: true }), 252);
    },
  },
  {
    id: 'T08',
    ref: 'image5.jpg',
    role: 'teacher',
    path: `/ru/teacher/topics/${heartTopic.id}/quiz`,
    async prepare(page) {
      const textarea = page.getByLabel('Текст вопроса').first();
      await textarea.fill('Какая камера сердца направляет кровь в аорту?').catch(() => {});
      const options = page.getByRole('textbox', { name: /Вариант/ });
      await options
        .nth(0)
        .fill('Левый желудочек')
        .catch(() => {});
      await options
        .nth(1)
        .fill('Правое предсердие')
        .catch(() => {});
      await page
        .getByLabel('Объяснение')
        .first()
        .fill('Левый желудочек выталкивает кровь в аорту, откуда она поступает к органам тела.')
        .catch(() => {});
      await alignTop(page, page.getByRole('heading', { name: /Добавить вопрос/ }), 103);
    },
  },
  {
    id: 'T09',
    ref: 'image6.jpg',
    role: 'teacher',
    path: '/ru/teacher/assignments',
  },
  {
    id: 'T10',
    ref: 'image7.jpg',
    role: 'teacher',
    path: `/ru/teacher/classes/${analyticsClass.id}/analytics`,
    async prepare(page) {
      await page
        .getByText('Слабые темы класса')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
      await alignTop(page, page.getByRole('link', { name: /К классам/ }), 66);
    },
  },
];

/** Склейка: слева эталон, справа текущий экран, одинаковая высота. */
async function compare(id, refFile, shotFile, target) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const dataUrl = (p) =>
    `data:image/${p.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(p).toString('base64')}`;
  await page.setContent(
    `<body style="margin:0;background:#444;display:flex;gap:8px;align-items:flex-start;font:600 14px sans-serif;color:#fff">
      <figure style="margin:0"><figcaption style="padding:4px 8px">${id} — эталон</figcaption><img src="${dataUrl(refFile)}"></figure>
      <figure style="margin:0"><figcaption style="padding:4px 8px">${id} — ${suffix === 'current' ? 'сейчас' : 'после'}</figcaption><img src="${dataUrl(shotFile)}"></figure>
    </body>`,
  );
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: target, fullPage: true });
  await page.close();
}

for (const s of SHOTS) {
  if (only && !only.includes(s.id)) continue;
  s.before?.();
  const page = await open(s);
  await page.goto(`${base}${s.path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (s.prepare) await s.prepare(page);
  await page.waitForTimeout(300);
  const file = `${out}/${s.id}-${suffix}.png`;
  await page.screenshot({ path: file });
  const target = `${out}/${s.id}-${suffix === 'current' ? 'compare' : `compare-${suffix}`}.png`;
  await compare(s.id, `${media}/${s.ref}`, file, target);
  log('shot', s.id, s.path);
  await page.context().close();
}
await browser.close();
