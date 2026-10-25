import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, max, sql } from 'drizzle-orm';
import {
  type AnalyticsConfig,
  levelOf,
  type Locale,
  localDate,
  PROGRESS_PERIODS,
  periodRanges,
  type ProgressConfig,
  type ProgressPeriod,
  progressPercent,
  streakOf,
  topicColor,
  type XpConfig,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { topicTitles } from '../../common/titles';
import { AppConfigService } from '../../config/app-config.service';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';
import { AssignmentsService } from '../assignments/assignments.service';
import { AvatarService } from '../profiles/avatar.service';
import { LessonService } from '../content/lesson.service';
import { VisibilityService } from '../content/visibility.service';
import {
  type AchievementsDto,
  type ClassAnalyticsDto,
  type MasteryMapDto,
  type NextStepDto,
  type ProgressDto,
} from './results.dto';

const { classes, classMemberships: m, classSubjectAccess: csa, assignments, users } = schema;
const { topics, subjects, topicMastery, learningEvents: ev, studentStats } = schema;
const { badges, badgeTranslations, studentBadges, levelTranslations } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

/**
 * Показатели ученика (7.4, 8.4.6), достижения (7.3, 8.4.7) и аналитика класса (7.5, 8.3.7). Учитываются и базовые
 * уроки платформы, и личные уроки учителей (решение владельца 2026-10-17). Даты — в PLATFORM_TZ (BR-ST-01).
 */
@Injectable()
export class ResultsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly config: AppConfigService,
    private readonly visibility: VisibilityService,
    private readonly assignments: AssignmentsService,
    private readonly lessons: LessonService,
    private readonly avatars: AvatarService,
  ) {}

  /**
   * API-T-25 (BR-AN-01..05, PH-30): только свой класс и его активные ученики. Темы: назначенные классу; если
   * назначений нет — темы выданных классу предметов и базовых предметов платформы, которые ученики проходили.
   */
  async classAnalytics(teacherId: string, classId: string, locale: Locale): Promise<ClassAnalyticsDto> {
    const [own] = await this.db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId), isNull(classes.archivedAt)));
    if (!own) throw notFound();
    const cfg = await this.config.get<AnalyticsConfig>('analytics');

    const students = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(m)
      .innerJoin(users, eq(users.id, m.studentId))
      .where(and(eq(m.classId, classId), eq(m.status, 'active')))
      .orderBy(asc(users.displayName), asc(users.id));
    const studentIds = students.map((s) => s.id);
    const windowDays = cfg.inactive_days;
    const empty: ClassAnalyticsDto = {
      avgPercent: 0,
      engagement: { active: 0, total: 0, windowDays },
      weakTopics: [],
      attention: [],
    };
    if (studentIds.length === 0) return empty;

    // BR-AN-02: темы назначений класса; без назначений — выданные классу предметы и базовые предметы.
    const assigned = await this.db
      .selectDistinct({ topicId: assignments.topicId })
      .from(assignments)
      .where(eq(assignments.classId, classId));
    const topicScope =
      assigned.length > 0
        ? inArray(
            topicMastery.topicId,
            assigned.map((a) => a.topicId),
          )
        : sql`${topicMastery.topicId} IN (SELECT t.id FROM ${topics} t JOIN ${subjects} s ON s.id = t.subject_id
            WHERE s.archived_at IS NULL AND (
              (s.is_official AND s.in_public_catalog)
              OR EXISTS (SELECT 1 FROM ${csa} a WHERE a.subject_id = s.id AND a.class_id = ${classId}
                AND a.revoked_at IS NULL)))`;
    const mastery = await this.db
      .select({
        topicId: topicMastery.topicId,
        studentId: topicMastery.studentId,
        best: topicMastery.bestPercent,
      })
      .from(topicMastery)
      .where(and(inArray(topicMastery.studentId, studentIds), topicScope));

    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    const round = (n: number) => Math.round(n);
    const byTopic = new Map<string, number[]>();
    for (const row of mastery) {
      const list = byTopic.get(row.topicId!) ?? [];
      list.push(Number(row.best));
      byTopic.set(row.topicId!, list);
    }
    const names = await topicTitles(this.db, [...byTopic.keys()], locale);
    const weakTopics = [...byTopic.entries()]
      .map(([topicId, values]) => {
        const percent = round(avg(values));
        return {
          topicId,
          title: names.get(topicId) ?? '',
          students: values.length,
          percent,
          color: topicColor(percent, cfg),
        };
      })
      .sort((a, b) => a.percent - b.percent || a.title.localeCompare(b.title))
      .slice(0, cfg.max_rows);

    // BR-AN-03, BR-AN-05: события за последние N дней (PH-30 inactive_days).
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const last = await this.db
      .select({ studentId: ev.studentId, at: max(ev.occurredAt) })
      .from(ev)
      .where(inArray(ev.studentId, studentIds))
      .groupBy(ev.studentId);
    const lastOf = (id: string) => last.find((l) => l.studentId === id)?.at ?? null;
    const active = students.filter((s) => {
      const at = lastOf(s.id);
      return at !== null && at > since;
    });
    const attention = students
      .filter((s) => !active.includes(s))
      .map((s) => ({ studentId: s.id, name: s.name, lastActivityAt: lastOf(s.id)?.toISOString() ?? null }))
      .sort((a, b) => (a.lastActivityAt ?? '').localeCompare(b.lastActivityAt ?? ''))
      .map((a) => ({ ...a, reason: 'inactive' as const }));

    return {
      avgPercent: round(avg(mastery.map((r) => Number(r.best)))),
      engagement: { active: active.length, total: students.length, windowDays },
      weakTopics,
      attention,
    };
  }

  /**
   * API-T-29 «Карта освоения» (решение владельца 2026-10-17, вместо заглушки PH-24): ученики класса × опубликованные
   * темы выбранного предмета — базового или своего, выданного классу (те же предметы, что можно назначить, API-T-28).
   * Статус ячейки: освоена (mastered_at, ≥ порога PH-38) / начата (есть попытка или урок открыт) / не начата.
   */
  async masteryMap(
    teacherId: string,
    classId: string,
    subjectId: string | undefined,
    locale: Locale,
  ): Promise<MasteryMapDto> {
    // Проверка своего класса (404) — внутри options.
    const { subjects: available } = await this.assignments.options(teacherId, classId, locale);
    const subject = subjectId ? available.find((s) => s.id === subjectId) : available[0];
    if (subjectId && !subject) throw notFound();
    const students = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(m)
      .innerJoin(users, eq(users.id, m.studentId))
      .where(and(eq(m.classId, classId), eq(m.status, 'active')))
      .orderBy(asc(users.displayName), asc(users.id));
    const topicList = subject?.topics ?? [];
    const studentIds = students.map((s) => s.id);
    const topicIds = topicList.map((t) => t.id);
    const ready = studentIds.length > 0 && topicIds.length > 0;
    const [mastery, opened] = ready
      ? await Promise.all([
          this.db
            .select()
            .from(topicMastery)
            .where(and(inArray(topicMastery.studentId, studentIds), inArray(topicMastery.topicId, topicIds))),
          this.db
            .selectDistinct({ studentId: ev.studentId, topicId: ev.topicId })
            .from(ev)
            .where(
              and(
                inArray(ev.studentId, studentIds),
                inArray(ev.topicId, topicIds),
                eq(ev.type, 'lesson_opened'),
              ),
            ),
        ])
      : [[], []];
    const cells = students.flatMap((s) =>
      topicList.map((t) => {
        const row = mastery.find((r) => r.studentId === s.id && r.topicId === t.id);
        const started = row || opened.some((o) => o.studentId === s.id && o.topicId === t.id);
        return {
          studentId: s.id,
          topicId: t.id,
          status: row?.masteredAt
            ? ('mastered' as const)
            : started
              ? ('started' as const)
              : ('not_started' as const),
          percent: row ? Math.round(Number(row.bestPercent)) : null,
        };
      }),
    );
    return {
      subjects: available.map(({ id, title, official }) => ({ id, title, official })),
      subjectId: subject?.id ?? null,
      topics: topicList,
      // REQ-PRF-11: аватар ученика в «Карте освоения».
      students: await this.withAvatars(students),
      cells,
    };
  }

  /** API-S-14 (BR-ST-01..06, PH-38). */
  async progress(studentId: string, period: ProgressPeriod, locale: Locale): Promise<ProgressDto> {
    const cfg = await this.config.get<ProgressConfig>('progress');
    const tz = this.env.PLATFORM_TZ;
    const today = localDate(new Date(), tz);
    const ranges = periodRanges(period, today, cfg);
    // Q-23: четвертей в конфигурации нет — период недоступен (сегмент неактивен в интерфейсе).
    if (!ranges)
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'Period is not configured', {
        period: 'periodUnavailable',
      });
    const availablePeriods = PROGRESS_PERIODS.filter((p) => p !== 'quarter' || periodRanges(p, today, cfg));

    // Четверть и учебный год заканчиваются в будущем — значения считаются на сегодня, а не на конец периода.
    const end = ranges.range.to > today ? today : ranges.range.to;
    const [now, before] = await Promise.all([
      this.progressAt(studentId, end),
      this.progressAt(studentId, ranges.compare.to),
    ]);
    const days = await this.activityDays(studentId);
    const streakAt = (day: string) => {
      const until = days.filter((d) => d <= day);
      return { days: streakOf(until, day).current, last: until.at(-1) ?? null };
    };
    const streakNow = streakAt(end);
    const streakBefore = streakAt(ranges.compare.to);
    const percentNow = progressPercent(now.mastered, now.total);
    const percentBefore = progressPercent(before.mastered, before.total);
    return {
      period,
      availablePeriods,
      range: ranges.range,
      compareRange: ranges.compare,
      nextStep: await this.nextStep(studentId, cfg.mastery_threshold, locale),
      progress: {
        mastered: now.mastered,
        total: now.total,
        percent: percentNow,
        deltaPercent: Math.round((percentNow - percentBefore) * 10) / 10,
      },
      streak: {
        days: streakNow.days,
        lastActivityDate: streakNow.last,
        delta: streakNow.days - streakBefore.days,
      },
    };
  }

  /**
   * BR-ST-05 на конец дня `day`: total — опубликованные темы предметов, где у ученика есть хотя бы одно событие
   * (по этот день); mastered — освоенные из них (mastered_at по этот день). Базовые и личные предметы — одинаково.
   */
  private async progressAt(studentId: string, day: string): Promise<{ mastered: number; total: number }> {
    const tz = this.env.PLATFORM_TZ;
    const rows = await this.db.execute<{ total: string; mastered: string }>(sql`
      WITH started AS (
        SELECT DISTINCT e.subject_id FROM ${ev} e
        WHERE e.student_id = ${studentId} AND e.subject_id IS NOT NULL
          AND (e.occurred_at AT TIME ZONE ${tz})::date <= ${day}::date
      ), scope AS (
        SELECT t.id FROM ${topics} t JOIN started s ON s.subject_id = t.subject_id
        WHERE t.status = 'published' AND t.archived_at IS NULL
      )
      SELECT (SELECT count(*) FROM scope) AS total,
        (SELECT count(*) FROM ${topicMastery} tm JOIN scope ON scope.id = tm.topic_id
         WHERE tm.student_id = ${studentId} AND tm.mastered_at IS NOT NULL
           AND (tm.mastered_at AT TIME ZONE ${tz})::date <= ${day}::date) AS mastered`);
    const [row] = rows as unknown as Array<{ total: string; mastered: string }>;
    return { total: Number(row?.total ?? 0), mastered: Number(row?.mastered ?? 0) };
  }

  /** BR-ST-02: дни активности (quiz_finished, lesson_opened) в PLATFORM_TZ, по возрастанию. */
  private async activityDays(studentId: string): Promise<string[]> {
    const tz = this.env.PLATFORM_TZ;
    const rows = await this.db
      .selectDistinct({
        day: sql<string>`to_char((${ev.occurredAt} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
      })
      .from(ev)
      .where(and(eq(ev.studentId, studentId), inArray(ev.type, ['lesson_opened', 'quiz_finished'])));
    return rows.map((r) => r.day).sort();
  }

  /**
   * BR-ST-06: (1) незавершённое назначение с ближайшим сроком → (2) начатая тема с минимальным best_percent ниже
   * порога освоения → (3) следующая тема после последней открытой → (4) каталог. Только видимые ученику темы.
   */
  private async nextStep(studentId: string, threshold: number, locale: Locale): Promise<NextStepDto> {
    const assignmentList = await this.assignments.studentList(studentId, locale);
    const due = assignmentList.find((a) => a.status === 'not_started' && !a.overdue);
    if (due) {
      return {
        action: 'assignment',
        reason: 'assignment_due',
        href: `/learn/topics/${due.topicId}?tab=quiz&assignment=${due.id}`,
        topicTitle: due.topicTitle,
        dueAt: due.dueAt,
        percent: null,
      };
    }

    const weak = await this.db
      .select({ topicId: topicMastery.topicId, best: topicMastery.bestPercent })
      .from(topicMastery)
      .where(and(eq(topicMastery.studentId, studentId), sql`${topicMastery.bestPercent} < ${threshold}`))
      .orderBy(asc(topicMastery.bestPercent));
    for (const w of weak) {
      if (!(await this.visibility.canStudentSeeTopic(studentId, w.topicId!))) continue;
      const names = await topicTitles(this.db, [w.topicId!], locale);
      return {
        action: 'improve_topic',
        reason: 'below_mastery',
        href: `/learn/topics/${w.topicId}?tab=quiz`,
        topicTitle: names.get(w.topicId!) ?? '',
        dueAt: null,
        percent: Math.round(Number(w.best)),
      };
    }

    const [lastOpened] = await this.db
      .select({ topicId: ev.topicId })
      .from(ev)
      .where(and(eq(ev.studentId, studentId), eq(ev.type, 'lesson_opened')))
      .orderBy(desc(ev.occurredAt))
      .limit(1);
    if (lastOpened?.topicId) {
      const [current] = await this.db
        .select({ subjectId: topics.subjectId, position: topics.position })
        .from(topics)
        .where(eq(topics.id, lastOpened.topicId));
      if (current) {
        const following = await this.db
          .select({ id: topics.id })
          .from(topics)
          .where(
            and(
              eq(topics.subjectId, current.subjectId),
              gt(topics.position, current.position),
              eq(topics.status, 'published'),
              isNull(topics.archivedAt),
            ),
          )
          .orderBy(asc(topics.position));
        for (const next of following) {
          if (!(await this.visibility.canStudentSeeTopic(studentId, next.id))) continue;
          const names = await topicTitles(this.db, [next.id], locale);
          return {
            action: 'next_topic',
            reason: 'continue',
            href: `/learn/topics/${next.id}`,
            topicTitle: names.get(next.id) ?? '',
            dueAt: null,
            percent: null,
          };
        }
      }
    }
    return {
      action: 'catalog',
      reason: 'start',
      href: '/learn/subjects',
      topicTitle: null,
      dueAt: null,
      percent: null,
    };
  }

  /** API-S-15 (BR-XP-03, BR-BDG-01/02): уровень, ранг, «живая» серия (BR-ST-03) и все активные бейджи. */
  async achievements(studentId: string, locale: Locale): Promise<AchievementsDto> {
    const xp = await this.config.get<XpConfig>('xp');
    const tz = this.env.PLATFORM_TZ;
    const [stats] = await this.db.select().from(studentStats).where(eq(studentStats.studentId, studentId));
    const xpTotal = stats?.xpTotal ?? 0;
    const { level, xpToNext } = levelOf(xpTotal, xp.per_level);
    const today = localDate(new Date(), tz);
    const yesterday = localDate(new Date(Date.now() - 86_400_000), tz);
    const alive = stats?.lastActivityDate === today || stats?.lastActivityDate === yesterday;

    const [rank, list, earned] = await Promise.all([
      this.db.select().from(levelTranslations).where(eq(levelTranslations.level, level)),
      this.db
        .select({ id: badges.id, code: badges.code, imageMediaId: badges.imageMediaId })
        .from(badges)
        .where(eq(badges.isActive, true))
        .orderBy(asc(badges.position)),
      this.db.select().from(studentBadges).where(eq(studentBadges.studentId, studentId)),
    ]);
    const translations = list.length
      ? await this.db
          .select()
          .from(badgeTranslations)
          .where(
            inArray(
              badgeTranslations.badgeId,
              list.map((b) => b.id),
            ),
          )
      : [];
    const result = await Promise.all(
      list.map(async (b) => {
        const tr = pickTranslation(
          translations.filter((t) => t.badgeId === b.id),
          locale,
        );
        const got = earned.find((e) => e.badgeId === b.id);
        return {
          code: b.code,
          title: tr?.title ?? '',
          condition: tr?.conditionText ?? '',
          imageUrl: b.imageMediaId ? await this.lessons.cleanMediaUrl(b.imageMediaId) : null,
          earned: Boolean(got),
          earnedAt: got?.awardedAt.toISOString() ?? null,
        };
      }),
    );
    return {
      level,
      rankTitle: pickTranslation(rank, locale)?.title ?? '',
      xpTotal,
      xpToNext,
      xpPerLevel: xp.per_level,
      streakDays: alive ? (stats?.streakCurrent ?? 0) : 0,
      badges: result,
      earnedCount: result.filter((b) => b.earned).length,
      totalCount: result.length,
    };
  }

  private async withAvatars<T extends { id: string }>(students: T[]) {
    const avatars = await this.avatars.forUsers(students.map((st) => st.id));
    return students.map((st) => ({ ...st, avatar: avatars.get(st.id)! }));
  }
}
