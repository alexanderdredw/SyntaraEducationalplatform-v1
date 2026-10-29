import {
  ATLAS_OPTIONS,
  type AtlasDifficulty,
  type AtlasQuizMode,
  type ElementCandidate,
  pickElementDistractors,
  withAnswer,
} from './atlas';
import { ELEMENT_FAMILIES, type ElementFamily } from './periodic-table';

/**
 * Новые типы вопросов квиза «Проверь знания» (docs/TESTS_TZ.md, этап T2, REQ-TST-10, REQ-TST-11): чистые правила —
 * какие типы на каком уровне, чередование, данные для вопросов (оболочки и конфигурации элементов 1–60, утверждения
 * из полей таблицы). Вопросы строит и проверяет сервер (BR-QZ-01); учитель получает те же вопросы с ответом.
 */

export const ATLAS_QUESTION_TYPES = [
  'symbol-to-name',
  'name-to-symbol',
  'fact-true-false',
  'description',
  'bohr',
  'table-click',
  'config',
  'fun-fact',
  'type-symbol',
] as const;
export type AtlasQuestionType = (typeof ATLAS_QUESTION_TYPES)[number];

/** REQ-TST-10: набор типов определяется текущим уровнем (1 — лёгкий, 2 — средний, 3 — сложный). */
export const LEVEL_QUESTION_TYPES: Record<1 | 2 | 3, readonly AtlasQuestionType[]> = {
  1: ['symbol-to-name', 'name-to-symbol', 'fact-true-false', 'bohr'],
  2: ['fact-true-false', 'description', 'bohr', 'table-click'],
  3: ['table-click', 'config', 'fun-fact', 'type-symbol'],
};

/** Как отвечают на вопрос: выбор варианта, «Верно/Неверно», ввод, клик по ячейке таблицы. */
export type AtlasAnswerKind = 'choice' | 'boolean' | 'input' | 'table';

export function answerKind(type: AtlasQuestionType): AtlasAnswerKind {
  if (type === 'fact-true-false') return 'boolean';
  if (type === 'type-symbol') return 'input';
  if (type === 'table-click') return 'table';
  return 'choice';
}

/** «По семейству» — только семейства, в которых не меньше 4 элементов с уроками. */
export const FAMILY_MODE_MIN = 4;
/** «Работа над ошибками» — ошибки последних 5 завершённых попыток квиза. */
export const MISTAKES_MODE_SESSIONS = 5;

/** Семейства для режима «По семейству»: ≥ 4 элементов с уроками, в порядке ELEMENT_FAMILIES. */
export function familiesWithLessons(families: readonly string[]): ElementFamily[] {
  const count = new Map<string, number>();
  for (const f of families) count.set(f, (count.get(f) ?? 0) + 1);
  return ELEMENT_FAMILIES.filter((f) => (count.get(f) ?? 0) >= FAMILY_MODE_MIN);
}

/**
 * REQ-TST-10.1: тип следующего вопроса — из набора уровня (в «Таблице-челлендже» — только `table-click`), без
 * третьего одинакового подряд; `available` — тип возможен для этого элемента (есть текст, группа и т. п.).
 */
export function pickQuestionType(
  level: number,
  mode: AtlasQuizMode,
  recent: readonly AtlasQuestionType[],
  available: (type: AtlasQuestionType) => boolean,
  random: (k: number) => number,
): AtlasQuestionType | null {
  if (mode === 'table') return available('table-click') ? 'table-click' : null;
  const set = LEVEL_QUESTION_TYPES[Math.min(3, Math.max(1, level)) as 1 | 2 | 3].filter(available);
  const [a, b] = recent.slice(-2);
  const repeated = a !== undefined && a === b ? a : null;
  const candidates = set.filter((t) => t !== repeated);
  const list = candidates.length ? candidates : set;
  return list.length ? list[random(list.length)]! : null;
}

/** Не больше двух одинаковых типов подряд (REQ-TST-10.1) — проверка последовательности. */
export function alternates(types: readonly string[]): boolean {
  return types.every((t, i) => i < 2 || t !== types[i - 1] || t !== types[i - 2]);
}

/* ---------- Оболочки и конфигурации (элементы 1–60) ---------- */

/**
 * Электроны по оболочкам K, L, M, N, O, P в основном состоянии — те же данные, что у схем атомов уроков
 * (scripts/content-art/atoms.mjs). Схема Бора в квизе — по ним, без символа (REQ-TST-10.2).
 */
// prettier-ignore
export const ELECTRON_SHELLS: Readonly<Record<number, readonly number[]>> = {
  1: [1], 2: [2], 3: [2, 1], 4: [2, 2], 5: [2, 3], 6: [2, 4], 7: [2, 5], 8: [2, 6], 9: [2, 7], 10: [2, 8],
  11: [2, 8, 1], 12: [2, 8, 2], 13: [2, 8, 3], 14: [2, 8, 4], 15: [2, 8, 5], 16: [2, 8, 6], 17: [2, 8, 7],
  18: [2, 8, 8], 19: [2, 8, 8, 1], 20: [2, 8, 8, 2], 21: [2, 8, 9, 2], 22: [2, 8, 10, 2], 23: [2, 8, 11, 2],
  24: [2, 8, 13, 1], 25: [2, 8, 13, 2], 26: [2, 8, 14, 2], 27: [2, 8, 15, 2], 28: [2, 8, 16, 2], 29: [2, 8, 18, 1],
  30: [2, 8, 18, 2], 31: [2, 8, 18, 3], 32: [2, 8, 18, 4], 33: [2, 8, 18, 5], 34: [2, 8, 18, 6], 35: [2, 8, 18, 7],
  36: [2, 8, 18, 8], 37: [2, 8, 18, 8, 1], 38: [2, 8, 18, 8, 2], 39: [2, 8, 18, 9, 2], 40: [2, 8, 18, 10, 2],
  41: [2, 8, 18, 12, 1], 42: [2, 8, 18, 13, 1], 43: [2, 8, 18, 13, 2], 44: [2, 8, 18, 15, 1], 45: [2, 8, 18, 16, 1],
  46: [2, 8, 18, 18], 47: [2, 8, 18, 18, 1], 48: [2, 8, 18, 18, 2], 49: [2, 8, 18, 18, 3], 50: [2, 8, 18, 18, 4],
  51: [2, 8, 18, 18, 5], 52: [2, 8, 18, 18, 6], 53: [2, 8, 18, 18, 7], 54: [2, 8, 18, 18, 8],
  55: [2, 8, 18, 18, 8, 1], 56: [2, 8, 18, 18, 8, 2], 57: [2, 8, 18, 18, 9, 2], 58: [2, 8, 18, 19, 9, 2],
  59: [2, 8, 18, 21, 8, 2], 60: [2, 8, 18, 22, 8, 2],
};

/** Порядок заполнения подуровней (правило Клечковского) до 6p — хватает для элементов 1–60. */
const ORDER = [
  '1s',
  '2s',
  '2p',
  '3s',
  '3p',
  '4s',
  '3d',
  '4p',
  '5s',
  '4d',
  '5p',
  '6s',
  '4f',
  '5d',
  '6p',
] as const;
const CAPACITY: Record<string, number> = { s: 2, p: 6, d: 10, f: 14 };
/** Исключения основного состояния (элементы 1–60): переход электрона s → d или f-элементы с 5d¹. */
const EXCEPTIONS: Record<number, Record<string, number>> = {
  24: { '3d': 5, '4s': 1 },
  29: { '3d': 10, '4s': 1 },
  41: { '4d': 4, '5s': 1 },
  42: { '4d': 5, '5s': 1 },
  44: { '4d': 7, '5s': 1 },
  45: { '4d': 8, '5s': 1 },
  46: { '4d': 10, '5s': 0 },
  47: { '4d': 10, '5s': 1 },
  57: { '4f': 0, '5d': 1, '6s': 2 },
  58: { '4f': 1, '5d': 1, '6s': 2 },
};
const CORES: Array<[number, string]> = [
  [54, 'Xe'],
  [36, 'Kr'],
  [18, 'Ar'],
  [10, 'Ne'],
  [2, 'He'],
];
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('');
const L = 'spdf';

/** Заполнение подуровней атома с номером `number` (основное состояние). */
function subshells(number: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = number;
  for (const s of ORDER) {
    if (left <= 0) break;
    const n = Math.min(left, CAPACITY[s[1]!]!);
    out.set(s, n);
    left -= n;
  }
  for (const [s, n] of Object.entries(EXCEPTIONS[number] ?? {})) {
    if (n) out.set(s, n);
    else out.delete(s);
  }
  return out;
}

const bySubshell = (a: string, b: string) =>
  Number(a[0]) - Number(b[0]) || L.indexOf(a[1]!) - L.indexOf(b[1]!);

/** Электронная конфигурация с остовом благородного газа: «[Ne] 3s¹», «[Ar] 3d⁶ 4s²»; H и He — полностью. */
export function electronConfig(number: number): string {
  const all = subshells(number);
  const [core, symbol] = CORES.find(([z]) => z < number) ?? [0, ''];
  const inCore = core ? subshells(core) : new Map<string, number>();
  const rest = [...all]
    .filter(([s]) => !inCore.has(s))
    .sort(([a], [b]) => bySubshell(a, b))
    .map(([s, n]) => `${s}${sup(n)}`);
  return [symbol ? `[${symbol}]` : '', ...rest].filter(Boolean).join(' ');
}

/** Электроны по оболочкам, посчитанные из конфигурации (проверка согласованности с ELECTRON_SHELLS). */
export function shellsFromConfig(number: number): number[] {
  const shells: number[] = [];
  for (const [s, n] of subshells(number)) shells[Number(s[0]) - 1] = (shells[Number(s[0]) - 1] ?? 0) + n;
  return shells.map((n) => n ?? 0);
}

/* ---------- Данные вопроса ---------- */

/** Элемент-кандидат с символом (вопросы и варианты строятся из 60 элементов с уроками). */
export interface QuizElement extends ElementCandidate {
  symbol: string;
}

/**
 * REQ-TST-10.4: утверждение «Верно/Неверно» — только из полей данных: семейство, период, группа, атомный номер
 * (агрегатного состояния в данных нет).
 */
export type AtlasFact =
  | { kind: 'family'; family: ElementFamily }
  | { kind: 'period'; period: number }
  | { kind: 'group'; group: number }
  | { kind: 'number'; other: string };

/** Вариант вопроса там, где у типа два вида: схема Бора, таблица. */
export type AtlasQuestionVariant = 'count' | 'element' | 'name' | 'cell';

/** Вопрос, как его хранит сессия: правильный ответ — `answer` (id варианта, 'true'/'false', символ). */
export interface AtlasQuestionSpec {
  type: AtlasQuestionType;
  item: string;
  options: string[];
  answer: string;
  variant?: AtlasQuestionVariant;
  fact?: AtlasFact;
}

const MAX_PERIOD = 6;
const MAX_GROUP = 18;

/** Другое значение из 1…max, не равное `value`. */
function otherValue(value: number, max: number, random: (k: number) => number): number {
  const v = 1 + random(max - 1);
  return v >= value ? v + 1 : v;
}

/** Утверждение и его истинность (≈ половина верных). */
export function makeFact(
  item: QuizElement,
  pool: readonly QuizElement[],
  random: (k: number) => number,
): { fact: AtlasFact; truth: boolean } {
  const kinds: AtlasFact['kind'][] = [
    'family',
    'period',
    'number',
    ...(item.group ? ['group' as const] : []),
  ];
  const kind = kinds[random(kinds.length)]!;
  const truth = random(2) === 0;
  if (kind === 'number') {
    const others = pool.filter((p) => p.id !== item.id);
    const other = others[random(others.length)]!;
    return { fact: { kind, other: other.id }, truth: item.number > other.number };
  }
  if (kind === 'family') {
    const families = [...new Set(pool.map((p) => p.family))].filter((f) => f !== item.family);
    const family = truth || !families.length ? item.family : families[random(families.length)]!;
    return { fact: { kind, family: family as ElementFamily }, truth: family === item.family };
  }
  if (kind === 'period') {
    const period = truth ? item.period : otherValue(item.period, MAX_PERIOD, random);
    return { fact: { kind, period }, truth };
  }
  const group = truth ? item.group! : otherValue(item.group!, MAX_GROUP, random);
  return { fact: { kind, group }, truth };
}

/** «Сколько электронов у этого атома?» — верное число и три соседних (≥ 1), на случайных позициях. */
export function electronCountOptions(number: number, random: (k: number) => number): string[] {
  const near = [-3, -2, -1, 1, 2, 3].map((d) => number + d).filter((n) => n >= 1);
  const chosen: number[] = [];
  while (chosen.length < ATLAS_OPTIONS - 1) chosen.push(near.splice(random(near.length), 1)[0]!);
  return withAnswer(String(number), chosen.map(String), random);
}

/**
 * Можно ли задать вопрос этого типа про элемент: описание и факт — если текст удаётся замаскировать (BR-TST-03),
 * конфигурация и схема Бора — элементы 1–60.
 */
export function typeAvailable(
  type: AtlasQuestionType,
  item: QuizElement,
  texts: { description: boolean; funFact: boolean },
): boolean {
  if (type === 'description') return texts.description;
  if (type === 'fun-fact') return texts.funFact;
  if (type === 'bohr' || type === 'config') return Boolean(ELECTRON_SHELLS[item.number]);
  return true;
}

const difficultyOf = (level: number): AtlasDifficulty =>
  level <= 1 ? 'easy' : level === 2 ? 'medium' : 'hard';

/**
 * Вопрос типа `type` про элемент `item`: варианты (всегда 4 у выбора — BR-TST-02), правильный ответ, вид. Схема Бора
 * на лёгком — «Сколько электронов?», иначе — «Какой это элемент?»; таблица на сложном — по периоду и группе (если
 * у элемента есть группа), иначе — по названию.
 */
export function buildQuestion(
  type: AtlasQuestionType,
  item: QuizElement,
  pool: readonly QuizElement[],
  level: number,
  random: (k: number) => number,
): AtlasQuestionSpec {
  const elementOptions = () =>
    withAnswer(item.id, pickElementDistractors(item, [...pool], difficultyOf(level), random), random);
  switch (type) {
    case 'fact-true-false': {
      const { fact, truth } = makeFact(item, pool, random);
      return { type, item: item.id, options: ['true', 'false'], answer: truth ? 'true' : 'false', fact };
    }
    case 'bohr':
      if (level <= 1) {
        const options = electronCountOptions(item.number, random);
        return { type, item: item.id, options, answer: String(item.number), variant: 'count' };
      }
      return { type, item: item.id, options: elementOptions(), answer: item.id, variant: 'element' };
    case 'table-click':
      return {
        type,
        item: item.id,
        options: [],
        answer: item.id,
        variant: level >= 3 && item.group ? 'cell' : 'name',
      };
    case 'type-symbol':
      return { type, item: item.id, options: [], answer: item.symbol };
    default:
      return { type, item: item.id, options: elementOptions(), answer: item.id };
  }
}

/**
 * «Впишите символ» (REQ-TST-10): сравнение с учётом регистра; совпадение без учёта регистра («ca» вместо «Ca») —
 * неверно, но с подсказкой «Обратите внимание на заглавную букву».
 */
export function checkSymbol(input: string, symbol: string): 'correct' | 'case' | 'wrong' {
  const value = input.trim();
  if (value === symbol) return 'correct';
  return value.toLocaleLowerCase('en') === symbol.toLocaleLowerCase('en') ? 'case' : 'wrong';
}

/**
 * «50/50» для `table-click` (REQ-TST-10.3): подсветить 2 периода — верный и случайный другой (из периодов, где есть
 * элементы с уроками), по возрастанию.
 */
export function tableHintPeriods(
  period: number,
  periods: readonly number[],
  random: (k: number) => number,
): number[] {
  const others = [...new Set(periods)].filter((p) => p !== period);
  const other = others.length ? others[random(others.length)]! : otherValue(period, MAX_PERIOD, random);
  return [period, other].sort((a, b) => a - b);
}
