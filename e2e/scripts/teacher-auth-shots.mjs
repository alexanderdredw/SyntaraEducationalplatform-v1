// Снимки экрана учителя «Вход или регистрация» (регистрация и вход; 390 и 1440 px; тёмная и светлая темы) →
// docs/media/auth/*.webp (WebP q85, ширина ≤ 1600 px, CLAUDE.md). Нужны запущенные web и api.
// Запуск из папки e2e: node scripts/teacher-auth-shots.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const out = `${root}docs/media/auth/`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 844 : 900 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    await context.addCookies([{ name: 'consent', value: 'necessary', url: base }]);
    const page = await context.newPage();
    for (const [name, path] of [
      ['register', '/ru/auth/start?role=teacher'],
      ['login', '/ru/auth/login?role=teacher'],
    ]) {
      await page.goto(`${base}${path}`);
      await page.getByTestId('teacher-auth').waitFor();
      await page.evaluate(() => globalThis.document.fonts.ready);
      const png = await page.screenshot({ fullPage: true });
      const file = `${out}teacher-${name}-${width}-${theme}.webp`;
      await sharp(png)
        .resize({ width: Math.min(width, 1600), withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(file);
      console.warn(file);
    }
    await context.close();
  }
}
await browser.close();
