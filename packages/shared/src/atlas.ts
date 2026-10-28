import { z } from 'zod';

/**
 * Модуль «Mendeleev Atlas» (docs/CHEM_TZ_2.md, docs/ATLAS_MAP.md): чистые правила квиза «Проверь знания» и игры
 * «Кто этот учёный?» — те же, что в оригинале атласа (js/components/Quiz.js, ScientistsQuiz.js), — и разбор текстов
 * урока «Учёные-химики». Общие для api (вопросы строит и проверяет сервер, BR-QZ-01) и web.
 */

export const ATLAS_QUIZ_KINDS = ['elements', 'scientists'] as const;
export type AtlasQuizKind = (typeof ATLAS_QUIZ_KINDS)[number];

/** Квиз «Проверь знания» — 10 вопросов; игра про учёных — по одному вопросу на учёного, не больше 10. */
export const ATLAS_QUIZ_LENGTH = 10;

/** Без kind — квиз «Проверь знания» (так неизвестный предмет даёт 404, а не ошибку проверки — API-GEN-08). */
export const AtlasQuizStartDto = z.object({ kind: z.enum(ATLAS_QUIZ_KINDS, 'required').default('elements') });
export type AtlasQuizStartDto = z.infer<typeof AtlasQuizStartDto>;

export const AtlasQuizAnswerDto = z.object({
  optionId: z.string().trim().min(1, 'required').max(200, 'tooLong'),
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

/**
 * Загадка квиза элементов (Quiz.js): название (без учёта регистра) и символ (с учётом регистра) заменяются на «___»,
 * вступление «___ — это элемент №N…» убирается, первая буква — заглавная, точка в конце — убирается.
 */
export function maskElementText(text: string, title: string, symbol: string): string {
  let out = text;
  if (title) {
    out = out.replace(new RegExp(`(^|[^${WORD}])(${escape(title)})([^${WORD}]|$)`, 'gi'), '$1___$3');
  }
  if (symbol) {
    out = out.replace(new RegExp(`(^|[^${WORD}])(${escape(symbol)})([^${WORD}]|$)`, 'g'), '$1___$3');
  }
  out = out.replace(/^___\s*[-—–]?\s*(is|это)?\s*(element|элемент)\s*(#|№)?\s*\d+,?\s*(a\s+|an\s+)?/i, '');
  out = out.replace(/^___\s*[-—–]?\s*(is|это)?\s*(a\s+|an\s+)?/i, '');
  out = out.trim();
  if (out) out = out.charAt(0).toLocaleUpperCase() + out.slice(1);
  return out.endsWith('.') ? out.slice(0, -1) : out;
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
