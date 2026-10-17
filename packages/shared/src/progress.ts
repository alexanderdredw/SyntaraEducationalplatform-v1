import { z } from 'zod';

/**
 * Итерация 10: задания, показатели, аналитика — DTO и чистые правила (7.4–7.6), общие для api и web.
 * Числа — заглушки PH-30, PH-38 (значения берутся из app_config, здесь — типы и формулы).
 */

/** API-T-22: назначение темы классу (BR-ASG-01). Срок — момент времени (ISO 8601 с часовым поясом). */
export const AssignmentCreateDto = z.object({
  classId: z.uuid('required'),
  subjectId: z.uuid('required'),
  topicId: z.uuid('required'),
  dueAt: z.iso.datetime({ offset: true, error: 'invalidDate' }),
});
export type AssignmentCreateDto = z.infer<typeof AssignmentCreateDto>;

/** API-S-07: попытка в контексте назначения (решение по Q-18 — необязательное поле тела). */
export const AttemptStartDto = z.object({ assignmentId: z.uuid('required').optional() }).default({});
export type AttemptStartDto = z.infer<typeof AttemptStartDto>;

/** BR-ST-04 / REQ-ST-PRG-01: периоды «Мои показатели». */
export const PROGRESS_PERIODS = ['today', '7d', '30d', '90d', 'quarter', 'year'] as const;
export const ProgressPeriod = z.enum(PROGRESS_PERIODS);
export type ProgressPeriod = z.infer<typeof ProgressPeriod>;

/** PH-38 `progress`. Четверть — `{from, to}` в формате YYYY-MM-DD. */
export interface ProgressConfig {
  mastery_threshold: number;
  school_year: { from: string; to: string };
  quarters: Array<{ from: string; to: string }>;
}

/** Диапазон календарных дней (YYYY-MM-DD, включительно) в PLATFORM_TZ (BR-ST-01). */
export interface DayRange {
  from: string;
  to: string;
}

const DAY = 86_400_000;
const toNum = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);
const toDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => toDay(toNum(day) + n);
export const daysBetween = (from: string, to: string) => toNum(to) - toNum(from);

/**
 * BR-ST-04: границы периода на дату `today` (уже в PLATFORM_TZ). today; 7d/30d/90d — последние N дней включая
 * сегодня; quarter — текущая четверть из конфигурации (нет четвертей или сегодня вне них — null, Q-23);
 * year — учебный год `school_year` (по умолчанию 01.09–31.05), который начался последним.
 * compare — предыдущий период той же длины (для года — предыдущий учебный год).
 */
export function periodRanges(
  period: ProgressPeriod,
  today: string,
  config: Pick<ProgressConfig, 'school_year' | 'quarters'>,
): { range: DayRange; compare: DayRange } | null {
  const lastDays = (n: number) => {
    const range = { from: addDays(today, -(n - 1)), to: today };
    return { range, compare: { from: addDays(range.from, -n), to: addDays(range.from, -1) } };
  };
  switch (period) {
    case 'today':
      return lastDays(1);
    case '7d':
      return lastDays(7);
    case '30d':
      return lastDays(30);
    case '90d':
      return lastDays(90);
    case 'quarter': {
      const current = config.quarters.find((q) => q.from <= today && today <= q.to);
      if (!current) return null;
      const length = daysBetween(current.from, current.to) + 1;
      return {
        range: current,
        compare: { from: addDays(current.from, -length), to: addDays(current.from, -1) },
      };
    }
    case 'year': {
      const year = Number(today.slice(0, 4));
      const startsThisYear = today.slice(5) >= config.school_year.from;
      const startYear = startsThisYear ? year : year - 1;
      const range = {
        from: `${startYear}-${config.school_year.from}`,
        to: `${startYear + 1}-${config.school_year.to}`,
      };
      const compare = {
        from: `${startYear - 1}-${config.school_year.from}`,
        to: `${startYear}-${config.school_year.to}`,
      };
      return { range, compare };
    }
  }
}

/** PH-30 `analytics`. */
export interface AnalyticsConfig {
  red_below: number;
  green_from: number;
  max_rows: number;
  inactive_days: number;
}

export type TopicColor = 'red' | 'blue' | 'green';

/** BR-AN-04: percent < 50 → red; 50 ≤ percent < 80 → blue; ≥ 80 → green (пороги PH-30). */
export function topicColor(
  percent: number,
  config: Pick<AnalyticsConfig, 'red_below' | 'green_from'>,
): TopicColor {
  if (percent < config.red_below) return 'red';
  if (percent < config.green_from) return 'blue';
  return 'green';
}

/** BR-ST-05: percent = round(100 * mastered / total, 1); нет тем — 0. */
export function progressPercent(mastered: number, total: number): number {
  return total > 0 ? Math.round((1000 * mastered) / total) / 10 : 0;
}
