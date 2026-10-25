import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  type BattleAnswerView,
  type BattleHostSnapshot,
  type BattleQuestionStat,
  type BattleQuestionView,
  type BattleResults,
  type BattleSettings,
  type BattleStudentSnapshot,
} from '@syntara/shared';
import { battleAvatarOf, type Database, schema } from '@syntara/db';
import { questionStats, type SessionRow, standings } from '@syntara/db/battle';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { BattleRealtime } from './battle-realtime.gateway';
import { finalView, hostReveal, leaderboardView, studentReveal, toRows } from './battle-views';

const { battleSessions, battleQuizzes, battleParticipants, battleAnswers, classes, users } = schema;

/**
 * Снимки состояния игры (API-BTL-21 / API-BTL-41) и итоги (API-BTL-30 / API-BTL-46). Ученику правильный вариант
 * текущего вопроса не отдаётся до раскрытия (BR-BTL-03); после finished — разбор своих ответов.
 */
@Injectable()
export class BattleStateService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly realtime: BattleRealtime,
    private readonly config: AppConfigService,
  ) {}

  async session(sessionId: string): Promise<SessionRow> {
    const [row] = await this.db.select().from(battleSessions).where(eq(battleSessions.id, sessionId));
    return row!;
  }

  private async context(session: SessionRow) {
    const [row] = await this.db
      .select({ title: battleQuizzes.title, className: classes.name, teacherName: users.displayName })
      .from(battleSessions)
      .innerJoin(battleQuizzes, eq(battleQuizzes.id, battleSessions.battleQuizId))
      // Класс — только у сессий, запущенных до решения Q-BTL-01.
      .leftJoin(classes, eq(classes.id, battleSessions.classId))
      .innerJoin(users, eq(users.id, battleSessions.hostId))
      .where(eq(battleSessions.id, session.id));
    return row!;
  }

  private async questionView(session: SessionRow, withCorrect: boolean): Promise<BattleQuestionView | null> {
    if (session.currentIndex === null || session.phase === 'lobby' || session.phase === 'finished')
      return null;
    const q = session.questionsSnapshot[session.currentIndex]!;
    return {
      index: q.index,
      total: session.questionsSnapshot.length,
      type: q.type,
      text: q.text,
      imageUrl: await this.realtime.imageUrl(q.imageMediaId),
      timeLimitSec: q.timeLimitSec,
      options: q.options.map((o) => ({ position: o.position, text: o.text })),
      startedAt: session.questionStartedAt!.toISOString(),
      deadlineAt: session.deadlineAt!.toISOString(),
      ...(withCorrect ? { correctPosition: q.options.find((o) => o.isCorrect)!.position } : {}),
    };
  }

  /** Участники с аватаром (REQ-PRF-11: лобби ведущего). */
  private async participants(sessionId: string) {
    const rows = await this.db
      .select({
        participant: battleParticipants,
        kind: schema.userProfiles.avatarKind,
        preset: schema.userProfiles.avatarPreset,
        color: schema.userProfiles.avatarColor,
      })
      .from(battleParticipants)
      .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, battleParticipants.studentId))
      .where(and(eq(battleParticipants.sessionId, sessionId), isNull(battleParticipants.kickedAt)))
      .orderBy(asc(battleParticipants.joinedAt));
    return rows.map(({ participant, ...profile }) => ({
      ...participant,
      avatar: battleAvatarOf(participant.studentId, profile),
    }));
  }

  /** API-BTL-21 */
  async host(sessionId: string): Promise<BattleHostSnapshot> {
    const session = await this.session(sessionId);
    const [ctx, people] = await Promise.all([this.context(session), this.participants(sessionId)]);
    const index = session.currentIndex;
    const stats =
      index !== null && session.phase !== 'lobby' ? await questionStats(this.db, session, index) : null;
    const lastSeenFloor = Date.now() - 30_000;
    const active = people.filter((p) => !p.leftAt && p.lastSeenAt.getTime() >= lastSeenFloor).length;
    return {
      id: session.id,
      code: session.code,
      status: session.status,
      phase: session.phase,
      version: session.stateVersion,
      battleQuizId: session.battleQuizId,
      battleTitle: ctx.title,
      classId: session.classId,
      className: ctx.className,
      settings: session.settings as BattleSettings,
      participants: people.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatar: p.avatar,
        joinedAt: p.joinedAt.toISOString(),
        left: p.leftAt !== null,
      })),
      participantsCount: people.filter((p) => !p.leftAt).length,
      questionsCount: session.questionsSnapshot.length,
      question: await this.questionView(session, true),
      answered: session.phase === 'question' && stats ? Object.keys(stats.answers).length : 0,
      active,
      reveal:
        session.phase === 'reveal' && stats ? hostReveal({ index: index!, ...stats, standings: [] }) : null,
      leaderboard:
        session.phase === 'leaderboard'
          ? leaderboardView(index!, await standings(this.db, sessionId, index))
          : null,
      final:
        session.phase === 'finished'
          ? finalView(await standings(this.db, sessionId, null), session.questionsSnapshot.length)
          : null,
      cancelReason: (session.cancelReason as 'host' | 'expired' | null) ?? null,
      serverNow: new Date().toISOString(),
    };
  }

  /** API-BTL-41: без правильного ответа до раскрытия; своё место — после reveal. */
  async student(sessionId: string, studentId: string): Promise<BattleStudentSnapshot> {
    const session = await this.session(sessionId);
    const [me] = await this.db
      .select()
      .from(battleParticipants)
      .where(and(eq(battleParticipants.sessionId, sessionId), eq(battleParticipants.studentId, studentId)));
    const [ctx, people] = await Promise.all([this.context(session), this.participants(sessionId)]);
    const index = session.currentIndex;
    const [myAnswer] =
      index !== null && me
        ? await this.db
            .select({
              questionIndex: battleAnswers.questionIndex,
              optionPosition: battleAnswers.optionPosition,
            })
            .from(battleAnswers)
            .where(and(eq(battleAnswers.participantId, me.id), eq(battleAnswers.questionIndex, index)))
        : [];
    const needTable =
      session.phase === 'reveal' || session.phase === 'leaderboard' || session.phase === 'finished';
    const table = needTable
      ? await standings(this.db, sessionId, session.phase === 'finished' ? null : index)
      : [];
    const mine = table.find((s) => s.participantId === me?.id);
    const stats =
      session.phase === 'reveal' && index !== null ? await questionStats(this.db, session, index) : null;
    return {
      id: session.id,
      status: session.status,
      phase: session.phase,
      version: session.stateVersion,
      battleTitle: ctx.title,
      teacherName: ctx.teacherName,
      myName: me?.displayName ?? '',
      kicked: me?.kickedAt !== null && me?.kickedAt !== undefined,
      participantsCount: people.filter((p) => !p.leftAt).length,
      questionsCount: session.questionsSnapshot.length,
      question: me?.kickedAt ? null : await this.questionView(session, false),
      myAnswer: myAnswer ?? null,
      myCorrectCount: mine?.correctCount ?? 0,
      reveal: stats && me ? studentReveal({ index: index!, ...stats, standings: table }, me.id) : null,
      leaderboard: session.phase === 'leaderboard' ? leaderboardView(index!, table, me?.id ?? null) : null,
      final:
        session.phase === 'finished'
          ? finalView(table, session.questionsSnapshot.length, me?.id ?? null)
          : null,
      cancelReason: (session.cancelReason as 'host' | 'expired' | null) ?? null,
      serverNow: new Date().toISOString(),
    };
  }

  /**
   * API-BTL-30 (ведущий, в том числе идущая игра) и API-BTL-46 (ученик, после finished): пьедестал, таблица,
   * статистика по вопросам, ответы по ученикам (ученику — только свои).
   */
  async results(sessionId: string, viewerParticipantId?: string): Promise<BattleResults> {
    const session = await this.session(sessionId);
    const ctx = await this.context(session);
    const table = await standings(this.db, sessionId, null);
    const answers = await this.db
      .select()
      .from(battleAnswers)
      .innerJoin(battleParticipants, eq(battleParticipants.id, battleAnswers.participantId))
      .where(and(eq(battleAnswers.sessionId, sessionId), isNull(battleParticipants.kickedAt)));
    const playedUpTo =
      session.phase === 'question' ? (session.currentIndex ?? -1) - 1 : (session.currentIndex ?? -1);
    const asked = session.questionsSnapshot.filter((q) => q.index <= playedUpTo);
    const questions: BattleQuestionStat[] = asked.map((q) => {
      const own = answers.filter((a) => a.battle_answers.questionIndex === q.index);
      const correctPosition = q.options.find((o) => o.isCorrect)!.position;
      const right = own.filter((a) => a.battle_answers.isCorrect).length;
      return {
        index: q.index,
        text: q.text,
        type: q.type,
        options: q.options,
        correctPosition,
        correctPercent: own.length ? Math.round((100 * right) / own.length) : null,
        answered: own.length,
        distribution: q.options.map((o) => ({
          position: o.position,
          count: own.filter((a) => a.battle_answers.optionPosition === o.position).length,
        })),
        avgResponseMs: own.length
          ? Math.round(own.reduce((s, a) => s + a.battle_answers.responseMs, 0) / own.length)
          : null,
      };
    });
    const { red_below: redBelow } = await this.config.get<{ red_below: number }>('analytics');
    const answersOf = (participantId: string): BattleAnswerView[] =>
      asked.map((q) => {
        const a = answers.find(
          (x) =>
            x.battle_answers.participantId === participantId && x.battle_answers.questionIndex === q.index,
        )?.battle_answers;
        return {
          index: q.index,
          optionPosition: a?.optionPosition ?? null,
          isCorrect: a?.isCorrect ?? false,
          responseMs: a?.responseMs ?? null,
        };
      });
    const final = finalView(table, session.questionsSnapshot.length, viewerParticipantId);
    const visible = viewerParticipantId
      ? table.filter((s) => s.participantId === viewerParticipantId)
      : table;
    return {
      session: {
        id: session.id,
        battleTitle: ctx.title,
        className: ctx.className,
        teacherName: ctx.teacherName,
        status: session.status,
        startedAt: session.startedAt?.toISOString() ?? null,
        finishedAt: session.finishedAt?.toISOString() ?? null,
        participantsCount: table.length,
        questionsCount: session.questionsSnapshot.length,
      },
      podium: final.podium,
      table: final.table,
      ...(viewerParticipantId ? { me: final.me ?? null } : {}),
      questions,
      hardQuestions: questions
        .filter((q) => q.correctPercent !== null && q.correctPercent < redBelow)
        .sort((a, b) => a.correctPercent! - b.correctPercent!)
        .map((q) => q.index),
      students: visible.map((s) => ({
        displayName: s.displayName,
        rank: s.rank,
        answers: answersOf(s.participantId),
      })),
    };
  }

  /** Строки итоговой таблицы с участниками — для CSV (API-BTL-31). */
  rows = toRows;
}
