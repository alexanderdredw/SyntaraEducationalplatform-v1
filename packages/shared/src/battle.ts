import { z } from 'zod';
import { Locale } from './enums';

/**
 * Итерация 10.5 «Battle» (SPEC 5.9, 6.8, 7.12): DTO и чистые правила, общие для api, worker, db и web.
 * Значения по умолчанию вопросов владельца Q-BTL-01…10 — PH-45 `battle` (app_config); набор времени и формат
 * кода закреплены также ограничениями БД (5.9).
 */

/** BR-BTL-10: лимиты Battle-теста и вопросов. */
export const BATTLE_LIMITS = {
  title: 120,
  description: 500,
  questionText: 300,
  optionText: 150,
  maxQuestions: 50,
  minOptions: 2,
  maxOptions: 4,
} as const;

/** BR-BTL-10, Q-BTL-02: время на вопрос (CHECK в 5.9) и значение по умолчанию (PH-45). */
export const BATTLE_TIME_LIMITS = [5, 10, 20, 30, 60, 90] as const;
export type BattleTimeLimit = (typeof BATTLE_TIME_LIMITS)[number];
export const BATTLE_DEFAULT_TIME_LIMIT: BattleTimeLimit = 20;

/** BR-BTL-10, Q-BTL-05: типы вопросов Battle (вписанный ответ не поддерживается). */
export const BattleQuestionType = z.enum(['single_choice', 'true_false']);
export type BattleQuestionType = z.infer<typeof BattleQuestionType>;

/** PH-45 `battle` — значения по умолчанию вопросов владельца (TODO(OWNER) Q-BTL-01…10, SPEC 7.12). */
export interface BattleConfig {
  join_scope: 'class';
  default_time_limit_sec: number;
  time_limits_sec: number[];
  late_join_default: boolean;
  xp: { enabled: boolean };
  question_types: BattleQuestionType[];
  show_question_on_student: boolean;
  display_name: 'first_name_initial';
  max_participants: number;
  leaderboard_default: boolean;
  code: { letters: string; digits: string };
}

const title = z.string().trim().min(1, 'required').max(BATTLE_LIMITS.title, 'tooLong');
const description = z.string().trim().max(BATTLE_LIMITS.description, 'tooLong');

/** API-BTL-02 */
export const BattleQuizCreateDto = z.object({
  title,
  description: description.optional(),
  locale: Locale,
});
export type BattleQuizCreateDto = z.infer<typeof BattleQuizCreateDto>;

/** API-BTL-04: изменение полей и архивирование. */
export const BattleQuizUpdateDto = z
  .object({
    title: title.optional(),
    description: description.nullable().optional(),
    locale: Locale.optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'required' });
export type BattleQuizUpdateDto = z.infer<typeof BattleQuizUpdateDto>;

/** API-BTL-01: `?archived=true` — архив. */
export const BattleListQuery = z.object({
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type BattleListQuery = z.infer<typeof BattleListQuery>;

/**
 * API-BTL-06 / API-BTL-07 (BR-BTL-10): single_choice — 2–4 варианта, ровно один правильный;
 * true_false — ровно два варианта (тексты «Верно» / «Неверно» задаёт сервер на языке теста), один правильный.
 */
export const BattleQuestionDto = z
  .object({
    type: BattleQuestionType,
    text: z.string().trim().min(1, 'required').max(BATTLE_LIMITS.questionText, 'tooLong'),
    imageMediaId: z.uuid('invalidFile').nullable().optional(),
    timeLimitSec: z
      .number()
      .int()
      .refine((v) => (BATTLE_TIME_LIMITS as readonly number[]).includes(v), 'invalidTimeLimit'),
    options: z.array(
      z.object({
        text: z.string().trim().max(BATTLE_LIMITS.optionText, 'tooLong'),
        isCorrect: z.boolean(),
      }),
    ),
  })
  .superRefine((q, ctx) => {
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.type === 'true_false') {
      if (q.options.length !== 2)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'trueFalseTwo' });
    } else {
      if (q.options.length < BATTLE_LIMITS.minOptions)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'min2' });
      if (q.options.length > BATTLE_LIMITS.maxOptions)
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'max4' });
      q.options.forEach((o, i) => {
        if (!o.text) ctx.addIssue({ code: 'custom', path: ['options', i, 'text'], message: 'required' });
      });
    }
    if (correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'exactlyOneCorrect' });
  });
export type BattleQuestionDto = z.infer<typeof BattleQuestionDto>;

/** API-BTL-09 */
export const BattleReorderDto = z.object({
  questionIds: z.array(z.uuid('required')).min(1, 'required').max(BATTLE_LIMITS.maxQuestions),
});
export type BattleReorderDto = z.infer<typeof BattleReorderDto>;

/** API-BTL-11 */
export const BattleImportDto = z.object({
  topicId: z.uuid('required'),
  questionIds: z.array(z.uuid('required')).min(1, 'required').optional(),
});
export type BattleImportDto = z.infer<typeof BattleImportDto>;

/** Настройки сессии (SPEC 7.12, таблица настроек). */
export const BattleSettings = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  leaderboard: z.boolean().default(true),
  autoAdvance: z.boolean().default(false),
  lateJoin: z.boolean().default(false),
  maxParticipants: z.number().int().min(1).max(100).default(100),
});
export type BattleSettings = z.infer<typeof BattleSettings>;

/** API-BTL-20 */
export const BattleSessionCreateDto = z.object({
  classId: z.uuid('required'),
  settings: BattleSettings.default(BattleSettings.parse({})),
});
export type BattleSessionCreateDto = z.infer<typeof BattleSessionCreateDto>;

/** API-BTL-23…28: ожидаемая версия состояния (BR-BTL-08). */
export const BattleTransitionDto = z.object({ expectedVersion: z.number().int().min(0) });
export type BattleTransitionDto = z.infer<typeof BattleTransitionDto>;

/** BR-BTL-01: формат кода сессии (CHECK в 5.9). */
export const BATTLE_CODE_RE = /^[A-Z]{3}[1-9]{3}$/;

/** BR-BTL-01: trim, удаление пробелов, верхний регистр («ktr 583» → «KTR583»). */
export function normalizeBattleCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** API-BTL-40 */
export const BattleJoinDto = z.object({
  code: z
    .string()
    .transform(normalizeBattleCode)
    .refine((v) => BATTLE_CODE_RE.test(v), 'codeNotFound'),
});
export type BattleJoinDto = z.infer<typeof BattleJoinDto>;

/** API-BTL-43 */
export const BattleAnswerDto = z.object({
  questionIndex: z.number().int().min(0),
  optionPosition: z.number().int().min(1).max(BATTLE_LIMITS.maxOptions),
  clientAnswerId: z.uuid('required'),
});
export type BattleAnswerDto = z.infer<typeof BattleAnswerDto>;

/**
 * BR-BTL-07, Q-BTL-07: имя в игре — первое слово имени из профиля и первая буква второго слова с точкой
 * («Асель Каримова» → «Асель К.»); одно слово — как есть.
 */
export function battleDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const [first = '', second] = words;
  const name = second ? `${first} ${second.charAt(0).toLocaleUpperCase('ru')}.` : first;
  return name.slice(0, 80);
}

/** BR-BTL-11: имя участника после обезличивания. */
export const BATTLE_ANONYMOUS_NAME = 'Участник';

export interface BattleScore {
  correctCount: number;
  correctTimeMs: number;
}

/**
 * BR-BTL-04: (1) правильных — по убыванию; (2) сумма времени правильных ответов — по возрастанию;
 * (3) полное равенство — одно место («1, 2, 2, 4»). Порядок равных — стабильный (как во входном массиве).
 */
export function rankBattle<T extends BattleScore>(rows: readonly T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort(
    (a, b) => b.correctCount - a.correctCount || a.correctTimeMs - b.correctTimeMs,
  );
  let rank = 0;
  return sorted.map((row, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.correctCount !== row.correctCount || prev.correctTimeMs !== row.correctTimeMs)
      rank = i + 1;
    return { ...row, rank };
  });
}

/** BR-BTL-04: итоги участника по его ответам. */
export function scoreBattleAnswers(
  answers: ReadonlyArray<{ isCorrect: boolean; responseMs: number }>,
): BattleScore & { answeredCount: number } {
  let correctCount = 0;
  let correctTimeMs = 0;
  for (const a of answers) {
    if (!a.isCorrect) continue;
    correctCount += 1;
    correctTimeMs += a.responseMs;
  }
  return { correctCount, correctTimeMs, answeredCount: answers.length };
}

/** Пьедестал — места 1–3 с учётом совпадений (BR-BTL-04). */
export const BATTLE_PODIUM_MAX_RANK = 3;

/** BR-BTL-03: запас на сеть после дедлайна. */
export const BATTLE_ANSWER_GRACE_MS = 500;
