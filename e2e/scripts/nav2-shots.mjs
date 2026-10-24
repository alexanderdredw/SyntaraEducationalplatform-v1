/* global document -- код внутри page.evaluate выполняется в браузере */
// Скриншоты docs/NAV_TZ_2.md (раздел 5): панель ученика развёрнутая и свёрнутая со счётчиками, «Мой класс»
// (в классе и без класса), каталог без предметов учителя, урок предмета учителя с крошками, меню на телефоне 390 px.
// Запуск: node e2e/scripts/nav2-shots.mjs <каталог> [baseURL]. Нужны web, api и базовые уроки (seed demo).
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, request } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const uid = randomUUID().slice(0, 6);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const DAY = 86_400_000;

const csrf = async (ctx) => (await ctx.storageState()).cookies.find((c) => c.name === 'csrf').value;
async function call(ctx, method, path, data) {
  const res = await ctx.fetch(path, { method, data, headers: { 'X-CSRF-Token': await csrf(ctx) } });
  if (res.status() >= 300) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function account(path, data) {
  const ctx = await request.newContext({ baseURL: base });
  const res = await ctx.post(path, { data });
  if (res.status() >= 300) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
  return ctx;
}

// Учитель: класс, два предмета с опубликованной темой и квизом, выданные классу; задания — просроченное и два с
// будущим сроком.
const teacher = await account('/api/auth/register', {
  role: 'teacher',
  email: `nav2.${uid}@example.kz`,
  displayName: 'Алия Сапарова',
  password: 'teacher-pass-1',
});
const cls = await call(teacher, 'POST', '/api/teacher/classes', { name: '7 «А»' });
const { code } = await call(teacher, 'POST', `/api/teacher/classes/${cls.id}/invite-codes`);
async function ownSubject(title, description, topicTitle) {
  const subject = await call(teacher, 'POST', '/api/teacher/subjects', {
    translations: { ru: { title, description } },
    inPublicCatalog: false,
  });
  const topic = await call(teacher, 'POST', `/api/teacher/subjects/${subject.id}/topics`);
  await call(teacher, 'PUT', `/api/teacher/topics/${topic.id}`, {
    translations: {
      ru: {
        title: topicTitle,
        summary: 'Как растения получают энергию солнца.',
        bodyMd: 'Листья улавливают свет, а хлорофилл превращает его в энергию для роста растения.',
      },
    },
    materialIds: [],
  });
  for (let q = 1; q <= 2; q++) {
    await call(teacher, 'POST', `/api/teacher/topics/${topic.id}/quiz/questions`, {
      type: 'single_choice',
      difficulty: 'easy',
      translations: { ru: { text: `Вопрос ${q}?` } },
      options: [0, 1, 2, 3].map((i) => ({ translations: { ru: `Ответ ${q}.${i}` }, isCorrect: i === 0 })),
    });
  }
  await call(teacher, 'POST', `/api/teacher/topics/${topic.id}/publish`, {});
  await call(teacher, 'POST', `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
  return { subjectId: subject.id, topicId: topic.id };
}
const botany = await ownSubject('Ботаника', 'Растения вокруг нас', 'Фотосинтез');
const ecology = await ownSubject('Экология края', 'Природа родного региона', 'Степь и её жители');
for (const [topic, days] of [
  [botany, -1],
  [ecology, 2],
  [botany, 5],
]) {
  await call(teacher, 'POST', '/api/teacher/assignments', {
    classId: cls.id,
    subjectId: topic.subjectId,
    topicId: topic.topicId,
    dueAt: new Date(Date.now() + days * DAY).toISOString(),
  });
}

// Ученик в классе: квиз базового урока → бейдж «Первый шаг» (точка у «Достижений»).
const student = await account('/api/auth/register-student', {
  displayName: 'Асель Нурова',
  login: `nav2.${uid}`,
  password: 'student-pass-1',
  code,
});
const anon = await request.newContext({ baseURL: base });
const json = async (path) => (await anon.get(path)).json();
const catalog = await json('/api/public/catalog');
const biology = catalog.sections.find((s) => s.title === 'Биология') ?? catalog.sections[0];
const section = await json(`/api/public/sections/${biology.id}`);
const anatomy = section.subjects.find((s) => s.status === 'available');
const baseTopic = (await json(`/api/public/subjects/${anatomy.id}`)).topics[0].id;
const lesson = await (await student.get(`/api/student/topics/${baseTopic}`)).json();
const attempt = await call(student, 'POST', `/api/student/quizzes/${lesson.quizId}/attempts`);
await call(student, 'POST', `/api/student/attempts/${attempt.attemptId}/finish`);
const loner = await account('/api/auth/register-student', {
  displayName: 'Ерлан Ахметов',
  login: `nav2.solo.${uid}`,
  password: 'student-pass-1',
});

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
const settle = (page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
async function shot(page, path, file, after) {
  await page.goto(`${base}/ru${path}`);
  await page.waitForLoadState('networkidle');
  if (after) await after(page);
  await settle(page);
  await page.screenshot({ path: `${out}/${file}` });
  log('✓', file);
}
const counters = (page) => page.getByTestId('nav-badge-count').filter({ visible: true }).first().waitFor();

// Панель со счётчиками — до открытия «Мой класс» и «Достижений» (точки ещё есть).
await shot(await pageFor(student, 1440, false), '/learn/progress', 'nav2-panel-expanded-1440.png', counters);
await shot(await pageFor(student, 1440, true), '/learn/progress', 'nav2-panel-collapsed-1440.png', (p) =>
  p.getByTestId('nav-badge-dot').first().waitFor(),
);
await shot(await pageFor(student, 390, false), '/learn/progress', 'nav2-menu-390.png', async (p) => {
  await p.getByRole('button', { name: 'Меню' }).click();
  await p.getByTestId('mobile-menu-panel').waitFor();
  await counters(p);
});
await shot(await pageFor(student, 1440, false), '/learn/subjects', 'nav2-catalog-1440.png');
await shot(await pageFor(student, 1440, false), '/learn/class', 'nav2-my-class-1440.png', (p) =>
  p.getByTestId('class-subject').first().waitFor(),
);
await shot(await pageFor(loner, 1440, false), '/learn/class', 'nav2-my-class-no-class-1440.png', (p) =>
  p.getByTestId('student-join').waitFor(),
);
await shot(
  await pageFor(student, 1440, false),
  `/learn/topics/${botany.topicId}`,
  'nav2-class-lesson-1440.png',
  (p) => p.getByTestId('lesson-overview').waitFor(),
);
await browser.close();
