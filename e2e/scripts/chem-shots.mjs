// Снимки «Химии» для отчёта по docs/CHEM_TZ.md (раздел 9): страница предмета с таблицей и главами (компьютер и
// телефон), урок элемента, «Учёные-химики» с лентой, глоссарий с поиском, таблица в тёмной и светлой теме.
// → docs/media/chem/*.webp (WebP q85, ширина ≤ 1600 px, CLAUDE.md). Нужны запущенные web и api. Запуск из папки e2e:
// node scripts/chem-shots.mjs
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, request } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const out = `${root}docs/media/chem/`;
mkdirSync(out, { recursive: true });

// Ученик (статусы тем видны) и ID «Химии» — через API.
const api = await request.newContext({ baseURL: base });
await api.post('/api/auth/register-student', {
  data: {
    displayName: 'Айдана Химик',
    login: `chemshot.${randomUUID().slice(0, 8)}`,
    password: 'student-pass-1',
  },
});
const catalog = await (await api.get('/api/public/catalog')).json();
const natural = catalog.sections.find((s) => s.title === 'Естественные науки');
const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
const chemistry = section.subjects.find((s) => s.title === 'Химия');
const subject = await (await api.get(`/api/public/subjects/${chemistry.id}`)).json();
const topic = (title) => subject.topics.find((t) => t.title === title).id;
const { cookies } = await api.storageState();

const browser = await chromium.launch();
async function shot(name, { width, height, theme = 'dark', path, prepare, element }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addCookies([
    ...cookies.map(({ name: n, value }) => ({ name: n, value, url: base })),
    { name: 'theme', value: theme, url: base },
    { name: 'consent', value: 'necessary', url: base },
  ]);
  const page = await context.newPage();
  await page.goto(`${base}${path}`);
  await page.locator('#main').waitFor();
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  const png = element ? await page.locator(element).screenshot() : await page.screenshot();
  await sharp(png)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${name}.webp`);
  console.warn(`${name}.webp`);
  await context.close();
}

const subjectPath = `/ru/learn/subjects/${chemistry.id}`;
// Урок кислорода открыт — на таблице у ученика статус «в процессе».
await shot('element-lesson-1440', {
  width: 1440,
  height: 1100,
  path: `/ru/learn/topics/${topic('Кислород')}`,
  prepare: (page) => page.getByTestId('lesson-overview').getByRole('button').first().click(),
});
await shot('subject-1440', { width: 1440, height: 1500, path: subjectPath, prepare: waitTable });
await shot('subject-390', { width: 390, height: 1400, path: subjectPath, prepare: waitTable });
await shot('chemists-timeline-1440', {
  width: 1440,
  height: 1100,
  path: `/ru/learn/topics/${topic('Учёные-химики')}`,
});
await shot('chemists-timeline-390', {
  width: 390,
  height: 1400,
  path: `/ru/learn/topics/${topic('Учёные-химики')}`,
  prepare: (page) => page.getByTestId('lesson-timeline').scrollIntoViewIfNeeded(),
});
await shot('glossary-search-1440', {
  width: 1440,
  height: 1000,
  path: `${subjectPath}/glossary`,
  prepare: (page) => page.getByTestId('glossary-search').fill('атом'),
});
for (const theme of ['dark', 'light'])
  await shot(`ptable-${theme}-1440`, {
    width: 1440,
    height: 1200,
    theme,
    path: subjectPath,
    prepare: waitTable,
    element: '[data-testid="periodic-table"]',
  });
await browser.close();

async function waitTable(page) {
  await page.getByTestId('ptable-cell').first().waitFor();
}
