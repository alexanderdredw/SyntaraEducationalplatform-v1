#!/usr/bin/env node
// OPT-01/OPT-03 (docs/OPTIMIZATION_TZ.md): замер места на диске — генерируемые папки, кеши, node_modules, git.
// Только чтение. Запуск из корня: node scripts/opt/measure-disk.mjs [--json out.json]
// Символические ссылки и junction не обходятся (pnpm); жёсткие ссылки считаются один раз (по inode).
import { lstatSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const print = (s = '') => process.stdout.write(`${s}\n`);

const root = process.cwd();
const seen = new Set();

function walk(dir, acc = { bytes: 0, files: 0, shared: 0 }) {
  const top = lstatSync(dir);
  if (top.isFile()) {
    acc.bytes += top.size;
    acc.files += 1;
    return acc;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      walk(p, acc);
      continue;
    }
    let st;
    try {
      st = lstatSync(p, { bigint: true });
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    const key = `${st.dev}:${st.ino}`;
    if (st.nlink > 1n && st.ino !== 0n) {
      if (seen.has(key)) continue;
      seen.add(key);
      // Файл с несколькими жёсткими ссылками — обычно общий с хранилищем pnpm: удаление папки его не освобождает.
      acc.shared += Number(st.size);
    }
    acc.bytes += Number(st.size);
    acc.files += 1;
  }
  return acc;
}

// Ищет каталоги с заданными именами (не заходит в node_modules и .git).
function findDirs(dir, names, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (names.includes(e.name)) out.push(p);
    if (e.name === 'node_modules' || e.name === '.git' || names.includes(e.name)) continue;
    findDirs(p, names, out);
  }
  return out;
}

function findFiles(dir, re, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Логи внутри .turbo уже учтены размером самой папки.
      if (['node_modules', '.git', '.next', '.next-e2e', '.turbo', 'dist'].includes(e.name)) continue;
      findFiles(p, re, out);
    } else if (re.test(e.name)) out.push(p);
  }
  return out;
}

const mb = (b) => (b / 1024 / 1024).toFixed(1);
const rows = [];
const add = (group, path) => {
  if (!existsSync(path)) return;
  const r = walk(path);
  rows.push({
    group,
    path: relative(root, path).replaceAll('\\', '/') || '.',
    bytes: r.bytes,
    files: r.files,
    sharedBytes: r.shared,
  });
};

// 1. Генерируемые папки сборки и тестов
for (const p of findDirs(root, [
  '.next',
  '.next-e2e',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
])) {
  add('generated', p);
}
for (const p of findFiles(root, /(\.tsbuildinfo|\.log)$/)) add('generated-file', p);

// 2. node_modules (корень с .pnpm и локальные ссылки пакетов)
add('deps', join(root, 'node_modules'));
for (const p of findDirs(root, ['node_modules']).filter((d) => relative(root, d) !== 'node_modules'))
  add('deps', p);

// 3. git
add('git', join(root, '.git'));
let tracked = { bytes: 0, files: 0 };
let docsTracked = 0;
let mediaTracked = 0;
try {
  const list = execSync('git ls-files -z', { maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const f of list) {
    try {
      const s = lstatSync(join(root, f)).size;
      tracked.bytes += s;
      tracked.files += 1;
      if (f.startsWith('docs/')) docsTracked += s;
      if (f.startsWith('docs/media/')) mediaTracked += s;
    } catch {
      // Файл удалён из рабочего дерева, но ещё в индексе — пропускаем.
    }
  }
} catch {
  // Не git-репозиторий — строка «Файлы в git» будет нулевой.
}

const result = {
  measuredAt: new Date().toISOString(),
  rows,
  tracked: { ...tracked, docsBytes: docsTracked, mediaBytes: mediaTracked },
};

print('| Группа | Путь | Файлов | МБ | из них жёсткие ссылки, МБ |\n|---|---|---|---|---|');
for (const r of rows)
  print(`| ${r.group} | \`${r.path}\` | ${r.files} | ${mb(r.bytes)} | ${mb(r.sharedBytes)} |`);
print(
  `\nФайлы в git (рабочее дерево): ${tracked.files} файлов, ${mb(tracked.bytes)} МБ; docs ${mb(docsTracked)} МБ; docs/media ${mb(mediaTracked)} МБ`,
);

const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > 0 && process.argv[jsonIdx + 1])
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(result, null, 2));
