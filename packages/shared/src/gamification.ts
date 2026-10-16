import { z } from 'zod';

/**
 * Итерация 8: квиз и геймификация — чистые правила (7.2–7.4), общие для api и worker.
 * Числа — заглушки PH-28, PH-38, PH-39 (значения берутся из app_config, здесь — типы и формулы).
 */

/**
 * PH-38 `progress.mastery_threshold` — порог освоения темы (BR-QZ-07). Значение из seed; сервер берёт его из
 * app_config, интерфейс — для текста результата квиза.
 */
export const MASTERY_THRESHOLD = 80;

/** PH-39 `xp` */
export interface XpConfig {
  quiz_finished: number;
  high_score_bonus: number;
  high_score_threshold: number;
  first_lesson_open: number;
  per_level: number;
  failed_attempt_below: number;
}

/** BR-QZ-03, PH-28: trim, схлопнуть пробелы, нижний регистр. */
export function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}

/** BR-QZ-05: round(100 * correct / count, 2). */
export function scorePercent(correct: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round((10000 * correct) / count) / 100;
}

/** BR-XP-03: level = floor(xp / 100) + 1; xpToNext = 100 * level − xp. */
export function levelOf(xpTotal: number, perLevel = 100): { level: number; xpToNext: number } {
  const level = Math.floor(Math.max(0, xpTotal) / perLevel) + 1;
  return { level, xpToNext: perLevel * level - xpTotal };
}

/** Календарный день (YYYY-MM-DD) момента в часовом поясе платформы (BR-ST-01, PH-42). */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * BR-ST-02/03: серия — число подряд идущих дней активности, заканчивающихся сегодня или вчера; иначе 0.
 * `best` — самая длинная серия за всё время.
 */
export function streakOf(activityDays: Iterable<string>, today: string): { current: number; best: number } {
  const days = [...new Set(activityDays)].map(dayNumber).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i]! - days[i - 1]! === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const last = days.at(-1);
  const t = dayNumber(today);
  const current = last !== undefined && t - last <= 1 ? run : 0;
  return { current, best };
}

/** Правило бейджа (badges.rule, BR-BDG-01) — как в seed. */
export const BadgeRule = z.union([
  z.object({ event: z.literal('quiz_finished'), count: z.number().int().positive() }),
  z.object({ streak: z.number().int().positive() }),
  z.object({ masteredTopics: z.number().int().positive() }),
  z.object({ subjectAllTopicsMastered: z.literal(true) }),
  z.object({ level: z.number().int().positive() }),
  z.object({ comebackTopics: z.number().int().positive(), failedBelowPercent: z.number().positive() }),
]);
export type BadgeRule = z.infer<typeof BadgeRule>;

/** Факты об ученике для правил бейджей. */
export interface BadgeFacts {
  quizFinished: number;
  streak: number;
  masteredTopics: number;
  /** Хотя бы один предмет, все опубликованные темы которого освоены. */
  subjectConquered: boolean;
  level: number;
  /** Освоенные темы, у которых раньше была неудачная попытка (< failed_attempt_below, PH-39). */
  comebackTopics: number;
}

/** BR-BDG-01: выполнено ли правило. Неизвестное правило — не выдаётся. */
export function badgeEarned(rule: unknown, facts: BadgeFacts): boolean {
  const parsed = BadgeRule.safeParse(rule);
  if (!parsed.success) return false;
  const r = parsed.data;
  if ('event' in r) return facts.quizFinished >= r.count;
  if ('streak' in r) return facts.streak >= r.streak;
  if ('masteredTopics' in r) return facts.masteredTopics >= r.masteredTopics;
  if ('subjectAllTopicsMastered' in r) return facts.subjectConquered;
  if ('level' in r) return facts.level >= r.level;
  return facts.comebackTopics >= r.comebackTopics;
}

/** API-S-17: ключ события открытия урока — `lesson:{topicId}:{YYYY-MM-DD}` (REQ-ST-LES-04). */
export const LessonEventDto = z.object({
  type: z.literal('lesson_opened', 'required'),
  topicId: z.uuid('required'),
  idempotencyKey: z
    .string()
    .regex(/^lesson:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/i, 'invalidKey')
    .max(100),
});
export type LessonEventDto = z.infer<typeof LessonEventDto>;

/** API-S-08: выбранный вариант или вписанный ответ. */
export const AnswerDto = z
  .object({
    questionId: z.uuid('required'),
    optionId: z.uuid('required').optional(),
    textAnswer: z.string().max(300, 'tooLong').optional(),
  })
  .refine((a) => Boolean(a.optionId) !== (a.textAnswer !== undefined), {
    message: 'required',
    path: ['optionId'],
  });
export type AnswerDto = z.infer<typeof AnswerDto>;
