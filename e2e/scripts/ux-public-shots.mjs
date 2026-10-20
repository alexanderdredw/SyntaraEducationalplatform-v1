/* global document -- код внутри page.evaluate выполняется в браузере */
// Скриншоты «после» части B (docs/UX_TZ.md, UX-01…UX-10): docs/media/ux/after/UX-NN-*.png.
// Запуск: node e2e/scripts/ux-public-shots.mjs [baseURL]. Нужны web, api и seed `demo`. Гость, тёмная тема, RU.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/media/ux/after');
mkdirSync(out, { recursive: true });
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const NO_MOTION = `*,*::before,*::after{transition:none!important;animation:none!important}nextjs-portal{display:none!important}`;

const browser = await chromium.launch();
async function shot(
  name,
  path,
  { width = 1440, height = 900, theme = 'dark', fullPage = false, testId, openMenu = false } = {},
) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  await context.addCookies([
    { name: 'consent', value: 'necessary', url: base },
    { name: 'theme', value: theme, url: base },
  ]);
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: NO_MOTION });
  await page.evaluate(() => document.fonts.ready);
  // UX-10: мобильное меню в открытом состоянии.
  if (openMenu) await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const target = testId ? page.getByTestId(testId) : page;
  // Снимок блока: закреплённый хедер не перекрывает верх секции.
  if (testId) await page.addStyleTag({ content: 'header{position:static!important}' });
  if (testId) await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await target.screenshot({ path: `${out}/${name}.png`, ...(testId ? {} : { fullPage }) });
  log('shot', name);
  await context.close();
}

await shot('UX-01-header', '/ru/about', { height: 120 });
await shot('UX-01-header-light', '/ru/about', { height: 120, theme: 'light' });
await shot('UX-01-header-390', '/ru/about', { width: 390, height: 120 });
await shot('UX-02-schools-hero', '/ru/schools', { height: 560 });
await shot('UX-03-home-subjects', '/ru', { testId: 'home-subjects' });
await shot('UX-03-home-subjects-390', '/ru', { width: 390, testId: 'home-subjects' });
await shot('UX-04-auth', '/ru/auth/start', { width: 600, height: 960 });
await shot('UX-04-auth-light', '/ru/auth/start', { width: 600, height: 960, theme: 'light' });
await shot('UX-04-auth-320', '/ru/auth/start', { width: 320, height: 900 });
await shot('UX-05-about-hero', '/ru/about', { testId: 'about-hero' });
await shot('UX-05-about-hero-390', '/ru/about', { width: 390, testId: 'about-hero' });
await shot('UX-06-about-mission', '/ru/about', { testId: 'about-mission' });
await shot('UX-06-about-problem', '/ru/about', { testId: 'about-problem' });
await shot('UX-07-about-audience', '/ru/about', { testId: 'about-audience' });
await shot('UX-07-about-why', '/ru/about', { testId: 'about-why' });
await shot('UX-07-about-how-inside', '/ru/about', { testId: 'about-inside' });
await shot('UX-08-about-origins', '/ru/about', { testId: 'about-origins' });
await shot('UX-08-about-team', '/ru/about', { testId: 'about-team' });
await shot('UX-09-schools-full', '/ru/schools', { fullPage: true });
await shot('UX-09-schools-full-390', '/ru/schools', { width: 390, fullPage: true });
await shot('UX-09-schools-full-light', '/ru/schools', { fullPage: true, theme: 'light' });
await shot('UX-10-closed-390', '/ru/support', { width: 390, height: 844 });
await shot('UX-10-open-390', '/ru/support', { width: 390, height: 844, openMenu: true });
await shot('UX-10-open-320', '/ru/support', { width: 320, height: 640, openMenu: true });
await shot('UX-10-open-light-390', '/ru/support', { width: 390, height: 844, theme: 'light', openMenu: true });

await browser.close();
