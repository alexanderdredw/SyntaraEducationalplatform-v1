import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { acceptCookies } from './support';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Зазор между нижним краем футера и окна, прокрученного до конца страницы (0 — футер внизу). */
async function gapUnderFooter(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return (
      window.innerHeight -
      document.querySelector('[data-testid="site-footer"]')!.getBoundingClientRect().bottom
    );
  });
}

test.describe('Футер внизу страницы (REQ-GEN-SHELL-05)', () => {
  // Размеры окна задаются в тесте — достаточно одного проекта.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'размеры окна задаются в тесте');
  test.beforeEach(async ({ context, baseURL }) => acceptCookies(context, baseURL));

  test('REQ-GEN-SHELL-05 empty «Мои задания»: the bottom of the footer is the bottom of the window (1440×900, 390×844)', async ({
    page,
  }) => {
    const id = randomUUID().slice(0, 8);
    expect(
      (
        await page.request.post('/api/auth/register-student', {
          data: { displayName: 'Асель', login: `foot.${id}`, password: 'student-pass-1' },
        })
      ).status(),
    ).toBe(201);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/ru/learn/assignments');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // Доли пикселя: высота страницы может быть дробной, прокрутка — целая.
      expect(
        Math.abs(await gapUnderFooter(page)),
        `${viewport.width}×${viewport.height}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('REQ-GEN-SHELL-05 teacher with «Подтвердите email», collapsed panel and guest pages: no empty area under the footer', async ({
    page,
    browser,
    baseURL,
  }) => {
    const id = randomUUID().slice(0, 8);
    expect(
      (
        await page.request.post('/api/auth/register', {
          data: {
            role: 'teacher',
            email: `foot.${id}@example.kz`,
            displayName: 'Учитель',
            password: 'teacher-pass-1',
          },
        })
      ).status(),
    ).toBe(201);
    await page.context().addInitScript(() => localStorage.setItem('syntara.sidebar', 'collapsed'));
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/ru/teacher/assignments');
      await expect(page.getByTestId('verify-email-banner')).toBeVisible();
      expect(Math.abs(await gapUnderFooter(page)), `teacher ${viewport.width}`).toBeLessThanOrEqual(1);
    }

    const guest = await browser.newContext();
    await acceptCookies(guest, baseURL);
    const g = await guest.newPage();
    for (const viewport of VIEWPORTS) {
      await g.setViewportSize(viewport);
      for (const path of ['/ru/join', '/ru/auth/start', '/ru']) {
        await g.goto(path);
        expect(Math.abs(await gapUnderFooter(g)), `${path} ${viewport.width}`).toBeLessThanOrEqual(1);
      }
      // Длинная страница: футер после содержимого, не закреплён поверх него.
      await g.goto('/ru');
      const footer = g.getByTestId('site-footer');
      await expect(footer).toHaveCSS('position', 'static');
      expect((await footer.boundingBox())!.y).toBeGreaterThan(viewport.height);
    }
    await guest.close();
  });
});
