// OPT-05 (О4-8, docs/OPTIMIZATION_TZ.md, раздел 8): настоящий Lighthouse (mobile, симуляция Slow 4G и CPU ×4 —
// настройки Lighthouse по умолчанию) по тем же страницам и данным, что measure-web.mjs (measure-pages.mjs).
// Chrome — из Playwright; вошедший пользователь — cookie его сессии в этом Chrome (заголовок Cookie Chrome не
// подставляет), поэтому Lighthouse не сбрасывает хранилище: кеш HTTP он и так очищает перед каждым прогоном.
// Значение — медиана прогонов по оценке; страница, открывшаяся не по своему адресу (вход), — ошибка замера.
// Запуск из корня: node scripts/opt/lighthouse.mjs [baseURL=http://localhost:3000] [--runs 3] [--json out.json]
//   [--only "Главная,Каталог"]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparePages } from './measure-pages.mjs';

const require = createRequire(join(process.cwd(), 'e2e/package.json'));
const { chromium } = require('@playwright/test');
const lighthousePath = require.resolve('lighthouse');
const { default: lighthouse } = await import(pathToFileURL(lighthousePath).href);
const chromeLauncher = await import(
  pathToFileURL(createRequire(lighthousePath).resolve('chrome-launcher')).href
);

const args = process.argv.slice(2);
const base = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:3000';
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const RUNS = Number(opt('--runs', 3));
const only = opt('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const browser = await chromium.launch();
const pages = (await preparePages(browser, base)).filter(([, name]) => !only.length || only.includes(name));
const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--no-first-run'],
});

// Cookie пользователя страницы — в Chrome, который проверяет Lighthouse (через CDP).
const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
const session = cdp.contexts()[0];
async function useState(state) {
  await session.clearCookies();
  if (state.cookies.length) await session.addCookies(state.cookies);
  // Холодный кеш, как при обычном прогоне Lighthouse.
  const page = await session.newPage();
  await (await session.newCDPSession(page)).send('Network.clearBrowserCache');
  await page.close();
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const results = [];
try {
  for (const [role, name, target, state] of pages) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const path = typeof target === 'string' ? target : await target();
      await useState(state);
      const { lhr } = await lighthouse(`${base}${path}`, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        disableStorageReset: true,
      });
      const a = lhr.audits;
      runs.push({
        path,
        score: Math.round((lhr.categories.performance.score ?? 0) * 100),
        fcp: a['first-contentful-paint'].numericValue,
        lcp: a['largest-contentful-paint'].numericValue,
        tbt: a['total-blocking-time'].numericValue,
        cls: a['cumulative-layout-shift'].numericValue,
        si: a['speed-index'].numericValue,
        js:
          a['resource-summary']?.details?.items?.find((x) => x.resourceType === 'script')?.transferSize ?? 0,
        total: a['total-byte-weight'].numericValue,
        finalUrl: lhr.mainDocumentUrl ?? lhr.finalDisplayedUrl,
      });
    }
    const mid = median(runs.map((r) => r.score));
    const r = runs.find((x) => x.score === mid);
    const row = {
      role,
      name,
      path: r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
      runs: runs.length,
      scores: runs.map((x) => x.score),
      ...r,
      redirected: (() => {
        const u = new URL(r.finalUrl);
        return u.pathname + u.search !== r.path;
      })(),
    };
    delete row.finalUrl;
    results.push(row);
    log(
      `${role} | ${name} | Performance ${row.score} (${row.scores.join('/')}) | LCP ${(row.lcp / 1000).toFixed(2)} с | CLS ${row.cls.toFixed(3)} | TBT ${row.tbt.toFixed(0)} мс | JS ${(row.js / 1024).toFixed(0)} КБ${row.redirected ? ' | ПЕРЕНАПРАВЛЕНИЕ' : ''}`,
    );
  }
} finally {
  await cdp.close();
  await chrome.kill();
  await browser.close();
}

const out = opt('--json', '');
if (out)
  writeFileSync(
    out,
    JSON.stringify({ base, measuredAt: new Date().toISOString(), lighthouse: '13.5.0', results }, null, 2),
  );
