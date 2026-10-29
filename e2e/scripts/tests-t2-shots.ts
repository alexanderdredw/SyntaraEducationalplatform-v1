/* global document */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, request, test, type Page } from '@playwright/test';
import { answerAtlas, type QuizElement } from '../tests/atlas-solver';

// Снимки T2 (docs/TESTS_TZ.md, раздел 9): каждый тип вопроса квиза атласа и режимы, 1440 и 390 px, тёмная тема →
// docs/media/tests/t2-*.webp (WebP q85, ширина ≤ 1600 px). Тип и уровень вопроса — из ответов API: верные ответы
// поднимают уровень (сложные типы), неверные — опускают (лёгкие).
const root = `${resolve(__dirname, '../..')}/`;
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const out = `${root}docs/media/tests/`;
const uid = () => randomUUID().slice(0, 8);

const LEVEL1 = ['symbol-to-name', 'name-to-symbol', 'bohr-count'];
const TARGETS = [
  ...LEVEL1,
  'fact-true-false',
  'description',
  'bohr-element',
  'table-click',
  'config',
  'fun-fact',
  'type-symbol',
];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  const png = await page.screenshot();
  await sharp(png)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${name}.webp`);
  console.warn('saved', name);
}

async function setup(page: Page, baseURL: string, width: number) {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register-student', {
    data: { displayName: 'Айдана Атлас', login: `t2s.${uid()}`, password: 'student-pass-1' },
  });
  expect(res.status()).toBeLessThan(300);
  const { cookies } = await api.storageState();
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([
      ...cookies.map(({ name, value }) => ({ name, value, url: baseURL })),
      { name: 'theme', value: 'dark', url: baseURL },
      { name: 'consent', value: 'necessary', url: baseURL },
    ]);
}

async function chemistry(baseURL: string) {
  const api = await request.newContext({ baseURL });
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const atlas = await (await api.get(`/api/public/subjects/${id}/atlas`)).json();
  return { base: `/ru/learn/subjects/${id}`, elements: atlas.elements as QuizElement[] };
}

/** Текущий вопрос по ответам API: тип и сложность. */
function track(page: Page) {
  const current = { type: '', difficulty: '' };
  page.on('response', async (res) => {
    if (
      !/\/api\/student\/(subjects\/[^/]+\/)?atlas-quiz/.test(res.url()) ||
      res.request().method() === 'OPTIONS'
    )
      return;
    const body = await res.json().catch(() => null);
    const q = body?.next !== undefined ? body.next : body?.question;
    if (q) Object.assign(current, { type: q.type, difficulty: q.difficulty });
  });
  return current;
}

const key = (c: { type: string; difficulty: string }) =>
  c.type === 'bohr' ? `bohr-${c.difficulty === 'easy' ? 'count' : 'element'}` : c.type;

test('T2 screenshots: every question type and the modes, 1440 and 390', async ({ page, baseURL }) => {
  const chem = await chemistry(baseURL!);
  await page.context().addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    }),
  );
  for (const width of [1440, 390]) {
    const focus = async () => page.getByTestId('atest-panel').scrollIntoViewIfNeeded();
    await setup(page, baseURL!, width);
    const current = track(page);

    /* Стартовый экран: режимы; «По семейству» — с выбором семейства. */
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-family').check();
    await page.getByTestId('atlas-quiz-modes').scrollIntoViewIfNeeded();
    await shot(page, `t2-modes-${width}-dark`);

    /* «Работа над ошибками» без ошибок. */
    await page.getByTestId('atlas-quiz-mode-mistakes').check();
    await page.getByTestId('atlas-quiz-start').click();
    await page.getByTestId('atlas-quiz-no-mistakes').scrollIntoViewIfNeeded();
    await shot(page, `t2-mode-mistakes-empty-${width}-dark`);

    /* Каждый тип вопроса. */
    const seen = new Set<string>();
    for (let session = 0; session < 10 && seen.size < TARGETS.length; session++) {
      await page.goto(`${chem.base}/quiz`);
      await page.getByTestId('atlas-quiz-start').click();
      for (let i = 0; i < 10; i++) {
        await expect(page.getByTestId('atest-question')).toBeVisible();
        await expect.poll(() => current.type).not.toBe('');
        const k = key(current);
        if (TARGETS.includes(k) && !seen.has(k)) {
          seen.add(k);
          await focus();
          await shot(page, `t2-type-${k}-${width}-dark`);
          if (k === 'type-symbol') {
            // «ca» вместо «Ca» — подсказка про заглавную букву.
            const text = (await page.getByTestId('atest-question').textContent()) ?? '';
            const name = /«(.+)»/.exec(text)![1];
            current.type = '';
            await page
              .locator('.atest-input')
              .fill(chem.elements.find((e) => e.title === name)!.symbol.toLowerCase());
            await page.locator('.atest-input').press('Enter');
            await page.getByTestId('atest-case').waitFor();
            await page.getByTestId('atest-feedback').evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await shot(page, `t2-type-symbol-case-${width}-dark`);
            await page.getByTestId('atest-next').click();
            continue;
          }
          if (k === 'table-click') {
            current.type = '';
            await answerAtlas(page, chem.elements);
            await page.getByTestId('atest-feedback').scrollIntoViewIfNeeded();
            await shot(page, `t2-type-table-click-answer-${width}-dark`);
            await page.getByTestId('atest-next').click();
            continue;
          }
        }
        // Нужны лёгкие типы — ошибаемся (уровень вниз), иначе — верно (уровень вверх).
        const wantEasy = LEVEL1.some((t) => !seen.has(t)) && current.difficulty !== 'easy';
        current.type = '';
        await answerAtlas(page, chem.elements, wantEasy);
        await page.getByTestId('atest-next').click();
      }
    }
    expect([...seen].sort()).toEqual([...TARGETS].sort());

    /* «Таблица-челлендж» с «50/50» (подсвечены два периода). */
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-table').check();
    await page.getByTestId('atlas-quiz-start').click();
    await page.getByTestId('atest-hint').click();
    await page.locator('.atest-table-status').filter({ hasText: /\S/ }).waitFor();
    await focus();
    await shot(page, `t2-mode-table-hint-${width}-dark`);

    /* «По семейству» — галогены. */
    await page.goto(`${chem.base}/quiz`);
    await page.getByTestId('atlas-quiz-mode-family').check();
    await page.getByTestId('atlas-quiz-family').selectOption('halogen');
    await page.getByTestId('atlas-quiz-start').click();
    await answerAtlas(page, chem.elements);
    await page.getByTestId('atest-feedback').scrollIntoViewIfNeeded();
    await shot(page, `t2-mode-family-${width}-dark`);
  }
});
