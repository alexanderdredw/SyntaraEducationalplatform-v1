#!/usr/bin/env node
// OPT-05 (docs/OPTIMIZATION_TZ.md, раздел 8): p50/p95 времени ответа API по маршрутам из журнала pino
// (строки «request completed» с полем responseTime). Идентификаторы в путях заменяются на :id, параметры запроса отбрасываются.
// Только чтение. Запуск: node scripts/opt/api-latency.mjs <api.log> [--from <номер строки>] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';

const print = (s = '') => process.stdout.write(`${s}\n`);

const [file, ...rest] = process.argv.slice(2);
const fromIdx = rest.indexOf('--from');
const from = fromIdx >= 0 ? Number(rest[fromIdx + 1]) : 0;
const lines = readFileSync(file, 'utf8').split('\n').slice(from);

const byRoute = new Map();
for (const line of lines) {
  if (!line.startsWith('{')) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (typeof e.responseTime !== 'number' || !e.req?.url) continue;
  const path = e.req.url
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
  const key = `${e.req.method} ${path}`;
  if (!byRoute.has(key)) byRoute.set(key, []);
  byRoute.get(key).push(e.responseTime);
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const rows = [...byRoute].map(([route, xs]) => ({
  route,
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  max: Math.max(...xs),
}));
rows.sort((a, b) => b.p95 - a.p95);
const all = [...byRoute.values()].flat();
print(`Всего запросов: ${all.length}; p50 ${pct(all, 50)} мс, p95 ${pct(all, 95)} мс\n`);
print('| Маршрут | Запросов | p50, мс | p95, мс | макс, мс |\n|---|---|---|---|---|');
for (const r of rows) print(`| \`${r.route}\` | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} |`);
const ji = rest.indexOf('--json');
if (ji >= 0) writeFileSync(rest[ji + 1], JSON.stringify(rows, null, 2));
