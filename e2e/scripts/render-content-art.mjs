// Отрисовка собственных схем (scripts/content-art/*.svg) в PNG для content/ (BR-CNT-06: WEBP/PNG/JPG ≤ 300 КБ).
// Запуск из корня: node e2e/scripts/render-content-art.mjs — затем pnpm content:check.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const anatomy = 'content/biology/01-human-anatomy';
const ART = {
  'circulation.svg': `${anatomy}/01-cardiovascular-system/media/circulation.png`,
  'heart.svg': `${anatomy}/01-cardiovascular-system/media/heart.png`,
  'vessels.svg': `${anatomy}/01-cardiovascular-system/media/vessels.png`,
  'lungs.svg': `${anatomy}/02-respiratory-system/media/lungs.png`,
  'alveoli.svg': `${anatomy}/02-respiratory-system/media/alveoli.png`,
  'digestive.svg': `${anatomy}/03-digestive-system/media/digestive.png`,
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [svg, out] of Object.entries(ART)) {
  const source = readFileSync(join(root, 'scripts/content-art', svg), 'utf8');
  await page.setContent(`<html><body style="margin:0;background:transparent">${source}</body></html>`);
  const png = await page.locator('svg').screenshot({ omitBackground: true });
  const target = join(root, out);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png);
  console.log(`${out} — ${Math.ceil(statSync(target).size / 1024)} КБ`);
}
await browser.close();
