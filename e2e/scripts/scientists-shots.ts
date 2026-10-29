/* global document */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

// Снимки S1 (docs/SCIENTISTS_TZ.md, раздел 6): список «Учёные» (тёмная и светлая тема), окно учёного, окно элемента
// с вкладками, карточка «AI-помощник» и ответ в панели или шторке (REQ-SCI-09 ред. 2); 1440 и 390 px → docs/media/scientists/*.webp (WebP q85, ширина ≤ 1600 px). Ученик отметил 3 учёных —
// видны отметки «Изучено» и приглашение. Запуск из папки e2e: npx playwright test -c scripts/scientists-shots.config.ts
const root = `${resolve(__dirname, '../..')}/`;
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const out = `${root}docs/media/scientists/`;
const uid = () => randomUUID().slice(0, 8);

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(800);
  const png = await page.screenshot({ fullPage: full });
  await sharp(png)
    .resize({ width: 1600, height: 3600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${name}.webp`);
  console.warn('saved', name);
}

async function student(baseURL: string): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/register-student', {
    data: { displayName: 'Айдана Атлас', login: `sci.${uid()}`, password: 'student-pass-1' },
  });
  expect(res.status()).toBeLessThan(300);
  return api;
}

test('S1 screenshots: scientists list, scientist window, element window with tabs', async ({
  page,
  baseURL,
}) => {
  const api = await request.newContext({ baseURL });
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  const base = `/ru/learn/subjects/${id}`;

  const me = await student(baseURL!);
  const csrf = (await me.storageState()).cookies.find((c) => c.name === 'csrf')!.value;
  for (const code of ['lavoisier', 'mendeleev', 'curie'])
    expect(
      (
        await me.put(`/api/student/subjects/${id}/atlas/scientists/${code}/studied`, {
          data: { studied: true },
          headers: { 'X-CSRF-Token': csrf },
        })
      ).status(),
    ).toBe(200);
  const { cookies } = await me.storageState();
  await page.context().addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.append(style);
    }),
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    for (const theme of ['dark', 'light']) {
      await page.context().clearCookies();
      await page
        .context()
        .addCookies([
          ...cookies.map(({ name, value }) => ({ name, value, url: baseURL! })),
          { name: 'theme', value: theme, url: baseURL! },
          { name: 'consent', value: 'necessary', url: baseURL! },
        ]);
      await page.goto(`${base}/scientists`, { waitUntil: 'networkidle' });
      await page.getByTestId('atlas-check-panel').waitFor();
      await shot(page, `scientists-list-${width}-${theme}`);
      await page.getByTestId('atlas-sci-invite').scrollIntoViewIfNeeded();
      await shot(page, `scientists-grid-${width}-${theme}`);
    }
    // Мини-карточка по наведению (компьютер).
    if (width > 600) {
      await page.context().addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
      await page.goto(`${base}/scientists`, { waitUntil: 'networkidle' });
      await page.locator('[data-testid="atlas-lifeline"][data-code="mendeleev"]').hover();
      await shot(page, `scientists-lifeline-hover-${width}-dark`);
    }
    await page.context().addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
    // Окно учёного: вкладки, цитата, «Спросить Syntara AI», современники, «Изучено», навигация.
    await page.goto(`${base}/scientists/mendeleev`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-scientist-window').waitFor();
    await shot(page, `scientist-window-${width}-dark`);
    await page.getByTestId('atlas-tabs').scrollIntoViewIfNeeded();
    await shot(page, `scientist-window-tabs-${width}-dark`);
    // Карточка «AI-помощник» и ответ в панели (компьютер) или шторке (телефон) — REQ-SCI-09 ред. 2.
    await page.getByTestId('atlas-ai-card').scrollIntoViewIfNeeded();
    await shot(page, `scientist-ai-card-${width}-dark`);
    await page.getByTestId('atlas-ai-prompt').first().click();
    await page.getByTestId('atlas-ai-panel').waitFor();
    await page
      .getByTestId('tutor-assistant-message')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => undefined);
    await shot(page, `scientist-ai-${width > 600 ? 'panel' : 'sheet'}-${width}-dark`);
    await page.getByTestId('atlas-ai-panel-close').click();
    await page.getByTestId('atlas-sci-studied').scrollIntoViewIfNeeded();
    await shot(page, `scientist-window-footer-${width}-dark`);
    await page.goto(`${base}/scientists/curie`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-sci-quote').scrollIntoViewIfNeeded();
    await shot(page, `scientist-window-quote-${width}-dark`);
    // Окно элемента: вкладки по разделам урока.
    await page.goto(`${base}/explore/oxygen`, { waitUntil: 'networkidle' });
    await page.getByTestId('atlas-element-window').waitFor();
    await page.getByTestId('atlas-tabs').scrollIntoViewIfNeeded();
    await shot(page, `element-window-tabs-${width}-dark`);
    await page.getByTestId('atlas-ai-card').scrollIntoViewIfNeeded();
    await shot(page, `element-ai-card-${width}-dark`);
    await page.getByTestId('atlas-ai-prompt').nth(2).click();
    await page.getByTestId('atlas-ai-panel').waitFor();
    await page
      .getByTestId('tutor-assistant-message')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => undefined);
    await shot(page, `element-ai-${width > 600 ? 'panel' : 'sheet'}-${width}-dark`);
  }
});
