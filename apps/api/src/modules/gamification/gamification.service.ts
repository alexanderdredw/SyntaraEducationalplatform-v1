import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNotNull, isNull, sql, sum } from 'drizzle-orm';
import { badgeEarned, type Locale, localDate, levelOf, streakOf, type XpConfig } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { type Tx } from '../../common/idempotency';
import { pickTranslation } from '../../common/locale';
import { AppConfigService } from '../../config/app-config.service';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';

const { learningEvents: ev, xpLedger, studentStats, studentBadges, badges, badgeTranslations } = schema;
const { topicMastery, quizAttempts, quizzes, topics } = schema;

export interface LearningEvent {
  id: string;
  studentId: string;
  type: 'lesson_opened' | 'quiz_finished' | 'topic_mastered' | 'ai_question';
  topicId: string | null;
  idempotencyKey: string;
}

export interface AwardedBadge {
  code: string;
  title: string;
}

export interface ProcessResult {
  xpAwarded: number;
  badgesAwarded: AwardedBadge[];
}

/** Ключ события завершения квиза: `quiz:{attemptId}` — по нему находится балл попытки (BR-XP-01). */
export const quizEventKey = (attemptId: string) => `quiz:${attemptId}`;

/**
 * Геймификация (7.3–7.4, PH-39): событие → записи xp_ledger (уникальны по student, event, reason — BR-XP-02),
 * пересчёт student_stats (XP, уровень BR-XP-03, серия BR-ST-02/03 в PLATFORM_TZ) и бейджи по правилам
 * badges.rule (BR-BDG-01), каждый — один раз (BR-BDG-02). Повторная обработка того же события ничего не
 * начисляет (AC-ST-05). Выполняется в транзакции вызывающего кода — ответ finish сразу содержит XP и бейджи.
 */
@Injectable()
export class GamificationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly config: AppConfigService,
  ) {}

  async process(tx: Tx, event: LearningEvent, locale: Locale): Promise<ProcessResult> {
    const xp = await this.config.get<XpConfig>('xp');
    const awards: Array<{ reason: string; amount: number }> = [];
    if (event.type === 'quiz_finished') {
      awards.push({ reason: 'quiz_finished', amount: xp.quiz_finished });
      const attemptId = event.idempotencyKey.replace(/^quiz:/, '');
      const [attempt] = await tx
        .select({ score: quizAttempts.scorePercent })
        .from(quizAttempts)
        .where(eq(quizAttempts.id, attemptId));
      if (attempt?.score !== null && Number(attempt?.score) >= xp.high_score_threshold) {
        awards.push({ reason: 'quiz_high_score', amount: xp.high_score_bonus });
      }
    }
    if (event.type === 'lesson_opened' && event.topicId) {
      // «Первое открытие темы»: это событие — самое раннее открытие темы учеником.
      const [first] = await tx
        .select({ id: ev.id })
        .from(ev)
        .where(
          and(eq(ev.studentId, event.studentId), eq(ev.type, 'lesson_opened'), eq(ev.topicId, event.topicId)),
        )
        .orderBy(ev.occurredAt, ev.id)
        .limit(1);
      if (first?.id === event.id) awards.push({ reason: 'lesson_first_open', amount: xp.first_lesson_open });
    }

    let xpAwarded = 0;
    for (const award of awards) {
      const inserted = await tx
        .insert(xpLedger)
        .values({
          studentId: event.studentId,
          amount: award.amount,
          reason: award.reason,
          sourceEventId: event.id,
        })
        .onConflictDoNothing({ target: [xpLedger.studentId, xpLedger.sourceEventId, xpLedger.reason] })
        .returning({ amount: xpLedger.amount });
      xpAwarded += inserted[0]?.amount ?? 0;
    }

    const stats = await this.recalcStats(tx, event.studentId, xp.per_level);
    const badgesAwarded = await this.awardBadges(tx, event, stats, xp.failed_attempt_below, locale);
    return { xpAwarded, badgesAwarded };
  }

  /** student_stats из журнала XP и событий (источник правды — xp_ledger и learning_events). */
  async recalcStats(
    tx: Tx | Database,
    studentId: string,
    perLevel = 100,
  ): Promise<{ xpTotal: number; level: number; streak: number }> {
    const [xpRow] = await tx
      .select({ total: sum(xpLedger.amount) })
      .from(xpLedger)
      .where(eq(xpLedger.studentId, studentId));
    const xpTotal = Number(xpRow?.total ?? 0);
    const { level } = levelOf(xpTotal, perLevel);
    const tz = this.env.PLATFORM_TZ;
    const days = await tx
      .selectDistinct({
        day: sql<string>`to_char((${ev.occurredAt} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
      })
      .from(ev)
      .where(and(eq(ev.studentId, studentId), inArray(ev.type, ['lesson_opened', 'quiz_finished'])));
    const dayList = days.map((d) => d.day);
    const streak = streakOf(dayList, localDate(new Date(), tz));
    const lastActivityDate = dayList.length ? [...dayList].sort().at(-1)! : null;
    const values = {
      xpTotal,
      level,
      streakCurrent: streak.current,
      streakBest: streak.best,
      lastActivityDate,
    };
    await tx
      .insert(studentStats)
      .values({ studentId, ...values })
      .onConflictDoUpdate({ target: studentStats.studentId, set: values });
    return { xpTotal, level, streak: streak.current };
  }

  private async awardBadges(
    tx: Tx,
    event: LearningEvent,
    stats: { level: number; streak: number },
    failedBelow: number,
    locale: Locale,
  ): Promise<AwardedBadge[]> {
    const studentId = event.studentId;
    const candidates = await tx
      .select({ id: badges.id, code: badges.code, rule: badges.rule })
      .from(badges)
      .leftJoin(
        studentBadges,
        and(eq(studentBadges.badgeId, badges.id), eq(studentBadges.studentId, studentId)),
      )
      .where(and(eq(badges.isActive, true), isNull(studentBadges.badgeId)))
      .orderBy(badges.position);
    if (candidates.length === 0) return [];

    const [[quizRow], [masteredRow], conquered, [comebackRow]] = await Promise.all([
      tx
        .select({ n: count() })
        .from(ev)
        .where(and(eq(ev.studentId, studentId), eq(ev.type, 'quiz_finished'))),
      tx
        .select({ n: count() })
        .from(topicMastery)
        .where(and(eq(topicMastery.studentId, studentId), isNotNull(topicMastery.masteredAt))),
      // Предмет покорён: у предмета есть опубликованные темы, и все они освоены учеником.
      tx.execute(sql`
        SELECT 1 FROM ${topics} t
        WHERE t.status = 'published' AND t.archived_at IS NULL
        GROUP BY t.subject_id
        HAVING bool_and(EXISTS (SELECT 1 FROM ${topicMastery} m
          WHERE m.topic_id = t.id AND m.student_id = ${studentId} AND m.mastered_at IS NOT NULL))
        LIMIT 1`),
      // Исправился: тема освоена после попытки ниже порога неудачи (PH-39).
      tx
        .select({ n: count() })
        .from(topicMastery)
        .where(
          and(
            eq(topicMastery.studentId, studentId),
            isNotNull(topicMastery.masteredAt),
            sql`EXISTS (SELECT 1 FROM ${quizAttempts} a JOIN ${quizzes} q ON q.id = a.quiz_id
              WHERE q.topic_id = ${topicMastery.topicId} AND a.student_id = ${studentId}
                AND a.status = 'finished' AND a.score_percent < ${failedBelow}
                AND a.finished_at <= ${topicMastery.masteredAt})`,
          ),
        ),
    ]);
    const facts = {
      quizFinished: Number(quizRow?.n ?? 0),
      streak: stats.streak,
      masteredTopics: Number(masteredRow?.n ?? 0),
      subjectConquered: (conquered as unknown as { length: number }).length > 0,
      level: stats.level,
      comebackTopics: Number(comebackRow?.n ?? 0),
    };

    const earned = candidates.filter((b) => badgeEarned(b.rule, facts));
    const awarded: string[] = [];
    for (const badge of earned) {
      const inserted = await tx
        .insert(studentBadges)
        .values({ studentId, badgeId: badge.id, sourceEventId: event.id })
        .onConflictDoNothing()
        .returning({ badgeId: studentBadges.badgeId });
      if (inserted.length) awarded.push(badge.id);
    }
    if (awarded.length === 0) return [];
    const titles = await tx
      .select()
      .from(badgeTranslations)
      .where(inArray(badgeTranslations.badgeId, awarded));
    return earned
      .filter((b) => awarded.includes(b.id))
      .map((b) => ({
        code: b.code,
        title:
          pickTranslation(
            titles.filter((t) => t.badgeId === b.id),
            locale,
          )?.title ?? b.code,
      }));
  }
}
