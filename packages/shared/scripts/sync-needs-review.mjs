// Добавляет в i18n/needs_review.json все ключи kk.json, которых там ещё нет (статус needs_review),
// и удаляет ключи, которых больше нет в kk.json. Отметку "reviewed" ставит носитель языка вручную.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../i18n/', import.meta.url));
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : flatten(v, `${prefix}${k}.`),
  );

const kkKeys = flatten(JSON.parse(readFileSync(dir + 'kk.json', 'utf8')));
const file = dir + 'needs_review.json';
const current = JSON.parse(readFileSync(file, 'utf8'));
const keys = Object.fromEntries(kkKeys.map((k) => [k, current.keys?.[k] ?? 'needs_review']));
writeFileSync(file, JSON.stringify({ ...current, keys }, null, 2) + '\n');
console.warn(`needs_review.json: ${kkKeys.length} ключей kk`);
