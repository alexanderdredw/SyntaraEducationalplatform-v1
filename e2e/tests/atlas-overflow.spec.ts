import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies } from './support';

const WIDTHS = [320, 390, 768, 1024, 1280, 1440, 1920];

async function chemistry(api: APIRequestContext) {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const natural = catalog.sections.find((s: { title: string }) => s.title === 'Естественные науки');
  const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
  const id = section.subjects.find((s: { title: string }) => s.title === 'Химия').id as string;
  return `/ru/learn/subjects/${id}`;
}

/** Страница не прокручивается по горизонтали. */
const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Видимые элементы окна, вылезающие за край экрана (или за свой обрезающий контейнер с overflow ≠ visible — его
 * содержимое прокручивается внутри и края не нарушает).
 */
const windowOverflow = (page: Page, testId: string) =>
  page.evaluate((id) => {
    const root = document.querySelector(`[data-testid="${id}"]`);
    if (!root) return ['no window'];
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o !== 'visible') {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      if (r.right > width + 1 || r.left < -1)
        out.push(`${el.tagName}.${el.className} ${Math.round(r.left)}–${Math.round(r.right)} / ${width}`);
    }
    return out.slice(0, 5);
  }, testId);

/**
 * Регресс 9940c6d: окно элемента на компьютере раздвигалось строкой вкладок и карточкой AI (картинка атома
 * пропадала, у страницы появлялась горизонтальная прокрутка). REQ-SCI-05, REQ-SCI-06, AC-SCI-10, REQ-ATL-02.5.
 */
test.describe('Атлас — без горизонтального переполнения (320…1920 px)', () => {
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('AC-SCI-10 element windows (Водород, Празеодим — longest section names), the scientist window, Explore and «Учёные»', async ({
    page,
    baseURL,
  }, testInfo) => {
    // Ширины задаёт сам тест — один прогон достаточно.
    test.skip(testInfo.project.name !== 'desktop-1440', 'one project sets every width');
    test.setTimeout(240_000);
    const base = await chemistry(await request.newContext({ baseURL }));
    const windows: Array<[string, string]> = [
      ['/explore/hydrogen', 'atlas-element-window'],
      ['/explore/praseodymium', 'atlas-element-window'],
      ['/scientists/mendeleev', 'atlas-scientist-window'],
    ];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, testId] of windows) {
        await page.goto(`${base}${path}`);
        await page.getByTestId(testId).waitFor();
        await expect(page.getByTestId('atlas-ai-card')).toBeVisible();
        expect(await pageOverflow(page), `${path} @ ${width}`).toBeLessThanOrEqual(0);
        expect(await windowOverflow(page, testId), `${path} @ ${width}`).toEqual([]);
        // Картинка слева видна и не сжата (компьютер и планшет — две колонки).
        if (width >= 1024) {
          const visual = (await page.locator(`[data-testid="${testId}"] .large-visual`).boundingBox())!;
          expect(visual.width, `${path} @ ${width}`).toBeGreaterThan(width * 0.25);
        }
      }
      for (const path of ['/explore', '/scientists']) {
        await page.goto(`${base}${path}`);
        await page.getByTestId(path === '/explore' ? 'atlas-explore' : 'atlas-scientists').waitFor();
        expect(await pageOverflow(page), `${path} @ ${width}`).toBeLessThanOrEqual(0);
      }
    }
  });
});
