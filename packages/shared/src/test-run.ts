import { z } from 'zod';

/**
 * Общие правила прохождения тестов (docs/TESTS_TZ.md, этап T1): тест темы любого предмета, тест элемента и учёных
 * атласа, квиз «Проверь знания», игра «Кто этот учёный?». Подсказка «50/50» (REQ-TST-04, BR-TST-01), вес верного
 * ответа с подсказкой для XP, серия верных ответов (REQ-TST-02). Общие для api (подсказку выбирает и записывает
 * сервер) и web.
 */

/** REQ-TST-04: не больше одной подсказки на вопрос и трёх на попытку; только у вопросов с 4 и более вариантами. */
export const HINT_LIMIT = 3;
export const HINT_MIN_OPTIONS = 4;
/** Сколько неверных вариантов убирает «50/50». */
export const HINT_REMOVES = 2;
/** BR-TST-01: вес верного ответа с подсказкой для XP. */
export const HINT_WEIGHT = 0.5;

/** API-S-28: подсказка к вопросу теста темы. */
export const HintDto = z.object({ questionId: z.uuid('required') });
export type HintDto = z.infer<typeof HintDto>;

/**
 * Какие варианты убрать (BR-TST-01): два случайных неверных. `random(n)` — целое из [0, n); на сервере —
 * криптографический генератор.
 */
export function pickHintRemovals(
  optionIds: string[],
  correctId: string,
  random: (n: number) => number,
): string[] {
  const wrong = optionIds.filter((id) => id !== correctId);
  const out: string[] = [];
  while (out.length < HINT_REMOVES && wrong.length) out.push(wrong.splice(random(wrong.length), 1)[0]!);
  return out;
}

/** Можно ли взять подсказку к вопросу: выбор варианта (не «Верно/Неверно» и не ввод), 4+ варианта, лимит не исчерпан. */
export function hintAllowed(type: string, optionCount: number, used: number): boolean {
  return type === 'single_choice' && optionCount >= HINT_MIN_OPTIONS && used < HINT_LIMIT;
}

export interface WeightedAnswer {
  correct: boolean;
  hinted: boolean;
}

/** Сумма весов верных ответов (BR-TST-01): без подсказки — 1, с подсказкой — 0,5. */
export function weightedCorrect(answers: WeightedAnswer[]): number {
  return answers.reduce((sum, a) => sum + (a.correct ? (a.hinted ? HINT_WEIGHT : 1) : 0), 0);
}

/**
 * Тест темы (BR-TST-01, BR-XP-01): процент для XP — 100 × (верные_без_подсказки + 0,5 × верные_с_подсказкой) / всего,
 * два знака, как score_percent (BR-QZ-05). XP = round(20 × процент / 100) — topicQuizXp.
 */
export function xpPercent(answers: WeightedAnswer[], total: number): number {
  if (total <= 0) return 0;
  return Math.round((10000 * weightedCorrect(answers)) / total) / 100;
}

/** Квиз и игра атласа (BR-TST-01, BR-XP-05): засчитываемое число ответов — floor(сумма весов). */
export function atlasCredit(answers: WeightedAnswer[]): number {
  return Math.floor(weightedCorrect(answers) + 1e-9);
}

/** REQ-TST-02.2: верные ответы подряд в конце списка (счётчик серии показывается от 2). */
export function answerStreak(answers: Array<{ correct: boolean }>): number {
  let n = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i]!.correct; i--) n++;
  return n;
}

/** REQ-TST-02.1: состояние деления полосы прогресса. */
export type SegmentState = 'correct' | 'hinted' | 'wrong' | 'current' | 'todo';

export function segmentState(answer: WeightedAnswer | undefined, current: boolean): SegmentState {
  if (answer) return answer.correct ? (answer.hinted ? 'hinted' : 'correct') : 'wrong';
  return current ? 'current' : 'todo';
}

/** REQ-TST-05.2: «+Y к прошлой попытке» — разница в целых процентах (null — прошлой попытки не было). */
export function percentDelta(percent: number, previous: number | null): number | null {
  return previous === null ? null : Math.round(percent) - Math.round(previous);
}
