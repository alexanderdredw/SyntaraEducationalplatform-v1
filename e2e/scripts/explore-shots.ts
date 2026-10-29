/* global document */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, request, test, type Page } from '@playwright/test';
import { setTopicMastery } from '../tests/db';

// Снимки И1 (docs/EXPLORE_TZ.md, «Остановка И1»): «Исследовать» — карточки, список, поиск, фильтры (телефон —
// открытые), быстрый просмотр; окно элемента — иллюстрация и модель Бора, мини-таблица, вкладки и аккордеон групп.
// 1440 и 390 px, тёмная тема + светлая для «Исследовать» → docs/media/explore/*.webp (WebP q85, ширина ≤ 1600 px).
// Ученик с прогрессом (освоено 3, начато 3). Запуск из папки e2e: npx playwright test -c scripts/explore-shots.config.ts
// (OUT=<папка> — сохранить в другую папку).
const root = `${resolve(__dirname, '../..')}/`;
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const out = process.env.OUT ? `${process.env.OUT}/` : `${root}docs/media/explore/`;

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(700);
  const png = await page.screenshot({ fullPage: full });
  await sharp(png)
    .resize({ width: 1600, height: 4000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${name}.webp`);
  console.warn('saved', name);
}

test('И1 screenshots: Explore and the element window', async ({ page, baseURL }) => {
  const api = await request.newContext({ baseURL });
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const base = `/ru/learn/subjects/${id}`;
  const atlas = await (await api.get(`/api/public/subjects/${id}/atlas`)).json();
  const topic = (code: string) =>
    atlas.elements.find((e: { code: string }) => e.code === code).topicId as string;

  // Ученик: освоено (тест ≥ 80 %) — водород, гелий, кислород; начато — литий (60 %), железо (40 %), углерод (окно).
  const login = `exp.${randomUUID().slice(0, 8)}`;
  const me = await request.newContext({ baseURL });
  const res = await me.post('/api/auth/register-student', {
    data: { displayName: 'Айдана Исследователь', login, password: 'student-pass-1' },
  });
  expect(res.status()).toBeLessThan(300);
  for (const [code, percent] of [
    ['hydrogen', 100],
    ['helium', 90],
    ['oxygen', 85],
    ['lithium', 60],
    ['iron', 40],
  ] as const)
    await setTopicMastery(login, topic(code), percent);
  const csrf = (await me.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
  await me.post('/api/student/events', {
    data: { type: 'lesson_opened', topicId: topic('carbon'), idempotencyKey: `shot:${login}` },
    headers: { 'X-CSRF-Token': csrf },
  });
  const { cookies } = await me.storageState();

  await page.context().addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    }),
  );
  const theme = async (value: 'dark' | 'light') => {
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([
        ...cookies.map(({ name, value: v }) => ({ name, value: v, url: baseURL! })),
        { name: 'theme', value, url: baseURL! },
        { name: 'consent', value: 'necessary', url: baseURL! },
      ]);
  };

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    for (const t of ['dark', 'light'] as const) {
      await theme(t);
      await page.goto(`${base}/explore`, { waitUntil: 'networkidle' });
      await page.getByTestId('atlas-progress').waitFor();
      await shot(page, `explore-cards-${width}-${t}`);
    }
    await theme('dark');
    await page.goto(`${base}/explore?view=list`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-list').waitFor();
    await shot(page, `explore-list-${width}`);
    await page.goto(`${base}/explore?q=${encodeURIComponent('желез')}`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-card').first().waitFor();
    await shot(page, `explore-search-${width}`);
    await page.goto(`${base}/explore?family=alkali_metal,halogen&status=started,mastered&sort=alpha`, {
      waitUntil: 'networkidle',
    });
    await page.getByTestId('atlas-toolbar').scrollIntoViewIfNeeded();
    await shot(page, `explore-filters-${width}`);
    await page.goto(`${base}/explore`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-quick-open').first().click();
    await page.getByTestId('atlas-quick').locator('li').first().waitFor();
    await shot(page, `explore-quick-${width}`);

    // Окно элемента: иллюстрация (водород) и модель Бора (литий — из списка 11, по умолчанию Бор).
    await page.goto(`${base}/explore/hydrogen`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-element-image').waitFor();
    await shot(page, `element-illustration-${width}`);
    await page.goto(`${base}/explore/sodium`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-bohr').waitFor();
    await shot(page, `element-bohr-${width}`);
    await page.getByTestId('atlas-mini-table').scrollIntoViewIfNeeded();
    await shot(page, `element-mini-${width}`);
    if (width > 600) {
      await page.getByTestId('atlas-element-window').getByRole('tab').nth(2).click();
      await page.getByTestId('atlas-tabs').scrollIntoViewIfNeeded();
      await shot(page, `element-tabs-${width}`);
    } else {
      await page.getByTestId('atlas-accordion').scrollIntoViewIfNeeded();
      await shot(page, `element-accordion-${width}`);
    }
  }
});
