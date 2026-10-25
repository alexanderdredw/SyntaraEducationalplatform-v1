import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, countDistinct, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { AssignmentsService } from '../assignments/assignments.service';
import { BattleSessionService } from '../battle/battle-session.service';
import { StudentBattleService } from '../battle/student-battle.service';
import { AvatarService } from '../profiles/avatar.service';
import { ResultsService } from '../results/results.service';
import { type DashboardDto, type StudentDashboardDto, type TeacherDashboardDto } from './dashboard.dto';

const { classes, classMemberships, users, subjects, topics, topicMastery, battleSessions, assignments } =
  schema;

/**
 * API-ME-12 (REQ-PRF-03/04): «Обзор» личного кабинета — только чтение, данные из тех же сервисов, что и разделы
 * «Показатели» (API-S-14), «Достижения» (API-S-15), «Мои задания» (API-S-10), аналитика класса (API-T-25),
 * «Задания» (API-T-23) и история Battle (API-BTL-29/45), — поэтому числа совпадают (AC-PRF-02).
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly results: ResultsService,
    private readonly assignments: AssignmentsService,
    private readonly hostBattles: BattleSessionService,
    private readonly studentBattles: StudentBattleService,
    private readonly avatars: AvatarService,
    private readonly config: AppConfigService,
  ) {}

  async dashboard(userId: string, role: 'student' | 'teacher', locale: Locale): Promise<DashboardDto> {
    return role === 'student'
      ? { role, student: await this.student(userId, locale), teacher: null }
      : { role, student: null, teacher: await this.teacher(userId, locale) };
  }

  private async student(studentId: string, locale: Locale): Promise<StudentDashboardDto> {
    const [achievements, progress, assignments, battles, myClass, [mastered]] = await Promise.all([
      this.results.achievements(studentId, locale),
      this.results.progress(studentId, '30d', locale),
      this.assignments.studentList(studentId, locale),
      this.studentBattles.history(studentId, { limit: 1 }),
      this.db
        .select({ name: classes.name, teacherId: classes.teacherId, teacherName: users.displayName })
        .from(classMemberships)
        .innerJoin(classes, eq(classes.id, classMemberships.classId))
        .innerJoin(users, eq(users.id, classes.teacherId))
        .where(
          and(
            eq(classMemberships.studentId, studentId),
            eq(classMemberships.status, 'active'),
            isNull(classes.archivedAt),
          ),
        )
        .limit(1),
      this.db
        .select({ n: count() })
        .from(topicMastery)
        .where(and(eq(topicMastery.studentId, studentId), isNotNull(topicMastery.masteredAt))),
    ]);
    const cls = myClass[0];
    const last = battles.items[0];
    return {
      achievements: {
        level: achievements.level,
        rankTitle: achievements.rankTitle,
        xpTotal: achievements.xpTotal,
        xpToNext: achievements.xpToNext,
        xpPerLevel: achievements.xpPerLevel,
        streakDays: achievements.streakDays,
        masteredTopics: Number(mastered?.n ?? 0),
        badgesEarned: achievements.earnedCount,
        badgesTotal: achievements.totalCount,
      },
      progress: {
        mastered: progress.progress.mastered,
        total: progress.progress.total,
        percent: progress.progress.percent,
      },
      nextStep: progress.nextStep,
      class: cls
        ? {
            name: cls.name,
            teacher: { name: cls.teacherName, avatar: (await this.avatars.forUser(cls.teacherId))! },
          }
        : null,
      // Как «Ближайшие задания» в «Мой класс» (API-S-19): несданные, ближайший срок — первым.
      assignments: assignments.filter((a) => a.status === 'not_started').slice(0, 3),
      badges: achievements.badges
        .filter((b) => b.earned && b.earnedAt)
        .sort((a, b) => b.earnedAt!.localeCompare(a.earnedAt!))
        .slice(0, 3)
        .map((b) => ({ code: b.code, title: b.title, imageUrl: b.imageUrl, earnedAt: b.earnedAt! })),
      lastBattle: last
        ? {
            sessionId: last.id,
            title: last.battleTitle,
            place: last.rank,
            correct: last.correctCount ?? 0,
            total: last.questionsCount,
            finishedAt: last.finishedAt,
          }
        : null,
    };
  }

  private async teacher(teacherId: string, locale: Locale): Promise<TeacherDashboardDto> {
    const own = await this.db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.teacherId, teacherId), isNull(classes.archivedAt)))
      .orderBy(asc(classes.name));
    const [[students], [ownSubjects], [published], manualReview, deadlines, history, [hosted]] =
      await Promise.all([
        this.db
          .select({ n: countDistinct(classMemberships.studentId) })
          .from(classMemberships)
          .innerJoin(classes, eq(classes.id, classMemberships.classId))
          .where(
            and(
              eq(classes.teacherId, teacherId),
              isNull(classes.archivedAt),
              eq(classMemberships.status, 'active'),
            ),
          ),
        this.db
          .select({ n: countDistinct(subjects.id) })
          .from(subjects)
          .where(and(eq(subjects.ownerId, teacherId), isNull(subjects.archivedAt))),
        this.db
          .select({ n: countDistinct(topics.id) })
          .from(topics)
          .innerJoin(subjects, eq(subjects.id, topics.subjectId))
          .where(
            and(
              eq(subjects.ownerId, teacherId),
              isNull(subjects.archivedAt),
              isNull(topics.archivedAt),
              eq(topics.status, 'published'),
            ),
          ),
        this.config.get<boolean>('assignments.manual_review'),
        this.assignments.teacherList(teacherId, locale),
        this.hostBattles.history(teacherId, { limit: 20 }),
        this.db
          .select({ n: count() })
          .from(battleSessions)
          .where(and(eq(battleSessions.hostId, teacherId), eq(battleSessions.status, 'finished'))),
      ]);

    // «Требуют внимания» — тот же блок, что в аналитике каждого класса (API-T-25), до 5 учеников.
    const flagged: Array<Omit<TeacherDashboardDto['attention'][number], 'avatar'>> = [];
    for (const cls of own) {
      if (flagged.length >= 5) break;
      const analytics = await this.results.classAnalytics(teacherId, cls.id, locale);
      for (const a of analytics.attention.slice(0, 5 - flagged.length)) {
        flagged.push({
          classId: cls.id,
          className: cls.name,
          studentId: a.studentId,
          name: a.name,
          lastActivityAt: a.lastActivityAt,
          // REQ-PRF-25: причина — «ещё не занимался» или «нет активности N дней».
          daysInactive: a.lastActivityAt
            ? Math.floor((Date.now() - new Date(a.lastActivityAt).getTime()) / 86_400_000)
            : null,
        });
      }
    }
    const avatars = await this.avatars.forUsers(flagged.map((a) => a.studentId));
    const attention = flagged.map((a) => ({ ...a, avatar: avatars.get(a.studentId)! }));

    const now = Date.now();
    return {
      counts: {
        classes: own.length,
        students: students?.n ?? 0,
        subjects: ownSubjects?.n ?? 0,
        publishedTopics: published?.n ?? 0,
        battlesHosted: Number(hosted?.n ?? 0),
      },
      // PH-29: ручной проверки нет — очередь пуста (API-T-24).
      review: { enabled: manualReview, count: 0 },
      attention,
      deadlines: await this.withSubmissionProgress(
        deadlines
          .filter((d) => new Date(d.dueAt).getTime() >= now)
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          .slice(0, 5),
      ),
      battles: history.items
        .filter((h) => h.status === 'finished')
        .slice(0, 3)
        .map((h) => ({
          sessionId: h.id,
          title: h.battleTitle,
          finishedAt: h.finishedAt,
          participants: h.participantsCount,
        })),
    };
  }

  /** REQ-PRF-25: «Сдано X из Y» — X из API-T-23 (counts.submitted), Y — действующие ученики класса задания. */
  private async withSubmissionProgress(
    items: Array<{
      id: string;
      topicTitle: string;
      className: string;
      dueAt: string;
      counts: { submitted: number };
    }>,
  ): Promise<TeacherDashboardDto['deadlines']> {
    if (items.length === 0) return [];
    const rows = await this.db
      .select({ id: assignments.id, classId: assignments.classId })
      .from(assignments)
      .where(
        inArray(
          assignments.id,
          items.map((d) => d.id),
        ),
      );
    const classOf = new Map(rows.map((r) => [r.id, r.classId]));
    const classIds = [...new Set(rows.map((r) => r.classId))];
    const sizes = await this.db
      .select({ classId: classMemberships.classId, n: count() })
      .from(classMemberships)
      .where(and(inArray(classMemberships.classId, classIds), eq(classMemberships.status, 'active')))
      .groupBy(classMemberships.classId);
    const sizeOf = new Map(sizes.map((s) => [s.classId, Number(s.n)]));
    return items.map((d) => ({
      id: d.id,
      classId: classOf.get(d.id)!,
      topicTitle: d.topicTitle,
      className: d.className,
      dueAt: d.dueAt,
      submitted: d.counts.submitted,
      total: sizeOf.get(classOf.get(d.id)!) ?? 0,
    }));
  }
}
