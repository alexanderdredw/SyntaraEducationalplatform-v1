/* global document */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { request, test, type Page } from '@playwright/test';

// Снимки S1b (docs/SCIENTISTS_TZ.md, раздел 6): окно учёного с ключевыми фактами, связанными элементами (активные и
// «Скоро»), подсказками AI по учёному и источниками; переход «Скоро» → ячейка таблицы. 1440 и 390 px, тёмная тема →
// docs/media/scientists/s1b-*.webp (WebP q85, ширина ≤ 1600 px). Запуск из папки e2e:
// npx playwright test -c scripts/s1b-shots.config.ts (OUT=<папка> — сохранить в другую папку).
const root = `${resolve(__dirname, '../..')}/`;
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const out = process.env.OUT ? `${process.env.OUT}/` : `${root}docs/media/scientists/`;

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(800);
  const png = await page.screenshot({ fullPage: full });
  await sharp(png)
    .resize({ width: 1600, height: 3600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${name}.webp`);
  console.warn('saved', name);
}

test('S1b screenshots: key facts, related elements, prompts, sources', async ({ page, baseURL }) => {
  const api = await request.newContext({ baseURL });
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const base = `/ru/learn/subjects/${id}`;
  await page.context().addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    }),
  );
  await page.context().addCookies([
    { name: 'theme', value: 'dark', url: baseURL! },
    { name: 'consent', value: 'necessary', url: baseURL! },
  ]);

  // Компьютер: факты, элементы, подсказки и источники одним кадром; «Скоро» → ячейка таблицы.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/scientists/curie`, { waitUntil: 'networkidle' });
  await page.getByTestId('atlas-sci-facts').scrollIntoViewIfNeeded();
  await shot(page, 's1b-curie-1440');
  await page.locator('[data-testid="atlas-sci-element"][data-soon="true"]').first().click();
  await page.getByTestId('atlas-table').waitFor();
  await shot(page, 's1b-soon-cell-1440');
  // Телефон: факты и элементы под портретом; подсказки по учёному.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/scientists/rutherford`, { waitUntil: 'networkidle' });
  await page.getByTestId('atlas-sci-facts').scrollIntoViewIfNeeded();
  await shot(page, 's1b-rutherford-390');
  await page.getByTestId('atlas-ai-card').scrollIntoViewIfNeeded();
  await shot(page, 's1b-rutherford-ai-390');
});
