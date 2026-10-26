// OPT-01 (docs/OPTIMIZATION_TZ.md, раздел 4): удаление генерируемых папок и кешей.
// `pnpm clean` — сборки Next (.next, .next-e2e, .next-*), кеши Turborepo, dist, *.tsbuildinfo, отчёты тестов.
// `pnpm clean:deep` — то же + все node_modules (затем `pnpm install`).
// Исходники, content/, docs/, .env, тома Docker не затрагиваются. Всё удалённое восстанавливается
// командами `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm e2e`.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const deep = process.argv.includes('--deep');
const DIRS = new Set(['.turbo', 'dist', 'coverage', 'test-results', 'playwright-report']);
const SKIP = new Set(['.git', 'content', 'docs', 'node_modules']);
const removed = [];

function remove(p) {
  rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  removed.push(relative(root, p).replaceAll('\\', '/'));
}

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (e.name === 'node_modules') {
        if (deep) remove(p);
        continue;
      }
      if (SKIP.has(e.name)) continue;
      if (DIRS.has(e.name) || e.name === '.next' || e.name.startsWith('.next-')) remove(p);
      else walk(p);
    } else if (e.name.endsWith('.tsbuildinfo')) remove(p);
  }
}

// Проверка, что запуск — из корня монорепозитория.
statSync(join(root, 'pnpm-workspace.yaml'));
walk(root);
process.stdout.write(
  removed.length
    ? `Удалено (${removed.length}):\n${removed.map((r) => `  ${r}`).join('\n')}\n`
    : 'Нечего удалять\n',
);
