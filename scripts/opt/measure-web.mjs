/* global window -- код внутри addInitScript/evaluate выполняется в браузере */
// OPT-05 (docs/OPTIMIZATION_TZ.md, раздел 8): замер страниц production-сборки на «телефоне» с медленной сетью.
// Chromium из Playwright + CDP: экран 412×823 (как Lighthouse mobile), замедление CPU ×4, сеть Slow 4G и Fast 3G,
// холодный кеш. Метрики: FCP, LCP, CLS, TBT (сумма «длинных задач» сверх 50 мс до 5 с после load), переданные байты
// по типам (JS, CSS, шрифты, картинки), число и время запросов /api из браузера.
// «Оценка» — формула Lighthouse 10 по FCP/LCP/TBT/CLS без Speed Index (как на O1); настоящий Lighthouse — lighthouse.mjs.
// Страницы и данные — measure-pages.mjs (создаются через API; нужен api с RATE_LIMITS_DISABLED).
// Запуск из корня: node scripts/opt/measure-web.mjs [baseURL=http://localhost:3000] [--runs 3] [--json out.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePages } from './measure-pages.mjs';

const require = createRequire(join(process.cwd(), 'e2e/package.json'));
const { chromium, devices } = require('@playwright/test');

const args = process.argv.slice(2);
const base = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:3000';
const runsIdx = args.indexOf('--runs');
const RUNS = runsIdx >= 0 ? Number(args[runsIdx + 1]) : 3;
const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);

// Скорость в байтах/с; задержка — RTT в мс (Network.emulateNetworkConditions).
const NETWORKS = {
  'Slow 4G': {
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  'Fast 3G': {
    latency: 562.5,
    downloadThroughput: (1.44 * 1024 * 1024) / 8,
    uploadThroughput: (675 * 1024) / 8,
  },
};
const PHONE = { ...devices['Moto G4'], viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75 };

const browser = await chromium.launch();

const PAGES = await preparePages(browser, base);

// ---- Замер одной страницы ----
const OBSERVERS = () => {
  window.__m = { lcp: 0, cls: 0, longTasks: [], fcp: 0 };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__m.lcp = e.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value;
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__m.longTasks.push([e.startTime, e.duration]);
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
};

async function measure(path, state, net) {
  const ctx = await browser.newContext({
    ...PHONE,
    baseURL: base,
    storageState: state,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await page.addInitScript(OBSERVERS);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[net] });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const reqs = new Map();
  const bytes = { Script: 0, Stylesheet: 0, Font: 0, Image: 0, Document: 0, Fetch: 0, Other: 0 };
  cdp.on('Network.requestWillBeSent', (e) =>
    reqs.set(e.requestId, { url: e.request.url, type: e.type, t0: e.timestamp }),
  );
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.type = e.type;
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.bytes = e.encodedDataLength;
    r.ms = (e.timestamp - r.t0) * 1000;
    const k = r.type === 'XHR' ? 'Fetch' : r.type in bytes ? r.type : 'Other';
    bytes[k] += e.encodedDataLength;
  });
  const t0 = Date.now();
  await page.goto(path, { waitUntil: 'load', timeout: 180_000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(5000);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      ...window.__m,
      ttfb: nav?.responseStart ?? 0,
      domLoaded: nav?.domContentLoadedEventEnd ?? 0,
      status: nav?.responseStatus,
    };
  });
  const tbt = m.longTasks.filter(([s]) => s >= m.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
  const api = [...reqs.values()].filter((r) => r.url.includes('/api/') && r.ms !== undefined);
  const finalUrl = page.url();
  await ctx.close();
  return {
    fcp: m.fcp,
    lcp: m.lcp,
    cls: m.cls,
    tbt,
    ttfb: m.ttfb,
    loadMs,
    bytes,
    apiCount: api.length,
    apiMs: api.map((r) => r.ms),
    finalUrl,
    redirected: finalUrl.replace(base, '') !== path,
  };
}

// Lighthouse 10: лог-нормальные кривые (mobile). Speed Index не измеряется — его вес 10 % распределён пропорционально.
function lhScore({ fcp, lcp, tbt, cls }) {
  const erfc = (x) => {
    const t = 1 / (1 + 0.5 * Math.abs(x));
    const y =
      t *
      Math.exp(
        -x * x -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t *
                            (0.27886807 +
                              t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
      );
    return x >= 0 ? y : 2 - y;
  };
  // Как в lighthouse/core/lib/statistics.js: shape по p10 и медиане, score = erfc(x) / 2.
  const logn = (v, p10, median) => {
    if (v <= 0) return 1;
    const shape = Math.abs(Math.log(median / p10)) / (Math.SQRT2 * 0.9061938024368232);
    return Math.min(1, Math.max(0, 0.5 * erfc(Math.log(v / median) / (Math.SQRT2 * shape))));
  };
  const parts = [
    [0.1, logn(fcp, 1800, 3000)],
    [0.25, logn(lcp, 2500, 4000)],
    [0.3, logn(tbt, 200, 600)],
    [0.25, logn(cls, 0.1, 0.25)],
  ];
  const w = parts.reduce((a, [x]) => a + x, 0);
  return Math.round((parts.reduce((a, [x, s]) => a + x * s, 0) / w) * 100);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const results = [];
for (const [role, name, target, state] of PAGES) {
  let path = typeof target === 'string' ? target : '';
  for (const net of Object.keys(NETWORKS)) {
    const runs = [];
    for (let i = 0; i < (net === 'Slow 4G' ? RUNS : 1); i++) {
      if (typeof target === 'function') path = await target();
      runs.push(await measure(path, state, net));
    }
    const pick = (k) => median(runs.map((r) => r[k]));
    const r = {
      role,
      name,
      path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
      net,
      runs: runs.length,
      fcp: pick('fcp'),
      lcp: pick('lcp'),
      cls: pick('cls'),
      tbt: pick('tbt'),
      ttfb: pick('ttfb'),
      loadMs: pick('loadMs'),
      js: median(runs.map((x) => x.bytes.Script)),
      css: median(runs.map((x) => x.bytes.Stylesheet)),
      font: median(runs.map((x) => x.bytes.Font)),
      img: median(runs.map((x) => x.bytes.Image)),
      doc: median(runs.map((x) => x.bytes.Document)),
      apiCount: median(runs.map((x) => x.apiCount)),
      apiMs: runs.flatMap((x) => x.apiMs),
      redirected: runs.some((x) => x.redirected),
    };
    r.score = lhScore(r);
    results.push(r);
    log(
      `${role} | ${name} | ${net} | JS ${(r.js / 1024).toFixed(0)} КБ | LCP ${(r.lcp / 1000).toFixed(2)} с | CLS ${r.cls.toFixed(3)} | TBT ${r.tbt.toFixed(0)} мс | оценка ${r.score}${r.redirected ? ' | ПЕРЕНАПРАВЛЕНИЕ ' + runs[0].finalUrl : ''}`,
    );
  }
}

await browser.close();
const ji = args.indexOf('--json');
if (ji >= 0)
  writeFileSync(
    args[ji + 1],
    JSON.stringify({ base, measuredAt: new Date().toISOString(), networks: NETWORKS, results }, null, 2),
  );
