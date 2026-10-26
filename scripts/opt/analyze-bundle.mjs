#!/usr/bin/env node
// OPT-05 (docs/OPTIMIZATION_TZ.md, раздел 8): JS первой загрузки по страницам production-сборки и состав чанков.
// Только чтение. Запуск из корня после сборки: node scripts/opt/analyze-bundle.mjs [distDir=apps/web/.next] [--json out.json]
//   [--budget КБ] — проверка бюджета для CI (выход 1 при превышении).
// Размеры — gzip (как «First Load JS» в выводе next build) и brotli. Библиотеки в чанке определяются по характерным
// строкам, которые переживают минификацию, — это оценка; точная карта модулей — @next/bundle-analyzer (решение O4).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const print = (s = '') => process.stdout.write(`${s}\n`);

const dist = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'apps/web/.next';
const manifest = JSON.parse(readFileSync(join(dist, 'app-build-manifest.json'), 'utf8')).pages;

const MARKERS = {
  'react-dom': /react-dom|__reactFiber|\$\$typeof/,
  'next (клиент)': /__NEXT_DATA__|next-router|__next_f/,
  sentry: /__SENTRY__|sentry\.javascript|SentryError/,
  'lucide-react': /lucide-[a-z0-9-]+/g,
  'radix-ui': /data-radix|radix-/,
  zod: /ZodError|invalid_type/,
  '@tanstack/react-query': /No QueryClient set/,
  'react-hook-form': /shouldUnregister|setValueAs/,
  'react-markdown / unified': /micromark|Cannot `process` without|mdast|hast/,
  'next-intl / intl-messageformat': /MALFORMED_ARGUMENT|INVALID_MESSAGE|IntlError/,
  'floating-ui': /floating-ui|getComputedStyle\(.*\)\.position/,
  'openapi-fetch': /querySerializer|bodySerializer/,
};

const cache = new Map();
function info(file) {
  if (cache.has(file)) return cache.get(file);
  const buf = readFileSync(join(dist, file));
  const text = buf.toString('utf8');
  const libs = [];
  for (const [name, re] of Object.entries(MARKERS)) {
    if (re.global) {
      const n = new Set(text.match(re) ?? []).size;
      if (n) libs.push(`${name} (${n} икон.)`);
    } else if (re.test(text)) libs.push(name);
  }
  const r = {
    file,
    raw: buf.length,
    gz: gzipSync(buf, { level: 9 }).length,
    br: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    libs,
  };
  cache.set(file, r);
  return r;
}

// Страница = layout-цепочка + page; Next объединяет чанки из всех сегментов маршрута.
const pages = Object.keys(manifest).filter((k) => k.endsWith('/page'));
const rows = pages.map((p) => {
  const segs = p.split('/').slice(0, -1);
  const files = new Set();
  for (let i = 1; i <= segs.length; i++) {
    const layout = segs.slice(0, i).join('/') + '/layout';
    for (const f of manifest[layout] ?? []) files.add(f);
  }
  for (const f of manifest[p]) files.add(f);
  const js = [...files].filter((f) => f.endsWith('.js'));
  const sum = (k) => js.reduce((a, f) => a + info(f)[k], 0);
  return {
    page: p.replace(/\/page$/, '').replace(/\/\([^)]+\)/g, '') || '/',
    chunks: js.length,
    raw: sum('raw'),
    gz: sum('gz'),
    br: sum('br'),
  };
});
rows.sort((a, b) => b.gz - a.gz);

const kb = (b) => (b / 1024).toFixed(0);
print('| Страница | Чанков | JS, КБ (без сжатия) | gzip, КБ | brotli, КБ |\n|---|---|---|---|---|');
for (const r of rows) print(`| \`${r.page}\` | ${r.chunks} | ${kb(r.raw)} | ${kb(r.gz)} | ${kb(r.br)} |`);

// Крупнейшие чанки и в скольких страницах они грузятся.
const usage = new Map();
for (const p of pages) {
  const segs = p.split('/').slice(0, -1);
  const files = new Set(manifest[p]);
  for (let i = 1; i <= segs.length; i++)
    for (const f of manifest[segs.slice(0, i).join('/') + '/layout'] ?? []) files.add(f);
  for (const f of files) if (f.endsWith('.js')) usage.set(f, (usage.get(f) ?? 0) + 1);
}
const chunks = [...usage.keys()]
  .map((f) => ({ ...info(f), pages: usage.get(f) }))
  .sort((a, b) => b.gz - a.gz);
print(`\n| Чанк | gzip, КБ | Страниц | Признаки библиотек |\n|---|---|---|---|`);
for (const c of chunks.slice(0, 25))
  print(
    `| \`${c.file.replace('static/chunks/', '')}\` | ${kb(c.gz)} | ${c.pages}/${pages.length} | ${c.libs.join(', ')} |`,
  );

const css = readdirSync(join(dist, 'static/css')).map((f) => info(`static/css/${f}`));
print(`\nCSS: ${css.map((c) => `${c.file} — ${kb(c.raw)} КБ, gzip ${kb(c.gz)} КБ`).join('; ')}`);

const ji = process.argv.indexOf('--json');
if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify({ rows, chunks, css }, null, 2));

// OPT-06 (О5, раздел 9 ТЗ): `--budget 500` — сборка не проходит, если JS первой загрузки (gzip) любой страницы больше
// бюджета в КБ (REQ-NFR-PERF-01). Тот же расчёт, что в таблице выше.
const bi = process.argv.indexOf('--budget');
if (bi > 0) {
  const budget = Number(process.argv[bi + 1]) * 1024;
  const over = rows.filter((r) => r.gz > budget);
  if (over.length) {
    print(`\nБюджет JS первой загрузки ${kb(budget)} КБ превышен:`);
    for (const r of over) print(`  ${r.page} — ${kb(r.gz)} КБ`);
    process.exit(1);
  }
  print(
    `\nБюджет JS первой загрузки ${kb(budget)} КБ: все ${rows.length} страниц в пределах (максимум ${kb(rows[0].gz)} КБ).`,
  );
}
