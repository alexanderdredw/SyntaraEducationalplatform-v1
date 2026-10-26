#!/usr/bin/env node
// OPT-02 (docs/OPTIMIZATION_TZ.md): где используется каждая зависимость каждого package.json.
// Только чтение. Ищет импорты/require/упоминания имени пакета в исходниках, тестах, конфигах и scripts.
// Результат — кандидаты «не найдено»; их нужно перепроверить вручную (CLI, плагины, типы, peer-зависимости).
// Запуск из корня: node scripts/opt/deps-usage.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const print = (s = '') => process.stdout.write(`${s}\n`);

const root = process.cwd();
const pkgDirs = [
  '.',
  'apps/api',
  'apps/web',
  'apps/worker',
  'packages/db',
  'packages/shared',
  'packages/ui',
  'e2e',
];
const SKIP = new Set([
  'node_modules',
  'dist',
  '.next',
  '.next-e2e',
  '.turbo',
  'coverage',
  'test-results',
  'playwright-report',
  '.git',
  'pnpm-lock.yaml',
]);
const EXT = /\.(c|m)?(t|j)sx?$|\.json$|\.css$|\.ya?ml$/;

function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    // Любые сборки Next (.next, .next-e2e, .next-opt …) — не исходники.
    if (SKIP.has(e.name) || e.name.startsWith('.next')) continue;
    // Учебный контент и документы в корне — не код.
    if (dir === root && ['docs', 'content'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Корень: только собственные файлы, вложенные пакеты проверяются отдельно.
      if (dir === root && ['apps', 'packages', 'e2e'].includes(e.name)) continue;
      files(p, out);
    } else if (EXT.test(e.name) && e.name !== 'package.json' && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const results = [];
for (const d of pkgDirs) {
  const pj = JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8'));
  const srcFiles = files(join(root, d)).map((f) => ({ f, text: readFileSync(f, 'utf8') }));
  const scripts = Object.values(pj.scripts ?? {}).join(' \n ');
  for (const kind of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pj[kind] ?? {})) {
      const typesOf = name.startsWith('@types/') ? name.slice(7).replace(/^(.+)__(.+)$/, '@$1/$2') : null;
      const target = typesOf ?? name;
      const re = new RegExp(
        `(from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)['"\`]${esc(target)}(/[^'"\`]*)?['"\`]|['"\`]${esc(target)}['"\`]`,
      );
      const hits = srcFiles
        .filter(({ text }) => re.test(text))
        .map(({ f }) => relative(root, f).replaceAll('\\', '/'));
      const binHit = new RegExp(`(^|[\\s/])${esc(name.split('/').pop())}(\\s|$)`).test(scripts);
      results.push({ pkg: d, kind, name, files: hits.length, sample: hits.slice(0, 3), inScripts: binHit });
    }
  }
}

print('| Пакет | Тип | Зависимость | Файлов с импортом | В scripts | Примеры |\n|---|---|---|---|---|---|');
for (const r of results) {
  const flag = r.files === 0 && !r.inScripts ? ' ⚠' : '';
  print(
    `| ${r.pkg} | ${r.kind === 'dependencies' ? 'dep' : 'dev'} | \`${r.name}\`${flag} | ${r.files} | ${r.inScripts ? 'да' : ''} | ${r.sample.join(', ')} |`,
  );
}
