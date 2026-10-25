// Скриншоты «после» docs/PROFILE_TZ_2.md (раздел 8): «Обзор» ученика и учителя, календарь активности, заполненность,
// «Редактировать профиль» с предпросмотром, «Настройки» с устройствами, пароль с индикатором, «Данные»; обе темы,
// 1440 и 390 px. Запуск: node e2e/scripts/profile-v2-shots.mjs <каталог> [baseURL]. Нужны web, api (без лимитов форм),
// worker, MinIO и DATABASE_URL (история активности ученика пишется в learning_events напрямую).
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, request } from '@playwright/test';
import postgres from 'postgres';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3000';
mkdirSync(out, { recursive: true });
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const uid = () => randomUUID().slice(0, 6);

/** «Портрет» 480×480 — мягкий градиент с кругом (вместо фотографии). */
function png(size = 480) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2, y - size * 0.42) / size;
      const head = d < 0.16;
      const body = y > size * 0.62 && Math.abs(x - size / 2) < size * 0.3;
      const [r, g, b] =
        head || body ? [236, 196, 160] : [40 + (x * 80) / size, 110 + (y * 60) / size, 200 - (y * 40) / size];
      row.set([r, g, b], 1 + x * 3);
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

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

async function account(path, data) {
  const ctx = await request.newContext({ baseURL: base, userAgent: MAC_CHROME });
  const res = await ctx.post(path, { data });
  if (res.status() >= 300) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
  const csrf = () => ctx.storageState().then((s) => s.cookies.find((c) => c.name === 'csrf').value);
  ctx.call = async (method, p, body = method === 'GET' ? undefined : {}) => {
    const r = await ctx.fetch(p, { method, data: body, headers: { 'X-CSRF-Token': await csrf() } });
    if (r.status() >= 300) throw new Error(`${method} ${p} → ${r.status()} ${await r.text()}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  return ctx;
}

// Учитель: должность, «О себе», своя картинка (проверка и перекодирование — worker).
const teacher = await account('/api/auth/register', {
  role: 'teacher',
  email: `prf.${uid()}@example.kz`,
  displayName: 'Алия Сапарова',
  password: 'teacher-pass-1',
});
await teacher.call('PATCH', '/api/me/profile', {
  position: 'Учитель биологии',
  about: 'Веду биологию 12 лет. Люблю походы и гербарии — приносите вопросы о растениях!',
});
const photo = png();
const issued = await teacher.call('POST', '/api/me/avatar/upload-url', {
  fileName: 'portrait.png',
  mime: 'image/png',
  size: photo.length,
});
const put = await fetch(issued.uploadUrl, { method: 'PUT', headers: issued.headers, body: photo });
if (!put.ok) throw new Error(`upload ${put.status}`);
await teacher.call('POST', `/api/files/${issued.mediaId}/complete`);
await teacher.call('PUT', '/api/me/avatar', { kind: 'photo', mediaId: issued.mediaId });
for (let i = 0; i < 60; i++) {
  const p = await teacher.call('GET', '/api/me/profile');
  if (p.avatar.photoStatus !== 'pending') {
    log('teacher photo:', p.avatar.photoStatus);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}

// Класс, предмет с темой и квизом, задания; ученики с аватарами набора.
const cls = await teacher.call('POST', '/api/teacher/classes', { name: '7 «Б»' });
const { code } = await teacher.call('POST', `/api/teacher/classes/${cls.id}/invite-codes`);
const subject = await teacher.call('POST', '/api/teacher/subjects', {
  translations: { ru: { title: 'Ботаника', description: 'Растения вокруг нас' } },
  inPublicCatalog: false,
});
const topic = await teacher.call('POST', `/api/teacher/subjects/${subject.id}/topics`);
await teacher.call('PUT', `/api/teacher/topics/${topic.id}`, {
  translations: { ru: { title: 'Строение корня' } },
  materialIds: [],
});
await teacher.call('POST', `/api/teacher/topics/${topic.id}/quiz/questions`, {
  type: 'single_choice',
  difficulty: 'easy',
  translations: { ru: { text: 'Какая часть корня всасывает воду?' } },
  options: ['Корневые волоски', 'Корневой чехлик'].map((t, i) => ({
    translations: { ru: t },
    isCorrect: i === 0,
  })),
});
await teacher.call('POST', `/api/teacher/topics/${topic.id}/publish`);
await teacher.call('POST', `/api/teacher/subjects/${subject.id}/access`, { classId: cls.id });
for (const days of [2, 6, 11]) {
  await teacher.call('POST', '/api/teacher/assignments', {
    classId: cls.id,
    subjectId: subject.id,
    topicId: topic.id,
    dueAt: new Date(Date.now() + days * 86_400_000).toISOString(),
  });
}

const student = await account('/api/auth/register-student', {
  displayName: 'Асель Нурова',
  login: `asel.${uid()}`,
  password: 'student-pass-1',
  code,
});
await student.call('PUT', '/api/me/avatar', { kind: 'preset', preset: 'fox' });
const lesson = await student.call('GET', `/api/student/topics/${topic.id}`);
const attempt = await student.call('POST', `/api/student/quizzes/${lesson.quizId}/attempts`);
for (const q of attempt.questions)
  await student.call('POST', `/api/student/attempts/${attempt.attemptId}/answers`, {
    questionId: q.id,
    optionId: q.options.find((o) => o.text === 'Корневые волоски').id,
  });
await student.call('POST', `/api/student/attempts/${attempt.attemptId}/finish`);
for (const [name, preset] of [
  ['Ерлан Сапаров', 'owl'],
  ['Мадина Касым', 'rocket'],
  ['Даниял Ахмет', null],
]) {
  const s = await account('/api/auth/register-student', {
    displayName: name,
    login: `s.${uid()}`,
    password: 'student-pass-1',
    code,
  });
  if (preset) await s.call('PUT', '/api/me/avatar', { kind: 'preset', preset });
  else await s.call('PUT', '/api/me/avatar', { kind: 'initials', color: 'teal' });
}

// История активности ученика за 12 недель (календарь, REQ-PRF-21) — как события урока и квиза.
const me = await student.call('GET', '/api/me');
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // .env нет — DATABASE_URL из окружения.
}
const sql = postgres(process.env.DATABASE_URL.replace(':6432/', ':5432/'), { max: 1, prepare: false });
for (let day = 1; day < 84; day++) {
  const count = [0, 0, 1, 2, 3, 5, 8][(day * 7 + (day % 5) * 3) % 7];
  if (day % 9 === 0 || count === 0) continue;
  const at = new Date(Date.now() - day * 86_400_000);
  at.setUTCHours(7, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    await sql`INSERT INTO learning_events (id, student_id, type, occurred_at, idempotency_key)
      VALUES (gen_random_uuid(), ${me.id}, ${i % 2 ? 'quiz_finished' : 'lesson_opened'}, ${at}, ${randomUUID()})`;
  }
}
await sql.end();

// Другие устройства (REQ-PRF-32) и запросы «Данные» (REQ-PRF-34).
const studentLogin = (await student.call('GET', '/api/me/profile')).login;
for (const userAgent of [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
]) {
  const device = await request.newContext({ baseURL: base, userAgent });
  await device.post('/api/auth/login', { data: { email: studentLogin, password: 'student-pass-1' } });
}
await student.call('POST', '/api/me/data-requests', { type: 'export' });

const browser = await chromium.launch();
async function shot(state, name, path, { width = 1440, theme = 'dark', prepare, full = true, element } = {}) {
  const ctx = await browser.newContext({
    storageState: await state.storageState(),
    viewport: { width, height: width < 768 ? 844 : 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    userAgent: MAC_CHROME,
  });
  await ctx.addCookies([{ name: 'consent', value: 'necessary', url: base }]);
  const page = await ctx.newPage();
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  if (prepare) await prepare(page);
  // Полная страница — от верха: иначе закреплённый хедер попадает в середину снимка.
  if (!element) await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(300);
  if (element) await page.getByTestId(element).screenshot({ path: `${out}/${name}.png` });
  else await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  log('saved', name);
  await ctx.close();
}

const password = async (page) => {
  const form = page.getByTestId('password-form');
  await form.getByLabel(/^Текущий пароль/).fill('student-pass-1');
  await form.getByLabel(/^Новый пароль/).fill('Ботаника-2026!');
  await form.getByLabel(/^Повторите/).fill('Ботаника-2026!');
};
for (const width of [1440, 390]) {
  for (const theme of ['dark', 'light']) {
    const o = { width, theme };
    await shot(student, `overview-student-${theme}-${width}`, '/ru/account', o);
    await shot(teacher, `overview-teacher-${theme}-${width}`, '/ru/account', o);
    await shot(student, `calendar-${theme}-${width}`, '/ru/account', { ...o, element: 'activity-calendar' });
    await shot(student, `edit-profile-student-preview-${theme}-${width}`, '/ru/account/profile', {
      ...o,
      prepare: async (page) => {
        await page.getByRole('radio', { name: 'Из набора' }).click();
        await page.getByLabel(/^Фамилия/).fill('Нурова-Ким');
      },
    });
    await shot(teacher, `edit-profile-teacher-${theme}-${width}`, '/ru/account/profile', o);
    await shot(student, `settings-student-${theme}-${width}`, '/ru/account/settings', o);
    await shot(student, `settings-password-meter-${theme}-${width}`, '/ru/account/settings', {
      ...o,
      element: 'settings-password',
      prepare: password,
    });
    await shot(student, `settings-devices-${theme}-${width}`, '/ru/account/settings', {
      ...o,
      element: 'settings-security',
    });
    await shot(student, `data-requests-${theme}-${width}`, '/ru/account/privacy', o);
  }
}
await shot(student, 'completeness-dark-1440', '/ru/account', { element: 'profile-completeness' });
await shot(student, 'completeness-light-390', '/ru/account', {
  width: 390,
  theme: 'light',
  element: 'profile-completeness',
});
await browser.close();
