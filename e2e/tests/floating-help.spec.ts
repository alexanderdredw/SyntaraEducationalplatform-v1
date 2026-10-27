import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import { acceptCookies, bundles, isPhone } from './support';

const ru = bundles.ru;
const uid = () => randomUUID().slice(0, 8);

/**
 * Прокрутка страницы сверху вниз шагами: на каждом шаге видимые плавающие кнопки не перекрывают поля, кнопки и текст
 * страницы. Возвращает нарушения («шаг: элемент») и число шагов, на которых кнопки были видны.
 */
async function scan(page: Page): Promise<{ violations: string[]; shown: number }> {
  return page.evaluate(async () => {
    const frames = () =>
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
    const frame = document.querySelector('[data-testid="floating-help"]')!;
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const controls = 'input:not([type="hidden"]), textarea, select, button, [role="tab"]';
    const text = 'label, p, h1, h2, h3, li, a';
    const violations: string[] = [];
    let shown = 0;
    const range = document.createRange();
    const max = document.documentElement.scrollHeight - innerHeight;
    for (let y = 0; ; y = Math.min(max, y + 80)) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await frames();
      if (frame.getAttribute('data-hidden') !== 'true') {
        shown++;
        const zone = frame.getBoundingClientRect();
        for (const el of Array.from(
          document.querySelectorAll(`#main :is(${controls}, ${text}), footer :is(${controls}, ${text})`),
        )) {
          if (el.closest('[aria-hidden="true"]')) continue;
          const box = el.getBoundingClientRect();
          if (box.width <= 1 || box.height <= 1 || !hit(box, zone)) continue;
          if (el.matches(controls)) {
            violations.push(`${y}: ${el.tagName} ${el.getAttribute('id') ?? el.textContent?.slice(0, 30)}`);
            continue;
          }
          range.selectNodeContents(el);
          if (Array.from(range.getClientRects()).some((r) => r.width > 1 && r.height > 1 && hit(r, zone))) {
            violations.push(`${y}: ${el.tagName} «${el.textContent?.trim().slice(0, 30)}»`);
          }
        }
      }
      if (y >= max) break;
    }
    return { violations, shown };
  });
}

/**
 * Конец содержимого (отступ под кнопками) у нижнего края окна — кнопки видны. Прокрутка повторяется вместе с проверкой:
 * пока догружаются картинки и данные, высота содержимого растёт и прежняя позиция уже не конец.
 */
async function expectShownAtContentEnd(page: Page) {
  await expect(async () => {
    await page.evaluate(() => {
      const main = document.getElementById('main')!;
      const end = main.getBoundingClientRect().bottom + scrollY;
      window.scrollTo({ top: end - innerHeight, behavior: 'instant' });
    });
    await expect(page.getByTestId('floating-help')).toHaveAttribute('data-hidden', 'false', {
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: ru.help.assistant })).toBeInViewport();
}

async function student(baseURL: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/register-student', {
    data: { displayName: 'Асель Нурова', login: `fh.${uid()}`, password: 'student-pass-1' },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ctx;
}

async function cardioTopic(api: APIRequestContext): Promise<string> {
  const catalog = await (await api.get('/api/public/catalog')).json();
  const biology = catalog.sections.find((s: { title: string }) => s.title === 'Биология');
  const section = await (await api.get(`/api/public/sections/${biology.id}`)).json();
  const anatomy = section.subjects.find((s: { title: string }) => s.title === 'Анатомия человека');
  const subject = await (await api.get(`/api/public/subjects/${anatomy.id}`)).json();
  return subject.topics.find((t: { title: string }) => t.title === 'Сердечно-сосудистая система').id;
}

test.describe('Плавающие кнопки на телефоне (REQ-GEN-SHELL-04)', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    test.skip(!isPhone(page), 'на телефоне (≤ 768 px)');
    await acceptCookies(context, baseURL);
  });

  test('REQ-GEN-SHELL-04 sign-in and sign-up forms (student, teacher) at 320/390 px: buttons never cover fields or text; hidden while typing', async ({
    page,
  }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      for (const [path, card, tab] of [
        ['/ru/auth/start?role=teacher', 'teacher-auth', null],
        ['/ru/auth/login?role=teacher', 'teacher-auth', null],
        ['/ru/auth/start?role=student', 'student-auth', null],
        ['/ru/auth/start?role=student', 'student-auth', ru.studentAuth.tabLogin],
      ] as const) {
        await page.goto(path);
        if (tab) await page.getByTestId(card).getByRole('tab', { name: tab }).click();
        const { violations, shown } = await scan(page);
        expect(violations, `${width} ${path} ${tab ?? ''}`).toEqual([]);
        expect(shown, `${width} ${path}: buttons are shown somewhere`).toBeGreaterThan(0);
        await expectShownAtContentEnd(page);

        // Поле в фокусе (открыта клавиатура) — кнопки убраны; фокус ушёл — вернулись.
        await page.getByTestId(card).getByRole('textbox').first().focus();
        await expect(page.getByTestId('floating-help')).toHaveAttribute('data-hidden', 'true');
        await expect(page.getByTestId('floating-help')).toHaveCSS('opacity', '0');
        await page.getByTestId(card).getByRole('textbox').first().blur();
        await expectShownAtContentEnd(page);
      }
    }
  });

  test('REQ-GEN-SHELL-04 lesson, quiz, Battle and profile at 320/390 px: buttons never cover fields or text', async ({
    page,
    context,
    baseURL,
  }) => {
    const s = await student(baseURL!);
    const { cookies } = await s.storageState();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseURL! })));
    const topic = await cardioTopic(s);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      for (const path of [
        `/ru/learn/topics/${topic}`,
        `/ru/learn/topics/${topic}?tab=quiz`,
        '/ru/learn/battles',
        '/ru/account/profile',
      ]) {
        await page.goto(path);
        await expect(page.locator('#main')).not.toBeEmpty();
        const { violations } = await scan(page);
        expect(violations, `${width} ${path}`).toEqual([]);
        await expectShownAtContentEnd(page);
      }
    }
    // Профиль: поле имени в фокусе — кнопки убраны.
    await page.getByRole('textbox').first().focus();
    await expect(page.getByTestId('floating-help')).toHaveAttribute('data-hidden', 'true');
  });

  test('REQ-GEN-SHELL-04 the «?» button still opens help on a phone; open help is not hidden', async ({
    page,
  }) => {
    await page.goto('/ru/schools');
    await expectShownAtContentEnd(page);
    await page.getByRole('button', { name: ru.help.open }).click();
    await expect(page.getByText(ru.help.pages.schools)).toBeVisible();
    await expect(page.getByTestId('floating-help')).toHaveAttribute('data-hidden', 'false');
  });
});
