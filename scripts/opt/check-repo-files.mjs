#!/usr/bin/env node
// OPT-06 (О5, раздел 9.2 ТЗ): в git не попадают генерируемые папки и файлы и файлы больше 1 МБ — кроме эталонов
// (раздел 2 ТЗ: их не сжимают и не меняют). Только чтение. Запуск из корня: node scripts/opt/check-repo-files.mjs
// Выход 1 — список нарушений.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const MAX_BYTES = 1024 * 1024;

// Генерируемое: сборки Next.js (.next, .next-e2e, .next-opt…), зависимости, кеши, отчёты тестов (как в scripts/clean.mjs).
const GENERATED = [
  /(^|\/)\.next[^/]*\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.turbo\//,
  /(^|\/)(dist|build|coverage|test-results|playwright-report|blob-report|lighthouse-report|\.lighthouseci)\//,
  /\.tsbuildinfo$/,
  /(^|\/)next-env\.d\.ts$/,
  /\.log$/,
];

// Эталоны (OPTIMIZATION_TZ, раздел 2.1): размер не ограничен.
const ALLOWED_LARGE = [
  /^docs\/media\/image[^/]*\.(jpe?g)$/i,
  /^docs\/media\/student-auth[^/]*\.png$/i,
  /^docs\/media\/ux\/[^/]*-ref\.png$/i,
  /^docs\/media\/public\//,
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);

const problems = [];
for (const file of files) {
  if (GENERATED.some((re) => re.test(file))) {
    problems.push(`${file} — генерируемый файл (должен быть в .gitignore)`);
    continue;
  }
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue; // удалён в рабочем дереве, но ещё в индексе
  }
  if (size > MAX_BYTES && !ALLOWED_LARGE.some((re) => re.test(file)))
    problems.push(
      `${file} — ${(size / 1024 / 1024).toFixed(2)} МБ (больше 1 МБ; скриншоты — WebP ≤ 1600 px, CLAUDE.md)`,
    );
}

if (problems.length) {
  process.stdout.write(
    `Файлы, которых не должно быть в git (${problems.length}):\n${problems.map((p) => `  ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(`Файлы в git: ${files.length}, генерируемых нет, больше 1 МБ — только эталоны.\n`);
