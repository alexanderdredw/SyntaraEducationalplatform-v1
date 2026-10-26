#!/usr/bin/env node
// OPT-03 (docs/OPTIMIZATION_TZ.md, раздел 6.4): оценка выигрыша сжатия скриншотов docs/media — без записи файлов.
// Варианты: PNG без потерь (максимальное сжатие zlib), WebP quality 85, WebP q85 + ширина ≤ 1600 px.
// Эталоны (раздел 2) считаются отдельно — их сжимать нельзя, цифра только для сведения.
// Использует sharp из apps/worker. Запуск из корня: node scripts/opt/media-compress-estimate.mjs [--json out.json]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const print = (s = '') => process.stdout.write(`${s}\n`);

const root = process.cwd();
const sharp = createRequire(join(root, 'apps/worker/package.json'))('sharp');
const files = execSync('git ls-files docs/media', { maxBuffer: 1 << 26 })
  .toString()
  .split('\n')
  .filter((f) => /\.(png|jpe?g)$/i.test(f));
const REFERENCE = [
  /^docs\/media\/image\d+\.(jpg|jpeg)$/i,
  /^docs\/media\/student-auth[^/]*\.png$/i,
  /^docs\/media\/ux\/[^/]*-ref\.png$/i,
  /^docs\/media\/public\//,
];

const rows = [];
for (const f of files) {
  const buf = readFileSync(join(root, f));
  const img = sharp(buf);
  const meta = await img.metadata();
  const png = f.toLowerCase().endsWith('.png')
    ? (await sharp(buf).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer()).length
    : buf.length;
  const webp = (await sharp(buf).webp({ quality: 85, effort: 5 }).toBuffer()).length;
  const webp1600 =
    meta.width > 1600
      ? (await sharp(buf).resize({ width: 1600 }).webp({ quality: 85, effort: 5 }).toBuffer()).length
      : webp;
  rows.push({
    f,
    ref: REFERENCE.some((r) => r.test(f)),
    w: meta.width,
    orig: buf.length,
    png: Math.min(png, buf.length),
    webp,
    webp1600,
  });
}

const sum = (rs, k) => rs.reduce((a, r) => a + r[k], 0);
const mb = (b) => (b / 1048576).toFixed(1);
for (const [label, rs] of [
  ['Без эталонов', rows.filter((r) => !r.ref)],
  ['Эталоны (не трогать)', rows.filter((r) => r.ref)],
]) {
  print(
    `${label}: ${rs.length} файлов, сейчас ${mb(sum(rs, 'orig'))} МБ → PNG без потерь ${mb(sum(rs, 'png'))} МБ; WebP q85 ${mb(sum(rs, 'webp'))} МБ; WebP q85 ≤1600 px ${mb(sum(rs, 'webp1600'))} МБ`,
  );
}
const ji = process.argv.indexOf('--json');
if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify(rows, null, 2));
