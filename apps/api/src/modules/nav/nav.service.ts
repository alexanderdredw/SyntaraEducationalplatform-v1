import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { type Locale, type NavSection } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { AssignmentsService } from '../assignments/assignments.service';
import { ClassesService } from '../classes/classes.service';
import { type ClassOverviewDto, type NavBadgesDto } from './nav.dto';

const { classSubjectAccess: csa, subjects, subjectTranslations: st, topics, topicMastery } = schema;
const { studentBadges, navSeen } = schema;

/** Ближайшие задания в «Мой класс» (REQ-NAV-11, п. 1). */
const UPCOMING_LIMIT = 3;

/**
 * Раздел «Мой класс» и счётчики панели ученика (docs/NAV_TZ_2.md): API-S-19…21. Только чтение существующих
 * данных — класс и задания через сервисы API-S-02 и API-S-10 (те же права), предметы класса — выданные без отзыва
 * и не в архиве (видимые по BR-VIS-01); отметки «последнее открытие раздела» — таблица nav_seen.
 */
@Injectable()
export class NavService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly classes: ClassesService,
    private readonly assignments: AssignmentsService,
  ) {}

  /** API-S-19 */
  async classOverview(studentId: string, locale: Locale): Promise<ClassOverviewDto> {
    const cls = await this.classes.studentClass(studentId);
    if (!cls) return { class: null, subjects: [], upcomingAssignments: [] };
    const [seen, rows, assignments] = await Promise.all([
      this.seenAt(studentId, 'class'),
      this.db
        .select({ id: subjects.id, grantedAt: csa.grantedAt })
        .from(csa)
        .innerJoin(subjects, eq(subjects.id, csa.subjectId))
        .where(this.classSubjects(cls.classId))
        .orderBy(asc(csa.grantedAt), asc(subjects.id)),
      this.assignments.studentList(studentId, locale),
    ]);
    const ids = rows.map((r) => r.id);
    const published = and(
      inArray(topics.subjectId, ids),
      eq(topics.status, 'published'),
      isNull(topics.archivedAt),
    );
    const [translations, totals, mastered] = ids.length
      ? await Promise.all([
          this.db.select().from(st).where(inArray(st.subjectId, ids)),
          this.db
            .select({ subjectId: topics.subjectId, n: count() })
            .from(topics)
            .where(published)
            .groupBy(topics.subjectId),
          this.db
            .select({ subjectId: topics.subjectId, n: count() })
            .from(topicMastery)
            .innerJoin(topics, eq(topics.id, topicMastery.topicId))
            .where(and(published, eq(topicMastery.studentId, studentId), isNotNull(topicMastery.masteredAt)))
            .groupBy(topics.subjectId),
        ])
      : [[], [], []];
    const countOf = (list: { subjectId: string; n: number }[], id: string) =>
      Number(list.find((r) => r.subjectId === id)?.n ?? 0);
    return {
      class: cls,
      subjects: rows.map((r) => {
        const tr = pickTranslation(
          translations.filter((t) => t.subjectId === r.id),
          locale,
        );
        return {
          id: r.id,
          title: tr?.title ?? '',
          description: tr?.description ?? null,
          topicsTotal: countOf(totals, r.id),
          topicsMastered: countOf(mastered, r.id),
          isNew: !seen || r.grantedAt > seen,
        };
      }),
      // «Незавершённые» — без сдачи (включая просроченные); список API-S-10 уже по сроку.
      upcomingAssignments: assignments.filter((a) => a.status === 'not_started').slice(0, UPCOMING_LIMIT),
    };
  }

  /** API-S-20: счётчики и точки «новое» (REQ-NAV-14). Нет отметки открытия — новым считается всё. */
  async badges(studentId: string, locale: Locale): Promise<NavBadgesDto> {
    const [assignments, cls, classSeen, achievementsSeen] = await Promise.all([
      this.assignments.studentList(studentId, locale),
      this.classes.studentClass(studentId),
      this.seenAt(studentId, 'class'),
      this.seenAt(studentId, 'achievements'),
    ]);
    const open = assignments.filter((a) => a.status === 'not_started');
    const classNew = cls
      ? await this.db
          .select({ n: count() })
          .from(csa)
          .innerJoin(subjects, eq(subjects.id, csa.subjectId))
          .where(and(this.classSubjects(cls.classId), classSeen ? gt(csa.grantedAt, classSeen) : undefined))
      : [{ n: 0 }];
    const badgeNew = await this.db
      .select({ n: count() })
      .from(studentBadges)
      .where(
        and(
          eq(studentBadges.studentId, studentId),
          achievementsSeen ? gt(studentBadges.awardedAt, achievementsSeen) : undefined,
        ),
      );
    return {
      assignmentsOpen: open.length,
      assignmentsOverdue: open.filter((a) => a.overdue).length,
      classHasNew: Number(classNew[0]?.n ?? 0) > 0,
      achievementsHasNew: Number(badgeNew[0]?.n ?? 0) > 0,
    };
  }

  /** API-S-21: раздел открыт — отметка «сейчас», точка пропадает. */
  async markSeen(studentId: string, section: NavSection): Promise<void> {
    const now = new Date();
    await this.db
      .insert(navSeen)
      .values({ userId: studentId, section, seenAt: now })
      .onConflictDoUpdate({ target: [navSeen.userId, navSeen.section], set: { seenAt: now } });
  }

  /** Предметы, выданные классу без отзыва и не в архиве. */
  private classSubjects(classId: string): SQL | undefined {
    return and(eq(csa.classId, classId), isNull(csa.revokedAt), isNull(subjects.archivedAt));
  }

  private async seenAt(studentId: string, section: NavSection): Promise<Date | null> {
    const [row] = await this.db
      .select({ seenAt: navSeen.seenAt })
      .from(navSeen)
      .where(and(eq(navSeen.userId, studentId), eq(navSeen.section, section)));
    return row?.seenAt ?? null;
  }
}
