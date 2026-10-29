import { z } from 'zod';
import { ELEMENT_FAMILIES } from './periodic-table';

/**
 * Модуль «Mendeleev Atlas» (docs/CHEM_TZ_2.md, docs/ATLAS_MAP.md): чистые правила квиза «Проверь знания» и игры
 * «Кто этот учёный?» — те же, что в оригинале атласа (js/components/Quiz.js, ScientistsQuiz.js), — и разбор текстов
 * урока «Учёные-химики». Общие для api (вопросы строит и проверяет сервер, BR-QZ-01) и web.
 */

export const ATLAS_QUIZ_KINDS = ['elements', 'scientists'] as const;
export type AtlasQuizKind = (typeof ATLAS_QUIZ_KINDS)[number];

/** Квиз «Проверь знания» — 10 вопросов; игра про учёных — по одному вопросу на учёного, не больше 10. */
export const ATLAS_QUIZ_LENGTH = 10;

/** REQ-TST-11: режимы квиза «Проверь знания» на стартовом экране (игра про учёных — только «Быстрый»). */
export const ATLAS_QUIZ_MODES = ['quick', 'family', 'mistakes', 'table'] as const;
export type AtlasQuizMode = (typeof ATLAS_QUIZ_MODES)[number];

/** Без kind — квиз «Проверь знания» (так неизвестный предмет даёт 404, а не ошибку проверки — API-GEN-08). */
export const AtlasQuizStartDto = z.object({
  kind: z.enum(ATLAS_QUIZ_KINDS, 'required').default('elements'),
  /** REQ-TST-05.4 «Повторить ошибки»: своя завершённая сессия — новая только по её ошибкам. */
  retry: z.uuid('required').optional(),
  /** REQ-TST-11: режим; «По семейству» — с семейством. */
  mode: z.enum(ATLAS_QUIZ_MODES, 'required').default('quick'),
  family: z.enum(ELEMENT_FAMILIES, 'required').optional(),
});
export type AtlasQuizStartDto = z.infer<typeof AtlasQuizStartDto>;

/** Ответ: вариант (выбор, «Верно/Неверно», ячейка таблицы) или текст («Впишите символ», REQ-TST-10). */
export const AtlasQuizAnswerDto = z
  .object({
    optionId: z.string().trim().min(1, 'required').max(200, 'tooLong').optional(),
    text: z.string().trim().min(1, 'required').max(20, 'tooLong').optional(),
  })
  .refine((v) => v.optionId !== undefined || v.text !== undefined, {
    message: 'required',
    path: ['optionId'],
  });
export type AtlasQuizAnswerDto = z.infer<typeof AtlasQuizAnswerDto>;

export type AtlasDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Квиз элементов (Quiz.js): уровни 1–3, старт — 2. Лёгкий — 2 варианта, средний и сложный — 4; на сложном вопрос —
 * интересный факт вместо описания. Уровень меняется по последним 5 ответам после третьего: ≥ 80% — выше, < 50% —
 * ниже; после смены окно очищается.
 */
export const ELEMENT_QUIZ = { start: 2, window: 5 } as const;

export function elementDifficulty(level: number): AtlasDifficulty {
  return level <= 1 ? 'easy' : level === 2 ? 'medium' : 'hard';
}

export function nextElementLevel(level: number, history: number[]): { level: number; history: number[] } {
  const window = history.slice(-ELEMENT_QUIZ.window);
  if (window.length < 3) return { level, history: window };
  const accuracy = window.reduce((a, b) => a + b, 0) / window.length;
  if (accuracy >= 0.8 && level < 3) return { level: level + 1, history: [] };
  if (accuracy < 0.5 && level > 1) return { level: level - 1, history: [] };
  return { level, history: window };
}

/**
 * Игра про учёных (ScientistsQuiz.js): уровни 0–2, старт — 1. Лёгкий — 2 варианта, средний и сложный — 4. Два верных
 * подряд — уровень выше, два неверных подряд — ниже; счётчик после смены обнуляется.
 */
export const SCIENTIST_QUIZ = { start: 1 } as const;

export function scientistDifficulty(level: number): AtlasDifficulty {
  return level <= 0 ? 'easy' : level === 1 ? 'medium' : 'hard';
}

export function nextScientistLevel(
  level: number,
  streak: { correct: number; wrong: number },
  correct: boolean,
): { level: number; streak: { correct: number; wrong: number } } {
  if (correct) {
    const c = streak.correct + 1;
    return c >= 2
      ? { level: Math.min(2, level + 1), streak: { correct: 0, wrong: 0 } }
      : { level, streak: { correct: c, wrong: 0 } };
  }
  const w = streak.wrong + 1;
  return w >= 2
    ? { level: Math.max(0, level - 1), streak: { correct: 0, wrong: 0 } }
    : { level, streak: { correct: 0, wrong: w } };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = 'a-zA-Zа-яА-ЯёЁәіңғүұқөһӘІҢҒҮҰҚӨҺ0-9';

type MaskLocale = 'ru' | 'kk' | 'en';

/** Основа длиннее этого — скрываются все слова, где она встречается (BR-TST-03, проверка AC-TST-08). */
export const STEM_MIN = 4;

/**
 * BR-TST-03: основа названия элемента для поиска форм слова. RU — без окончания (-ий, -ь, -й, гласная): «Литий» →
 * «лит», «Медь» → «мед», «Кислород» → «кислород»; KK — без конечной гласной или -й: «Оттегі» → «оттег»; EN — без
 * -ium, -um, -ine, если остаётся не меньше 4 букв: «Chlorine» → «chlor» (chloride), иначе всё слово.
 */
export function elementStem(title: string, locale: MaskLocale): string {
  const s = title.trim().toLocaleLowerCase(locale);
  if (locale === 'en') {
    const cut = s.replace(/(ium|um|ine)$/, '');
    return cut.length >= STEM_MIN ? cut : s;
  }
  return locale === 'ru' ? s.replace(/(ий|ь|й|[аяоеиыуюё])$/, '') : s.replace(/[аәеиіоөуұүыэй]$/, '');
}

/** Окончания падежей и производных для короткой основы (< 4 букв): «бор» → «бора», «борный»; «мыс» → «мыстың». */
const ENDINGS: Record<MaskLocale, string[]> = {
  ru: [
    ...[
      'а',
      'я',
      'у',
      'ю',
      'ом',
      'ем',
      'ём',
      'ой',
      'ей',
      'е',
      'и',
      'ы',
      'ь',
      'ью',
      'ий',
      'ия',
      'ию',
      'ием',
      'ии',
    ],
    ...[
      'ный',
      'ная',
      'ное',
      'ные',
      'ного',
      'ной',
      'ному',
      'ным',
      'ных',
      'ную',
      'ными',
      'ов',
      'ам',
      'ами',
      'ах',
    ],
    ...['иевый', 'иевая', 'иевое', 'иевые', 'иевого', 'иевой', 'иевую', 'иевых', 'иевым'],
    ...['ат', 'аты', 'атов', 'ид', 'иды', 'идов', 'ит', 'иты'],
  ],
  kk: [
    ...[
      'ы',
      'і',
      'ға',
      'ге',
      'қа',
      'ке',
      'на',
      'не',
      'да',
      'де',
      'та',
      'те',
      'нда',
      'нде',
      'дан',
      'ден',
      'тан',
    ],
    ...[
      'тен',
      'нан',
      'нен',
      'мен',
      'бен',
      'пен',
      'ның',
      'нің',
      'дың',
      'дің',
      'тың',
      'тің',
      'н',
      'ны',
      'ні',
      'ды',
    ],
    ...['ді', 'ты', 'ті', 'лар', 'лер', 'дар', 'дер', 'тар', 'тер', 'лы', 'лі', 'ды', 'ді'],
  ],
  en: ['s', 'es'],
};

/**
 * Загадка квиза элементов (Quiz.js; BR-TST-03): скрываются на «___» название во всех формах слова (основа ≥ 4 букв —
 * любое слово, где она встречается: «кислорода», «кислородный», «углекислый»; короче — основа с окончаниями
 * падежей), само название и символ отдельным словом (с учётом регистра). Вступление «___ — это элемент №N…»
 * убирается, первая буква — заглавная, точка в конце — убирается.
 */
export function maskElementText(
  text: string,
  title: string,
  symbol: string,
  locale: MaskLocale = 'ru',
): string {
  let out = text;
  const word = (body: string, flags: string) => new RegExp(`(^|[^${WORD}])(${body})(?=[^${WORD}]|$)`, flags);
  if (title) {
    const stem = elementStem(title, locale);
    out = out.replace(word(escape(title), 'giu'), '$1___');
    out =
      stem.length >= STEM_MIN
        ? out.replace(new RegExp(`[${WORD}]*${escape(stem)}[${WORD}]*`, 'giu'), '___')
        : out.replace(word(`${escape(stem)}(?:${ENDINGS[locale].join('|')})?`, 'giu'), '$1___');
  }
  if (symbol) out = out.replace(word(escape(symbol), 'gu'), '$1___');
  out = out.replace(/^___\s*[-—–]?\s*(is|это)?\s*(element|элемент)\s*(#|№)?\s*\d+,?\s*(a\s+|an\s+)?/i, '');
  out = out.replace(/^___\s*[-—–]?\s*(is|это)?\s*(a\s+|an\s+)?/i, '');
  out = out.trim();
  if (out) out = out.charAt(0).toLocaleUpperCase() + out.slice(1);
  return out.endsWith('.') ? out.slice(0, -1) : out;
}

/**
 * AC-TST-08: что в тексте вопроса выдаёт ответ — основа названия (≥ 4 букв) где угодно, название или символ
 * отдельным словом. Пусто — утечек нет.
 */
export function maskLeaks(masked: string, title: string, symbol: string, locale: MaskLocale): string[] {
  const leaks: string[] = [];
  const lower = masked.toLocaleLowerCase(locale);
  const stem = elementStem(title, locale);
  if (stem.length >= STEM_MIN && lower.includes(stem)) leaks.push(stem);
  const word = (body: string, flags: string) =>
    new RegExp(`(^|[^${WORD}])${body}([^${WORD}]|$)`, flags).test(masked);
  if (title && word(escape(title), 'iu')) leaks.push(title);
  if (symbol && word(escape(symbol), 'u')) leaks.push(symbol);
  return leaks;
}

/**
 * Текст вопроса квиза «Проверь знания» на уровне 1–3 (BR-TST-03): сложный — интересный факт, иначе описание; если
 * факт не удаётся надёжно замаскировать — описание; не удаётся и его — null (элемент на этом уровне не спрашивается).
 */
export function elementQuizText(
  level: number,
  texts: { title: string; description?: string | null; funFact?: string | null },
  symbol: string,
  locale: MaskLocale,
): string | null {
  const sources = level >= 3 ? [texts.funFact, texts.description] : [texts.description];
  for (const source of sources) {
    if (!source) continue;
    const masked = maskElementText(source, texts.title, symbol, locale);
    if (masked && maskLeaks(masked, texts.title, symbol, locale).length === 0) return masked;
  }
  return null;
}

/* ---------- Неверные варианты (REQ-TST-07, BR-TST-02) ---------- */

/** Вариантов в вопросе квиза и игры атласа — всегда 4 на всех уровнях (REQ-TST-07.1). */
export const ATLAS_OPTIONS = 4;

export interface ElementCandidate {
  id: string;
  number: number;
  family: string;
  period: number;
  group: number | null;
}

/** Случайные `n` из списка без повторов; `random(k)` — целое из [0, k). */
function sample<T>(list: T[], n: number, random: (k: number) => number): T[] {
  const rest = [...list];
  const out: T[] = [];
  while (out.length < n && rest.length) out.push(rest.splice(random(rest.length), 1)[0]!);
  return out;
}

/** Добрать недостающие ближайшими по номеру (по году у учёных). */
function fillNearest<T extends { id: string }>(
  chosen: T[],
  pool: T[],
  need: number,
  distance: (c: T) => number,
): T[] {
  const ids = new Set(chosen.map((c) => c.id));
  const rest = pool.filter((c) => !ids.has(c.id)).sort((a, b) => distance(a) - distance(b));
  return [...chosen, ...rest.slice(0, Math.max(0, need - chosen.length))];
}

/**
 * BR-TST-02: три неверных варианта к элементу по уровню. Лёгкий — из других семейств; средний — 1–2 из того же
 * семейства или соседние по номеру (±2), остальные — из других семейств; сложный — все из того же семейства или
 * соседние по периоду/группе. Не хватает — добираются ближайшими по номеру. Без повторов и без верного.
 */
export function pickElementDistractors(
  item: ElementCandidate,
  pool: ElementCandidate[],
  difficulty: AtlasDifficulty,
  random: (k: number) => number,
): string[] {
  const need = ATLAS_OPTIONS - 1;
  const others = pool.filter((c) => c.id !== item.id);
  const sameFamily = (c: ElementCandidate) => c.family === item.family;
  const near = (c: ElementCandidate) => sameFamily(c) || Math.abs(c.number - item.number) <= 2;
  const related = (c: ElementCandidate) =>
    sameFamily(c) || c.period === item.period || (item.group !== null && c.group === item.group);
  let chosen: ElementCandidate[];
  if (difficulty === 'easy')
    chosen = sample(
      others.filter((c) => !sameFamily(c)),
      need,
      random,
    );
  else if (difficulty === 'hard') chosen = sample(others.filter(related), need, random);
  else {
    const close = sample(others.filter(near), 1 + random(2), random);
    chosen = [
      ...close,
      ...sample(
        others.filter((c) => !near(c)),
        need - close.length,
        random,
      ),
    ];
  }
  return fillNearest(chosen, others, need, (c) => Math.abs(c.number - item.number)).map((c) => c.id);
}

/** Учёные близкой эпохи — ±50 лет (REQ-TST-07.4). */
export const SCIENTIST_EPOCH_YEARS = 50;

/**
 * REQ-TST-07.4: неверные варианты игры про учёных — на сложном уровне учёные близких эпох (±50 лет от года открытия),
 * не хватает — ближайшие по году; на остальных — случайные.
 */
export function pickScientistDistractors(
  item: { id: string; year: number | null },
  pool: Array<{ id: string; year: number | null }>,
  difficulty: AtlasDifficulty,
  random: (k: number) => number,
): string[] {
  const need = ATLAS_OPTIONS - 1;
  const others = pool.filter((c) => c.id !== item.id);
  if (difficulty !== 'hard' || item.year === null) return sample(others, need, random).map((c) => c.id);
  const gap = (c: { year: number | null }) => (c.year === null ? Infinity : Math.abs(c.year - item.year!));
  const close = sample(
    others.filter((c) => gap(c) <= SCIENTIST_EPOCH_YEARS),
    need,
    random,
  );
  return fillNearest(close, others, need, gap).map((c) => c.id);
}

/** Варианты вопроса: верный на случайной позиции среди неверных (REQ-TST-07.3). */
export function withAnswer(item: string, distractors: string[], random: (k: number) => number): string[] {
  const out = [...distractors];
  out.splice(random(out.length + 1), 0, item);
  return out;
}

/**
 * Раздел учёного в уроке «Учёные-химики» (конвертер атласа): первая строка **жирным** — описание учёного для
 * карточки и игры (`desc` атласа).
 */
export function scientistDescription(body: string | null | undefined): string {
  for (const line of (body ?? '').split('\n')) {
    const m = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (m) return m[1]!;
  }
  return '';
}

/** Инициалы учёного (бейдж окна и заглушка портрета в атласе): первые буквы первого и последнего слова. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts.at(-1)![0]!).toLocaleUpperCase();
  return name.slice(0, 2).toLocaleUpperCase();
}

/**
 * XP за квиз атласа (BR-XP-05, решение владельца А-11): за каждый правильный ответ, но не больше дневного лимита —
 * общего для квиза «Проверь знания» и игры про учёных. `usedToday` — уже начислено сегодня.
 */
export function atlasQuizXp(
  correct: number,
  perCorrect: number,
  dailyCap: number,
  usedToday: number,
): number {
  return Math.max(0, Math.min(correct * perCorrect, dailyCap - usedToday));
}

/**
 * Элементы с неуникальным описанием (решение владельца 2026-10-28): квиз «Проверь знания» их не использует, пока
 * шаблонные описания («Универсальный …, необходимый для различных …») не заменены. Неуникально описание, которое
 * совпадает с описанием другого элемента целиком или частью после первой запятой (общий «хвост» шаблона).
 * Сравнение — по исходному RU-тексту (переводы повторяют его шаблон).
 */
export function nonUniqueDescriptions(items: Array<{ id: string; description: string }>): Set<string> {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  const keys = (d: string) => {
    const full = norm(d);
    const comma = full.indexOf(',');
    return comma > 0 ? [full, `tail:${full.slice(comma + 1).trim()}`] : [full];
  };
  const seen = new Map<string, number>();
  for (const i of items) for (const k of keys(i.description)) seen.set(k, (seen.get(k) ?? 0) + 1);
  return new Set(
    items
      .filter((i) => !norm(i.description) || keys(i.description).some((k) => seen.get(k)! > 1))
      .map((i) => i.id),
  );
}
