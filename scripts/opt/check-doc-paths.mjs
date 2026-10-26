#!/usr/bin/env node
// AC-OPT-02 (docs/OPTIMIZATION_TZ.md): все пути к картинкам и папкам docs/media, упомянутые в docs/*.md и CLAUDE.md, существуют.
// Учитываются полные пути к файлам и папкам (`docs/media/...`) и ссылки Markdown относительно документа (`](media/...)`).
// Шаблоны с заполнителями `<ID>`, `*`, `NN` проверяются на наличие хотя бы одного подходящего файла.
// Код выхода 1 — если чего-то нет. Запуск из корня: node scripts/opt/check-doc-paths.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

const root = process.cwd();
const docs = [
  'CLAUDE.md',
  ...readdirSync(join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];
// CONTENT_GUIDE описывает формат content/<тема>/ — его ссылки `](media/…)` относятся к папке темы, а не к docs/media.
const RELATIVE_EXAMPLES = new Set(['docs/CONTENT_GUIDE.md']);
const PLACEHOLDER = /(<[^>]+>|\*|NN)/;
const missing = [];
let checked = 0;

function templateMatches(path) {
  const dir = posix.dirname(path);
  if (!existsSync(join(root, dir))) return false;
  const source = posix
    .basename(path)
    .split(PLACEHOLDER)
    .map((p) =>
      PLACEHOLDER.test(p) && p.match(PLACEHOLDER)[0] === p
        ? '[^/]+'
        : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  const re = new RegExp(`^${source}$`);
  return readdirSync(join(root, dir)).some((f) => re.test(f));
}

for (const doc of docs) {
  const text = readFileSync(join(root, doc), 'utf8');
  const found = new Set();
  for (const m of text.matchAll(/docs\/media\/[\w.<>*/-]*[\w>*/]/g)) found.add(m[0]);
  if (!RELATIVE_EXAMPLES.has(doc)) {
    for (const m of text.matchAll(/\]\((?!https?:)([^)\s]+)\)/g)) {
      const p = posix.normalize(posix.join(posix.dirname(doc), m[1]));
      if (p.startsWith('docs/media/')) found.add(p);
    }
  }
  for (const p of found) {
    const clean = p.replace(/\/$/, '');
    checked++;
    const ok = PLACEHOLDER.test(clean) ? templateMatches(clean) : existsSync(join(root, clean));
    if (!ok) missing.push(`${doc}: ${p}`);
  }
}

process.stdout.write(`Проверено путей: ${checked}; отсутствуют: ${missing.length}\n`);
for (const m of missing) process.stdout.write(`  ${m}\n`);
process.exit(missing.length ? 1 : 0);
