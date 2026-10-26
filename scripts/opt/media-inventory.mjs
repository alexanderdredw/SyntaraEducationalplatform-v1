#!/usr/bin/env node
// OPT-03 (docs/OPTIMIZATION_TZ.md, разделы 2 и 6): инвентаризация docs/media — размер, формат, разрешение,
// ссылки из документов и классификация: эталон / есть ссылка / актуальный результат / кандидат на удаление.
// Только чтение. Запуск из корня: node scripts/opt/media-inventory.mjs [--json out.json] [--md out.md]
import { readFileSync, statSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { join, basename, posix } from 'node:path';
import { execSync } from 'node:child_process';

const print = (s = '') => process.stdout.write(`${s}\n`);

const root = process.cwd();
const tracked = execSync('git ls-files -z', { maxBuffer: 1 << 28 })
  .toString()
  .split('\0')
  .filter(Boolean);
const media = tracked.filter((f) => f.startsWith('docs/media/') && /\.(png|jpe?g|webp|gif)$/i.test(f));

// Эталоны — раздел 2.1 ТЗ.
const REFERENCE = [
  /^docs\/media\/image\d+\.(jpg|jpeg)$/i,
  /^docs\/media\/student-auth[^/]*\.png$/i,
  /^docs\/media\/ux\/[^/]*-ref\.png$/i,
  /^docs\/media\/public\//,
];

// Документы, ссылки из которых защищают файл (раздел 2.1): SPEC, PLAN, *_TZ*, UX_AUDIT, CLAUDE.md.
// Осторожно берём все docs/*.md и корневые *.md — лишняя защита безопаснее.
// Сам отчёт оптимизации не считается: его приложение перечисляет все файлы.
const SELF = 'docs/OPTIMIZATION_REPORT.md';
const protectedDocs = tracked.filter(
  (f) => f !== SELF && (/^docs\/[^/]+\.md$/.test(f) || /^[^/]+\.md$/.test(f)),
);
// Прочие тексты в git (отчёты в docs/media, код, тесты, скрипты) — ссылка делает файл «актуальным результатом».
const otherTexts = tracked.filter(
  (f) =>
    f !== SELF &&
    !protectedDocs.includes(f) &&
    /\.(md|ts|tsx|mjs|js|json|ya?ml)$/.test(f) &&
    !f.endsWith('pnpm-lock.yaml'),
);
const read = (f) => {
  try {
    return readFileSync(join(root, f), 'utf8');
  } catch {
    return '';
  }
};
const docText = new Map(protectedDocs.map((f) => [f, read(f)]));
const otherText = new Map(otherTexts.map((f) => [f, read(f)]));

function dims(file) {
  const fd = openSync(join(root, file), 'r');
  const buf = Buffer.alloc(256 * 1024);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < n - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m))
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return { w: 0, h: 0 };
}

// Ищет упоминание файла в тексте документа: полный путь, путь относительно документа, имя файла.
function refKind(file, docPath, text) {
  if (text.includes(file)) return 'path';
  const rel = posix.relative(posix.dirname(docPath), file);
  if (text.includes(rel)) return 'path';
  if (text.includes(basename(file))) return 'name';
  if (templates(docPath, text).some((re) => re.test(file))) return 'template';
  return null;
}

// Шаблоны путей в `…`: «docs/media/ux-audit/<ID>-compare.png», «before/overview-student-*».
const tplCache = new Map();
function templates(docPath, text) {
  if (tplCache.has(docPath)) return tplCache.get(docPath);
  const res = [];
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const t = m[1];
    if (!/[<*]/.test(t) || !/\.(png|jpe?g|webp)$|\*$/.test(t)) continue;
    const full = t.startsWith('docs/') ? t : posix.join(posix.dirname(docPath), t);
    if (!full.startsWith('docs/media/')) continue;
    const src = full
      .split(/(<[^>]+>|\*)/)
      .map((p) => (p === '*' || /^<.+>$/.test(p) ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('');
    res.push(new RegExp('^' + src + '$'));
  }
  tplCache.set(docPath, res);
  return res;
}
// Упоминание каталога файла (например «docs/media/profile/v2/»).
function dirRef(file, text) {
  let d = posix.dirname(file);
  while (d.startsWith('docs/media/')) {
    // Точное упоминание каталога: после него не идёт продолжение пути (иначе «profile/» совпало бы с «profile/v2/»).
    const re = new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?(?![\\w.-]|/[\\w.-])');
    if (re.test(text)) return d;
    d = posix.dirname(d);
  }
  return null;
}

const rows = [];
for (const f of media) {
  const size = statSync(join(root, f)).size;
  const { w, h } = dims(f);
  const refs = [];
  for (const [doc, text] of docText) {
    const k = refKind(f, doc, text);
    if (k) refs.push({ doc, kind: k });
  }
  const otherRefs = [];
  for (const [doc, text] of otherText) {
    const k = refKind(f, doc, text);
    if (k) otherRefs.push({ doc, kind: k });
  }
  const dirRefs = [...docText].map(([doc, t]) => (dirRef(f, t) ? doc : null)).filter(Boolean);
  let cls;
  if (REFERENCE.some((re) => re.test(f))) cls = 'эталон';
  else if (refs.length) cls = 'ссылка';
  else if (otherRefs.some((r) => r.doc.endsWith('.md')) || dirRefs.length) cls = 'актуальный';
  else cls = 'кандидат';
  rows.push({
    file: f,
    folder: posix.dirname(f),
    size,
    w,
    h,
    fmt: f.split('.').pop().toLowerCase(),
    cls,
    refs,
    otherRefs,
    dirRefs,
  });
}

// Поиск отсутствующих путей: каждый путь docs/media/... из документов должен существовать (AC-OPT-02).
const missing = [];
for (const [doc, text] of docText) {
  for (const m of text.matchAll(/docs\/media\/[\w./-]+\.(png|jpe?g|webp|gif)/gi)) {
    if (!tracked.includes(m[0])) missing.push({ doc, path: m[0] });
  }
}

const mb = (b) => (b / 1048576).toFixed(2);
const out = [];
out.push(
  '### По папкам\n\n| Папка | Файлов | МБ | Форматы | Ширина px (мин–макс) | эталон | ссылка | актуальный | кандидат | МБ кандидатов |\n|---|---|---|---|---|---|---|---|---|---|',
);
const folders = [...new Set(rows.map((r) => r.folder))].sort();
for (const d of folders) {
  const rs = rows.filter((r) => r.folder === d);
  const c = (k) => rs.filter((r) => r.cls === k).length;
  const fm = [...new Set(rs.map((r) => r.fmt))].join(', ');
  const ws = rs.map((r) => r.w).filter(Boolean);
  out.push(
    `| \`${d}\` | ${rs.length} | ${mb(rs.reduce((a, r) => a + r.size, 0))} | ${fm} | ${Math.min(...ws)}–${Math.max(...ws)} | ${c('эталон')} | ${c('ссылка')} | ${c('актуальный')} | ${c('кандидат')} | ${mb(rs.filter((r) => r.cls === 'кандидат').reduce((a, r) => a + r.size, 0))} |`,
  );
}
const tot = (k) => rows.filter((r) => !k || r.cls === k);
out.push(
  `| **Всего** | ${rows.length} | ${mb(tot().reduce((a, r) => a + r.size, 0))} | | | ${tot('эталон').length} | ${tot('ссылка').length} | ${tot('актуальный').length} | ${tot('кандидат').length} | ${mb(tot('кандидат').reduce((a, r) => a + r.size, 0))} |`,
);
const wide = rows.filter((r) => r.w > 1600);
out.push(`\nШире 1600 px: ${wide.length} файлов, ${mb(wide.reduce((a, r) => a + r.size, 0))} МБ.`);
out.push(
  `\nОтсутствующие пути в документах: ${missing.length ? missing.map((m) => `${m.doc} → ${m.path}`).join('; ') : 'нет'}.`,
);

print(out.join('\n'));
const ji = process.argv.indexOf('--json');
if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify({ rows, missing }, null, 2));
const mi = process.argv.indexOf('--md');
if (mi > 0) {
  const lines = [
    '| Файл | КБ | px | Класс | Ссылки из документов | Прочие ссылки |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows)
    lines.push(
      `| \`${r.file}\` | ${(r.size / 1024).toFixed(0)} | ${r.w}×${r.h} | ${r.cls} | ${r.refs.map((x) => `${x.doc}${x.kind === 'name' ? ' (имя)' : ''}`).join(', ') || (r.dirRefs.length ? 'папка: ' + r.dirRefs.join(', ') : '')} | ${r.otherRefs
        .map((x) => x.doc)
        .slice(0, 2)
        .join(', ')} |`,
    );
  writeFileSync(process.argv[mi + 1], lines.join('\n') + '\n');
}
