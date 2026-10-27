import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { localDate, STREAK_EVENTS } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';

const { learningEvents } = schema;
/** Те же события, что серия (BR-ST-02). */
const ACTIVITY_EVENTS = [...STREAK_EVENTS];
const DAY_MS = 86_400_000;

export interface ActivityDay {
  date: string;
  count: number;
}

/** День YYYY-MM-DD ± n дней (календарная арифметика без часовых поясов). */
const shift = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Понедельник недели дня (Пн = 0 … Вс = 6). */
const mondayOf = (day: string) => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * API-ME-15 (REQ-PRF-21): календарь активности ученика — события `lesson_opened` + `quiz_finished` по дням в часовом
 * поясе платформы за `weeks` недель (с понедельника первой недели по сегодня). Только свои данные.
 */
@Injectable()
export class ActivityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async activity(studentId: string, weeks: number, now = new Date()) {
    const tz = this.env.PLATFORM_TZ;
    const today = localDate(now, tz);
    const from = shift(mondayOf(today), -7 * (weeks - 1));
    // С запасом в сутки — граница дня считается в часовом поясе платформы ниже.
    const since = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS);
    const day = sql<string>`to_char(${learningEvents.occurredAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ date: day, count: sql<number>`count(*)::int` })
      .from(learningEvents)
      .where(
        and(
          eq(learningEvents.studentId, studentId),
          inArray(learningEvents.type, ACTIVITY_EVENTS),
          gte(learningEvents.occurredAt, since),
        ),
      )
      // Группировка по номеру столбца: часовой пояс — параметр запроса, в GROUP BY он был бы другим параметром.
      .groupBy(sql`1`);
    const counts = new Map(rows.map((r) => [r.date, Number(r.count)]));
    const days: ActivityDay[] = [];
    for (let d = from; d <= today; d = shift(d, 1)) days.push({ date: d, count: counts.get(d) ?? 0 });
    let longest = 0;
    let run = 0;
    for (const d of days) {
      run = d.count > 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return {
      from,
      to: today,
      days,
      activeDays: days.filter((d) => d.count > 0).length,
      longestStreak: longest,
    };
  }
}
