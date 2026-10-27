/* global document, window -- код внутри page.evaluate выполняется в браузере */
// Итоговые снимки «Mendeleev Atlas» (docs/CHEM_TZ_2.md, раздел 9; AC-ATL-02): те же состояния, что эталоны
// docs/media/chem-ref/, пары «эталон / платформа» и разница по области контента (ниже шапки оригинала и полосы
// атласа). → docs/media/chem/atlas/*.webp (WebP q85, ширина ≤ 1600 px). Нужны запущенные web и api (сид demo).
// Запуск из папки e2e: node scripts/atlas-shots.mjs
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, request } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sharp = createRequire(`${root}apps/worker/package.json`)('sharp');
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const refDir = `${root}docs/media/chem-ref/`;
const out = `${root}docs/media/chem/atlas/`;
mkdirSync(out, { recursive: true });
const MAX_H = 3200;

const api = await request.newContext({ baseURL: base });
const catalog = await (await api.get('/api/public/catalog')).json();
const natural = catalog.sections.find((s) => s.title === 'Естественные науки');
const section = await (await api.get(`/api/public/sections/${natural.id}`)).json();
const subjectId = section.subjects.find((s) => s.title === 'Химия').id;
const S = `/ru/learn/subjects/${subjectId}`;

/** Ученик для экранов с XP (квиз «Проверь знания»). */
async function studentCookies() {
  const ctx = await request.newContext({ baseURL: base });
  await ctx.post('/api/auth/register-student', {
    data: {
      displayName: 'Айдана Атлас',
      login: `atl.${randomUUID().slice(0, 8)}`,
      password: 'student-pass-1',
    },
  });
  return (await ctx.storageState()).cookies;
}

const answerAll = async (page) => {
  await page.getByTestId('atlas-quiz-question').waitFor();
  for (let i = 0; i < 12; i++) {
    const opt = page.getByTestId('atlas-quiz-option').first();
    if (!(await opt.isVisible().catch(() => false))) break;
    await opt.click();
    await page.waitForTimeout(2300);
  }
};

// Состояние эталона → адрес и действия на платформе.
const states = [
  { name: 'home', path: '' },
  { name: 'explore', path: '/explore', full: true },
  { name: 'element', path: '/explore/oxygen' },
  { name: 'scientists', path: '/scientists', full: true },
  { name: 'scientist', path: '/scientists/lavoisier' },
  { name: 'quiz-start', path: '/quiz' },
  {
    name: 'quiz-question',
    path: '/quiz',
    student: true,
    act: async (p) => {
      await p.getByTestId('atlas-quiz-start').click();
      await p.getByTestId('atlas-quiz-question').waitFor();
    },
  },
  {
    name: 'quiz-result',
    path: '/quiz',
    student: true,
    full: true,
    act: async (p) => {
      await p.getByTestId('atlas-quiz-start').click();
      await answerAll(p);
      await p.getByTestId('atlas-quiz-result').waitFor();
    },
  },
  { name: 'search-results', path: '/search?q=кисло', full: true },
  { name: 'glossary', path: '/glossary', full: true },
  { name: 'syntara', path: '/ai', student: true, full: true },
];
const variants = [
  { w: 1440, h: 900, theme: 'dark' },
  { w: 390, h: 844, theme: 'dark' },
  { w: 1440, h: 900, theme: 'light', only: ['home', 'explore'] },
  { w: 390, h: 844, theme: 'light', only: ['home', 'explore'] },
];

/** Разница по области контента: оттенки серого 240 px шириной, средняя абсолютная разница, %. */
async function contentDiff(ref, plat, refTop, platTop, w, h) {
  const height = h - Math.max(refTop, platTop);
  const crop = async (buf, top) =>
    sharp(buf)
      .extract({ left: 0, top, width: w, height })
      .resize({ width: 240, height: Math.round((240 * height) / w), fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
  const [a, b] = await Promise.all([crop(ref, refTop), crop(plat, platTop)]);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return Math.round((1000 * sum) / (a.length * 255)) / 10;
}

async function pair(refPng, platPng, file, w) {
  const half = w > 500 ? 800 : 390;
  const [a, b] = await Promise.all(
    [refPng, platPng].map((x) =>
      sharp(x).resize({ width: half }).png().toBuffer({ resolveWithObject: true }),
    ),
  );
  const height = Math.min(Math.max(a.info.height, b.info.height), 4000);
  const label = (text) =>
    Buffer.from(
      `<svg width="${half}" height="28"><rect width="100%" height="100%" fill="#1d4ed8"/><text x="10" y="19" font-family="Arial" font-size="14" fill="#fff">${text}</text></svg>`,
    );
  await sharp({
    create: { width: half * 2 + 8, height: height + 28, channels: 3, background: '#888888' },
  })
    .composite([
      { input: label('Эталон (оригинал)'), left: 0, top: 0 },
      { input: label('Платформа'), left: half + 8, top: 0 },
      { input: a.data, left: 0, top: 28 },
      { input: b.data, left: half + 8, top: 28 },
    ])
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(`${out}${file}`);
}

const browser = await chromium.launch();
const student = await studentCookies();
const report = [];
for (const v of variants) {
  for (const st of states) {
    if (v.only && !v.only.includes(st.name)) continue;
    const refFile = `${refDir}${st.name}-${v.w}-${v.theme}.webp`;
    if (!existsSync(refFile)) continue;
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1 });
    await ctx.addCookies([
      ...(st.student ? student.map(({ name, value }) => ({ name, value, url: base })) : []),
      { name: 'theme', value: v.theme, url: base },
      { name: 'consent', value: 'necessary', url: base },
    ]);
    const page = await ctx.newPage();
    await page.goto(`${base}${S}${st.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    if (st.act) await st.act(page);
    await page.waitForTimeout(600);
    // Начало контента атласа: под полосой атласа (у окон — весь экран).
    const top = await page.evaluate(() => {
      const overlay = document.querySelector('.detail-overlay');
      if (overlay) return 0;
      const bar = document.querySelector('.atlas .main-header');
      return bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    });
    let png;
    if (st.full) {
      // Ленивые картинки ниже первого экрана — прокруткой до конца страницы и обратно.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const height = Math.min(MAX_H, await page.evaluate(() => document.documentElement.scrollHeight));
      png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: v.w, height } });
    } else png = await page.screenshot();
    const name = `${st.name}-${v.w}-${v.theme}`;
    await sharp(png)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(`${out}${name}.webp`);
    const ref = await sharp(refFile).png().toBuffer();
    const view = await sharp(png).extract({ left: 0, top: 0, width: v.w, height: v.h }).png().toBuffer();
    const refView = await sharp(ref)
      .extract({ left: 0, top: 0, width: v.w, height: Math.min(v.h, (await sharp(ref).metadata()).height) })
      .png()
      .toBuffer();
    // У оригинала шапка — 70 px сверху, у окон — весь экран.
    const refTop = st.name === 'element' || st.name === 'scientist' ? 0 : 70;
    const diff = await contentDiff(
      refView,
      view,
      refTop,
      top,
      v.w,
      Math.min(v.h, (await sharp(refView).metadata()).height),
    );
    await pair(ref, png, `pair-${name}.webp`, v.w);
    report.push(`${name}: разница по области контента ${diff}%`);
    console.warn(report.at(-1));
    await ctx.close();
  }
}
await browser.close();
console.warn('\n' + report.join('\n'));
