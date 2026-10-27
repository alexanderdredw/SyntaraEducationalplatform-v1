#!/usr/bin/env node
// REQ-CHEM-01 (docs/CHEM_TZ.md): перенос «Молекулярного атласа» в предмет «Химия» —
//   node scripts/content-import/atlas-chemistry.mjs --source <папка атласа>
// Читает данные (js/data/*.js) и тексты (locales/ru_v2, kk_v3, en_v2) атласа, применяет утверждённые правки
// (atlas-chemistry.fixes.yaml) и переводы (atlas-chemistry.translations.yaml), пишет content/natural-sciences/01-chemistry/.
// Повторный запуск даёт тот же результат. Папка атласа только читается; код ИИ атласа и js/secrets.js не открываются.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as prettier from 'prettier';
import { atomSvg, SHELLS } from '../content-art/atoms.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = createRequire(join(root, 'packages/db/package.json'))('yaml');
const sharp = createRequire(join(root, 'apps/worker/package.json'))('sharp');

const args = process.argv.slice(2);
const sourceArg = args.indexOf('--source');
if (sourceArg < 0 || !args[sourceArg + 1]) {
  console.error('Usage: node scripts/content-import/atlas-chemistry.mjs --source <папка атласа>');
  process.exit(2);
}
const SRC = resolve(args[sourceArg + 1]);
const OUT = join(root, 'content/natural-sciences/01-chemistry');
const LANGS = ['ru', 'kk', 'en'];
const here = (f) => join(root, 'scripts/content-import', f);
const FIX = YAML.parse(readFileSync(here('atlas-chemistry.fixes.yaml'), 'utf8'));
const TR = YAML.parse(readFileSync(here('atlas-chemistry.translations.yaml'), 'utf8'));
const problems = [];

/* ---------- Источник ---------- */

function runData(file, name) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(SRC, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window[name];
}
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const items = runData('js/data/anatomy-data.js', 'anatomyData');
const LOCALE_FILES = { ru: 'ru_v2.json', kk: 'kk_v3.json', en: 'en_v2.json' };
const L = Object.fromEntries(
  LANGS.map((l) => [
    l,
    flatten(JSON.parse(readFileSync(join(SRC, 'locales', LOCALE_FILES[l]), 'utf8').replace(/^﻿/, ''))),
  ]),
);

// Утверждённые замены подстрок (fixes.replace) — до любого разбора текста.
for (const r of FIX.replace ?? []) {
  for (const l of [r.lang].flat()) {
    const value = L[l][r.key];
    if (typeof value !== 'string' || !value.includes(r.from))
      problems.push(`замена не найдена: ${r.key} [${l}] «${r.from}»`);
    else L[l][r.key] = value.split(r.from).join(r.to);
  }
}

const text = (lang, key) => {
  const v = L[lang][key];
  if (typeof v !== 'string' || !v.trim()) {
    problems.push(`нет текста: ${key} [${lang}]`);
    return '';
  }
  return v.trim();
};
const inline = (s) =>
  s
    .replace(/<\/?(b|strong)>/g, '**')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/* ---------- Разделы урока элемента (CHEM_MAP 1.1, 1.2) ---------- */

/** details элемента: «<b>Заголовок</b><br>• пункт<br>…» → [{ title, md }]. */
function elementSections(html) {
  const parts = html.split(/<b>(.*?)<\/b>/);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const lines = parts[i + 1]
      .split(/<br\s*\/?>/)
      .map((x) => x.trim())
      .filter(Boolean)
      // Пункты, записанные в одну строку («• А • Б»), — отдельными пунктами.
      .flatMap((x) => x.split(/\s+•\s+/).map((y, k) => (k > 0 ? `• ${y}` : y)));
    const md = lines
      .map((x) => (x.startsWith('•') ? `- ${inline(x.replace(/^•\s*/, ''))}` : inline(x)))
      .join('\n');
    out.push({ title: inline(parts[i]), md });
  }
  return out;
}

/** Код раздела — по русскому заголовку (у 57 элементов порядок единый; исключения — C, N, Ne). */
function sectionCode(ruTitle) {
  const rules = [
    [/^Основные факты/, 'basic-facts'],
    [/^Атомная структура/, 'atomic-structure'],
    [/^Физические свойства/, 'physical-properties'],
    [/^Химические свойства/, 'chemical-properties'],
    [/^Изотопы/, 'isotopes'],
    [/^Нахождение в природе/, 'occurrence'],
    [/^Промышленное производство/, 'production'],
    [/^Промышленное значение/, 'industrial-significance'],
    [/^Применение/, 'applications'],
    [/^Аллотропные модификации/, 'allotropes'],
    [/^Углеродный цикл/, 'carbon-cycle'],
    [/^Азотный цикл/, 'nitrogen-cycle'],
    [/^Значение/, 'significance'],
    [/^Взаимодействие с другими областями/, 'connections'],
  ];
  for (const [re, code] of rules) if (re.test(ruTitle)) return code;
  problems.push(`неизвестный раздел: ${ruTitle}`);
  return 'section';
}

/* ---------- Квиз ---------- */

/** Детерминированная перестановка вариантов (В-7): одна и та же для всех языков и запусков. */
function permutation(seed, n) {
  const order = [...Array(n).keys()];
  const bytes = createHash('sha256').update(seed).digest();
  for (let i = n - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Сложность по смыслу вопроса (CHEM_MAP 1.1). */
function difficulty(ru) {
  // \b в JS не работает с кириллицей — границы слова явно.
  if (/(^|\s)НЕ(\s|$)/.test(ru)) return 'hard';
  if (
    /протон|символ|валентн|степень окисления|тип(а)? (иона|частиц)|какая частица|в какой группе|в каком периоде|количество электронов|сколько электронов/i.test(
      ru,
    )
  )
    return 'easy';
  return 'medium';
}

/**
 * Вопрос single_choice: тексты по языкам (варианты — в порядке атласа), верный — индекс атласа. Варианты
 * переставляются по коду вопроса.
 */
function choiceQuestion(fullCode, code, texts, correct) {
  const n = texts.ru.options.length;
  for (const l of LANGS)
    if (!texts[l] || texts[l].options.length !== n)
      problems.push(`${fullCode}: нет ${n} вариантов на языке ${l}`);
  const order = permutation(fullCode, n);
  return {
    code,
    type: 'single_choice',
    difficulty: difficulty(texts.ru.text),
    text: Object.fromEntries(LANGS.map((l) => [l, texts[l]?.text ?? ''])),
    options: order.map((i) => ({
      text: Object.fromEntries(LANGS.map((l) => [l, texts[l]?.options[i] ?? ''])),
      ...(i === correct ? { correct: true } : {}),
    })),
  };
}

function elementQuiz(it, topicCode) {
  const fixes = FIX.quiz?.[it.id] ?? {};
  const questions = [];
  it.ai.questions.forEach((q, i) => {
    const code = `q${i + 1}`;
    const fix = fixes[code];
    if (fix === 'remove') return;
    const ru = { text: text('ru', q.textKey), options: q.options.map((k) => text('ru', k)) };
    let correct = q.correctIndex;
    if (fix?.text) ru.text = fix.text;
    if (Array.isArray(fix?.options)) ru.options = [...fix.options];
    else if (fix?.options) for (const [k, v] of Object.entries(fix.options)) ru.options[Number(k)] = v;
    if (fix?.correct !== undefined) correct = fix.correct;
    const tr = TR.quiz?.[it.id]?.[code];
    if (!tr) problems.push(`нет перевода вопроса ${it.id}.${code}`);
    questions.push(choiceQuestion(`${topicCode}/q/${code}`, code, { ru, kk: tr?.kk, en: tr?.en }, correct));
  });
  return { questions };
}

/* ---------- Учёные (CHEM_MAP 1.4) ---------- */

/** Статья учёного из details (HTML) → Markdown на языке lang. */
function article(id, lang) {
  let html = text(lang, `system.${id}.details`)
    .replace(/^<div class='scientist-details'>/, '')
    .replace(/<\/div>$/, '');
  const blocks = [];
  const take = (re) => {
    const m = html.match(re);
    if (m) html = html.slice(m[0].length);
    return m;
  };
  while (html.trim()) {
    let m;
    if ((m = take(/^\s*<div class='scientist-tagline'>(.*?)<\/div>/))) blocks.push(`*${inline(m[1])}*`);
    else if ((m = take(/^\s*<blockquote class='scientist-quote'>(.*?)<\/blockquote>/))) {
      if ((FIX.quotes?.remove ?? []).includes(id)) continue;
      const mark = (FIX.quotes?.exact ?? []).includes(id) ? '' : ` *(${FIX.quotes.attributed[lang]})*`;
      blocks.push(`> ${inline(m[1])}${mark}`);
    } else if ((m = take(/^\s*<h3>(.*?)<\/h3>/))) blocks.push(`### ${inline(m[1])}`);
    else if ((m = take(/^\s*<p>(.*?)<\/p>/))) blocks.push(inline(m[1]));
    else if ((m = take(/^\s*<div class='highlight-box'>(.*?)<\/div>/))) blocks.push(inline(m[1]));
    else if ((m = take(/^\s*<ul>(.*?)<\/ul>/)))
      blocks.push([...m[1].matchAll(/<li>(.*?)<\/li>/g)].map((li) => `- ${inline(li[1])}`).join('\n'));
    else {
      problems.push(`${id} [${lang}]: не разобран фрагмент «${html.slice(0, 60)}»`);
      break;
    }
  }
  const add = FIX.articleAdd?.[id]?.[lang];
  if (add) blocks.push(`### ${add.title}`, add.body);
  return blocks;
}

/* ---------- Запись ---------- */

const yaml = (data) => YAML.stringify(data, { lineWidth: 0 });
const frontMatter = (data, body) => `---\n${yaml(data)}---\n\n${body.trim()}\n`;
/** Файлы результата: пишутся только если ошибок нет (иначе content/ не меняется). */
const outputs = new Map();
const written = new Set();
function write(rel, content) {
  outputs.set(rel, content);
  written.add(rel);
}

async function webpFromSvg(svg) {
  return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}

/** Портрет с Wikimedia Commons (В-6): скачивается, если файла ещё нет (кеш в content/); WebP ≤ 1200 px, ≤ 290 КБ. */
async function portrait(rel, file) {
  const path = join(OUT, rel);
  written.add(rel);
  if (existsSync(path)) return;
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=1200`;
  let res;
  // Commons ограничивает частоту запросов (429): повтор с паузой, не больше 5 попыток.
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': 'SyntaraContentImport/1.0 (content migration)' } });
    if (res.status !== 429 || attempt === 5) break;
    const wait = Number(res.headers.get('retry-after')) || 5 * attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const original = Buffer.from(await res.arrayBuffer());
  // BR-CNT-06: ≤ 300 КБ (с запасом — 290 КБ): от оригинала уменьшаются качество, затем ширина.
  let buf;
  for (const [width, quality] of [
    [1200, 85],
    [1200, 75],
    [1000, 75],
    [900, 70],
    [800, 70],
  ]) {
    buf = await sharp(original).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (buf.length <= 290 * 1024) break;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

const commonsPage = (file) => `https://commons.wikimedia.org/wiki/File:${file.replace(/ /g, '_')}`;

/* ---------- Предмет ---------- */

const SUBJECT = {
  code: 'chemistry',
  position: 1,
  title: { ru: 'Химия', kk: 'Химия', en: 'Chemistry' },
  description: {
    ru: 'Элементы, реакции, молекулярные структуры',
    kk: 'Элементтер, реакциялар, молекулалық құрылымдар',
    en: 'Elements, reactions, molecular structures',
  },
  chapters: [
    {
      code: 'elements',
      position: 1,
      title: { ru: 'Химические элементы', kk: 'Химиялық элементтер', en: 'Chemical elements' },
    },
    { code: 'scientists', position: 2, title: { ru: 'Учёные-химики', kk: 'Химик ғалымдар', en: 'Chemists' } },
  ],
};

const ALT = {
  ru: (name, sym, z, shells) =>
    `Модель атома по Бору: ${name}, ${sym}. Протонов в ядре — ${z}; электроны по оболочкам — ${shells.join(', ')}.`,
  kk: (name, sym, z, shells) =>
    `Бор бойынша атом моделі: ${name}, ${sym}. Ядродағы протондар саны — ${z}; қабықтардағы электрондар — ${shells.join(', ')}.`,
  en: (name, sym, z, shells) =>
    `Bohr model of an atom: ${name}, ${sym}. Protons in the nucleus: ${z}; electrons in shells: ${shells.join(', ')}.`,
};
const SOURCES = { ru: 'Источники', kk: 'Дереккөздер', en: 'Sources' };
const FACT_LABEL = { ru: 'Интересный факт', kk: 'Қызықты факт', en: 'Fun fact' };

async function elementTopic(it) {
  const code = FIX.codes?.[it.id] ?? it.id;
  const dir = `${String(it.atomicNumber).padStart(2, '0')}-${code}`;
  const topicCode = `chemistry/${code}`;
  const omitFact = (FIX.facts?.omit ?? []).includes(it.id);
  const sections = Object.fromEntries(LANGS.map((l) => [l, elementSections(text(l, it.detailsKey))]));
  if (sections.kk.length !== sections.ru.length || sections.en.length !== sections.ru.length)
    problems.push(`${it.id}: разное число разделов RU/KK/EN`);
  const codes = sections.ru.map((s) => sectionCode(s.title));
  const significance = FIX.significanceTitle?.elements.includes(it.id) ? FIX.significanceTitle.title : null;

  const image = `media/${code}-atom.webp`;
  write(`${dir}/${image}`, await webpFromSvg(atomSvg({ symbol: it.symbol, number: it.atomicNumber })));

  for (const l of LANGS) {
    const title = FIX.titles?.[it.id]?.[l] ?? text(l, it.titleKey);
    // EN — перевод RU-факта там, где в атласе шаблон (translations.facts).
    const fact = omitFact
      ? undefined
      : (FIX.facts?.set?.[it.id]?.[l] ??
        (l === 'en' ? TR.facts?.[it.id]?.en : undefined) ??
        text(l, it.factKey));
    const body = sections[l]
      .map((s, i) => {
        const heading = codes[i] === 'significance' && significance ? significance[l] : s.title;
        return `## ${heading} {#${codes[i]}}\n\n${s.md}`;
      })
      .concat(
        `## ${SOURCES[l]} {#sources}\n\n${it.resources.map((r) => `- [${text(l, r.textKey)}](${r.url})`).join('\n')}`,
      )
      .join('\n\n');
    const head = {
      ...(l === 'ru' ? { code, chapter: 'elements', position: it.atomicNumber } : {}),
      title,
      description: text(l, it.descKey),
      ...(fact ? { funFact: fact } : {}),
      ...(l === 'ru' ? { illustration: image } : {}),
      illustrationAlt: ALT[l](title.toLowerCase(), it.symbol, it.atomicNumber, SHELLS[it.atomicNumber]),
      ...(l === 'ru'
        ? {
            media: [
              {
                file: image,
                source: 'Собственная схема Syntara (модель Бора), исходник — scripts/content-art/atoms.mjs',
                license: 'own',
              },
            ],
          }
        : { review: 'needs_review' }),
    };
    write(`${dir}/${l}.md`, frontMatter(head, body));
  }
  write(`${dir}/quiz.yaml`, yaml(elementQuiz(it, topicCode)));
}

async function chemistsTopic() {
  const dir = '61-chemists';
  const scientists = items
    .filter((i) => i.groupKey === 'scientist')
    .sort((a, b) => a.atomicNumber - b.atomicNumber);
  const media = [];
  for (const s of scientists) {
    const p = FIX.portraits?.[s.id];
    if (!p) continue;
    const file = `media/${s.id}.webp`;
    await portrait(`${dir}/${file}`, p.file);
    media.push({
      file,
      source: `Wikimedia Commons: ${commonsPage(p.file)}`,
      license: 'public-domain',
      author: p.author,
    });
  }
  for (const l of LANGS) {
    const sections = scientists.map((s) => {
      const p = FIX.portraits?.[s.id];
      const desc = FIX.descriptions?.[s.id]?.[l] ?? text(l, `system.${s.id}.desc`);
      const blocks = [
        ...(p ? [`![${p.alt[l]}](media/${s.id}.webp)`] : []),
        `**${desc}**`,
        ...article(s.id, l),
        ...(s.id === 'mendeleev'
          ? []
          : [`**${FACT_LABEL[l]}:** ${FIX.facts?.set?.[s.id]?.[l] ?? text(l, `system.${s.id}.fact`)}`]),
      ];
      return `## ${text(l, s.titleKey)} {#${s.id}}\n\n${blocks.join('\n\n')}`;
    });
    sections.push(
      `## ${SOURCES[l]} {#sources}\n\n${scientists
        .flatMap((s) => s.resources.map((r) => `- [${text(l, r.textKey)}](${r.url})`))
        .join('\n')}`,
    );
    const head = {
      ...(l === 'ru' ? { code: 'chemists', chapter: 'scientists', position: 1 } : {}),
      title: SUBJECT.chapters[1].title[l],
      description: text(l, 'timeline.subtitle'),
      funFact: FIX.facts?.set?.mendeleev?.[l] ?? text(l, 'system.mendeleev.fact'),
      ...(l === 'ru' ? { media } : { review: 'needs_review' }),
    };
    write(`${dir}/${l}.md`, frontMatter(head, sections.join('\n\n')));
  }
  // Квиз (В-15): 13 отобранных вопросов с именем учёного; варианты — из атласа, верный — первый.
  const questions = (TR.chemistsQuiz ?? []).map((q) => {
    const [, id, n] = q.source.match(/^ai\.(\w+)\.q(\d)$/);
    const item = items.find((i) => i.id === id);
    const src = item.ai.questions[Number(n) - 1];
    const texts = Object.fromEntries(
      LANGS.map((l) => [l, { text: q.text[l], options: src.options.map((k) => text(l, k)) }]),
    );
    const code = `${id}-q${n}`;
    const question = choiceQuestion(`chemistry/chemists/q/${code}`, code, texts, src.correctIndex);
    return { ...question, difficulty: q.difficulty };
  });
  write(`${dir}/quiz.yaml`, yaml({ questions }));
}

/* ---------- Глоссарий (REQ-GLOS-01, CHEM_MAP 1.6, 3.7) ---------- */

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function glossary() {
  const data = runData('js/data/glossary-data.js', 'glossaryData');
  const fix = FIX.glossary ?? {};
  const used = new Set();
  const sections = data.map((s, si) => ({
    code: fix.sections[si],
    position: si + 1,
    title: Object.fromEntries(LANGS.map((l) => [l, text(l, s.titleKey)])),
    terms: s.terms
      .map((t) => ({ t, n: Number(t.termKey.split('.').pop()) }))
      .filter(({ n }) => !(fix.remove ?? []).includes(n))
      .map(({ t, n }) => {
        // Код — слаг английского термина (постоянный ключ импорта); совпадения получают номер.
        let code = slug(text('en', t.termKey)) || `term-${n}`;
        for (let k = 2; used.has(code); k++) code = `${slug(text('en', t.termKey))}-${k}`;
        used.add(code);
        return {
          code,
          term: Object.fromEntries(LANGS.map((l) => [l, text(l, t.termKey)])),
          definition: Object.fromEntries(
            LANGS.map((l) => [l, fix.definitions?.[n]?.[l] ?? text(l, t.defKey)]),
          ),
        };
      }),
  }));
  write(
    'glossary.yaml',
    `# Глоссарий «Химии» (REQ-GLOS-01). Создан конвертером scripts/content-import/atlas-chemistry.mjs — правки в
# atlas-chemistry.fixes.yaml (раздел glossary), а не здесь. KK и EN — перевод ИИ, на проверке.
${yaml({ review: { kk: 'needs_review', en: 'needs_review' }, sections })}`,
  );
}

/* ---------- Запуск ---------- */

write(
  'subject.yaml',
  `# Базовый предмет (BR-CNT-02). Создан конвертером scripts/content-import/atlas-chemistry.mjs — правки в нём
# и в atlas-chemistry.fixes.yaml, а не здесь (REQ-CHEM-01).
${yaml(SUBJECT)}`,
);
for (const it of items
  .filter((i) => i.groupKey !== 'scientist')
  .sort((a, b) => a.atomicNumber - b.atomicNumber))
  await elementTopic(it);
await chemistsTopic();
glossary();

if (problems.length) {
  for (const p of problems) console.error(`[atlas] ${p}`);
  console.error(`[atlas] ошибок — ${problems.length}; content/ не изменён`);
  process.exit(1);
}
// Тексты — в стиле репозитория (prettier в CI), иначе повторный запуск и `pnpm lint` расходились бы.
for (const [rel, content] of outputs) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  const formatted =
    typeof content === 'string'
      ? await prettier.format(content, { ...(await prettier.resolveConfig(path)), filepath: path })
      : content;
  writeFileSync(path, formatted);
}

// Лишнее в папке предмета (темы и файлы прошлых запусков) удаляется: результат определяется только источником и правками.
function prune(rel) {
  const abs = join(OUT, rel);
  for (const name of readdirSync(abs, { withFileTypes: true })) {
    const child = rel ? `${rel}/${name.name}` : name.name;
    if (name.isDirectory()) {
      prune(child);
      if (readdirSync(join(OUT, child)).length === 0) rmSync(join(OUT, child), { recursive: true });
    } else if (!written.has(child)) rmSync(join(OUT, child));
  }
}
prune('');
console.warn(`[atlas] записано файлов: ${written.size} в ${OUT.slice(root.length + 1)}`);
