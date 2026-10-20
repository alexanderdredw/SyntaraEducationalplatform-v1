import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  BATTLE_ANSWER_GRACE_MS,
  BATTLE_CODE_RE,
  type BattleAnswerDto,
  battleDisplayName,
  type BattleHistoryQuery,
  type BattleSettings,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { ENV, type Env } from '../../config/env';
import { DB, REDIS } from '../../infra/tokens';
import { ClassCodesService } from '../classes/class-codes.service';
import { cursorCondition, newestFirst, page } from '../support/pagination';
import { answeredKey, BattleEngine } from './battle-engine.service';
import { battleError } from './battle-session.service';
import { BattleStateService } from './battle-state.service';

const { battleSessions, battleParticipants, battleAnswers, battleQuizzes, classMemberships, users } = schema;

/** BR-BTL-03: не чаще 1 ответа в 200 мс на участника. */
const ANSWER_INTERVAL_MS = 200;
/** answer_progress ведущему — не чаще раза в 250 мс (6.9). */
const PROGRESS_INTERVAL_MS = 250;

/**
 * Участие ученика в Battle (SPEC 6.8 API-BTL-40…46, BR-BTL-02/03/07). Вход — только в сессию своего класса;
 * ответ «код не найден» одинаков для несуществующего и чужого кода. Правильность до раскрытия не сообщается.
 */
@Injectable()
export class StudentBattleService {
  private readonly progressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly engine: BattleEngine,
    private readonly state: BattleStateService,
    private readonly classCodes: ClassCodesService,
  ) {}

  /**
   * API-BTL-40: код ищется только среди активных сессий Battle (BR-CODE-02). Формат проверяется до запроса в БД —
   * 422 `invalidBattleCode`; активный код класса — 404 `isClassCode` без данных класса (BR-CODE-04).
   */
  async join(studentId: string, code: string): Promise<{ sessionId: string }> {
    // TODO(OWNER): обычный код класса (не вида LLLDDD) получает 422 invalidBattleCode, а не подсказку isClassCode —
    // BR-CODE-02 запрещает запрос в БД до проверки формата. Нужна ли подсказка и для таких кодов?
    if (!BATTLE_CODE_RE.test(code)) throw battleError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalidBattleCode');
    const [session] = await this.db
      .select({
        id: battleSessions.id,
        status: battleSessions.status,
        settings: battleSessions.settings,
        version: battleSessions.stateVersion,
      })
      .from(battleSessions)
      .innerJoin(
        classMemberships,
        and(
          eq(classMemberships.classId, battleSessions.classId),
          eq(classMemberships.studentId, studentId),
          eq(classMemberships.status, 'active'),
        ),
      )
      .where(and(eq(battleSessions.code, code), inArray(battleSessions.status, ['lobby', 'in_progress'])));
    // BR-BTL-02: код чужого класса — как несуществующий.
    if (!session)
      throw battleError(
        HttpStatus.NOT_FOUND,
        (await this.classCodes.isActiveCode(code)) ? 'isClassCode' : 'codeNotFound',
      );
    const settings = session.settings as BattleSettings;

    const outcome = await this.db.transaction(async (tx) => {
      await tx
        .select({ id: battleSessions.id })
        .from(battleSessions)
        .where(eq(battleSessions.id, session.id))
        .for('update');
      const [existing] = await tx
        .select()
        .from(battleParticipants)
        .where(
          and(eq(battleParticipants.sessionId, session.id), eq(battleParticipants.studentId, studentId)),
        );
      if (existing?.kickedAt) throw battleError(HttpStatus.CONFLICT, 'kicked');
      if (existing && !existing.leftAt) return { participant: existing, joined: false };
      if (!existing && session.status === 'in_progress' && !settings.lateJoin)
        throw battleError(HttpStatus.CONFLICT, 'alreadyStarted');
      const [present] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(battleParticipants)
        .where(
          and(
            eq(battleParticipants.sessionId, session.id),
            isNull(battleParticipants.kickedAt),
            isNull(battleParticipants.leftAt),
          ),
        );
      if ((present?.n ?? 0) >= settings.maxParticipants) throw battleError(HttpStatus.CONFLICT, 'full');
      const now = new Date();
      if (existing) {
        const [row] = await tx
          .update(battleParticipants)
          .set({ leftAt: null, lastSeenAt: now })
          .where(eq(battleParticipants.id, existing.id))
          .returning();
        return { participant: row!, joined: true };
      }
      const [user] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, studentId));
      const [row] = await tx
        .insert(battleParticipants)
        .values({
          sessionId: session.id,
          studentId,
          displayName: battleDisplayName(user!.name),
          lastSeenAt: now,
        })
        .returning();
      await tx.update(battleSessions).set({ lastActivityAt: now }).where(eq(battleSessions.id, session.id));
      return { participant: row!, joined: true };
    });
    if (outcome.joined) await this.announce(session.id, outcome.participant, 'participant_joined');
    return { sessionId: session.id };
  }

  /** API-BTL-44 */
  async leave(studentId: string, sessionId: string): Promise<void> {
    const [p] = await this.db
      .update(battleParticipants)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(battleParticipants.sessionId, sessionId),
          eq(battleParticipants.studentId, studentId),
          isNull(battleParticipants.leftAt),
          isNull(battleParticipants.kickedAt),
        ),
      )
      .returning();
    if (p) await this.announce(sessionId, p, 'participant_left');
  }

  private async announce(
    sessionId: string,
    p: typeof battleParticipants.$inferSelect,
    type: 'participant_joined' | 'participant_left',
  ) {
    const snapshot = await this.state.host(sessionId);
    await this.engine.publish([
      {
        type,
        sessionId,
        version: snapshot.version,
        audience: 'all',
        data: {
          participant: {
            id: p.id,
            displayName: p.displayName,
            joinedAt: p.joinedAt.toISOString(),
            left: p.leftAt !== null,
          },
          participantsCount: snapshot.participantsCount,
        },
      },
    ]);
    // Вышедший больше не ждёт ответа — возможно, теперь ответили все (BR-BTL-03).
    if (type === 'participant_left' && snapshot.phase === 'question' && snapshot.question)
      await this.engine.closeIfAllAnswered(sessionId, snapshot.question.index, snapshot.answered);
  }

  /** Участник сессии (OwnershipGuard уже проверил, что строка есть). */
  async participant(studentId: string, sessionId: string) {
    const [p] = await this.db
      .select()
      .from(battleParticipants)
      .where(and(eq(battleParticipants.sessionId, sessionId), eq(battleParticipants.studentId, studentId)));
    return p!;
  }

  /** API-BTL-43 (BATTLE_TZ 6.3): проверка → правильность по снимку → INSERT … ON CONFLICT DO NOTHING → счётчик. */
  async answer(studentId: string, sessionId: string, dto: BattleAnswerDto): Promise<{ accepted: true }> {
    const now = new Date();
    const p = await this.participant(studentId, sessionId);
    if (p.kickedAt) throw battleError(HttpStatus.CONFLICT, 'kicked');
    if (p.leftAt) throw battleError(HttpStatus.CONFLICT, 'notInGame');
    const [session] = await this.db.select().from(battleSessions).where(eq(battleSessions.id, sessionId));
    const open =
      session!.phase === 'question' &&
      session!.currentIndex === dto.questionIndex &&
      now.getTime() <= session!.deadlineAt!.getTime() + BATTLE_ANSWER_GRACE_MS;
    // Повтор сети уже сохранённого ответа — тот же результат, даже если вопрос успел закрыться (AC-BTL-09).
    const [previous] = await this.db
      .select()
      .from(battleAnswers)
      .where(and(eq(battleAnswers.participantId, p.id), eq(battleAnswers.questionIndex, dto.questionIndex)));
    if (previous) {
      if (previous.clientAnswerId === dto.clientAnswerId) return { accepted: true };
      throw battleError(HttpStatus.CONFLICT, 'alreadyAnswered');
    }
    if (!open) throw battleError(HttpStatus.CONFLICT, 'questionClosed');
    // Лимит — после проверки повтора: повтор сети того же ответа всегда получает 200.
    if (!this.env.RATE_LIMITS_DISABLED) {
      const ok = await this.redis
        .set(`battle:rl:${p.id}`, '1', 'PX', ANSWER_INTERVAL_MS, 'NX')
        .catch(() => 'OK');
      if (ok !== 'OK')
        throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'RATE_LIMITED',
          'Too many answers',
          undefined,
          1,
        );
    }
    const q = session!.questionsSnapshot[dto.questionIndex]!;
    const option = q.options.find((o) => o.position === dto.optionPosition);
    if (!option)
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown option', {
        optionPosition: 'invalid',
      });
    const inserted = await this.db
      .insert(battleAnswers)
      .values({
        sessionId,
        participantId: p.id,
        questionIndex: dto.questionIndex,
        optionPosition: dto.optionPosition,
        isCorrect: option.isCorrect,
        responseMs: Math.max(0, now.getTime() - session!.questionStartedAt!.getTime()),
        answeredAt: now,
        clientAnswerId: dto.clientAnswerId,
      })
      .onConflictDoNothing()
      .returning({ id: battleAnswers.id });
    if (inserted.length === 0) {
      const [row] = await this.db
        .select({ clientAnswerId: battleAnswers.clientAnswerId })
        .from(battleAnswers)
        .where(
          and(eq(battleAnswers.participantId, p.id), eq(battleAnswers.questionIndex, dto.questionIndex)),
        );
      if (row?.clientAnswerId === dto.clientAnswerId) return { accepted: true };
      throw battleError(HttpStatus.CONFLICT, 'alreadyAnswered');
    }
    await Promise.all([
      this.db.update(battleParticipants).set({ lastSeenAt: now }).where(eq(battleParticipants.id, p.id)),
      this.db.update(battleSessions).set({ lastActivityAt: now }).where(eq(battleSessions.id, sessionId)),
    ]);
    const answered = await this.countAnswered(sessionId, dto.questionIndex);
    await this.engine.publish([
      {
        type: 'answer_accepted',
        sessionId,
        version: session!.stateVersion,
        audience: `participant:${p.id}`,
        data: { index: dto.questionIndex },
      },
    ]);
    this.progress(sessionId, dto.questionIndex, session!.stateVersion);
    await this.engine.closeIfAllAnswered(sessionId, dto.questionIndex, answered);
    return { accepted: true };
  }

  /** Счётчик ответов в Redis (INCR); без Redis — по БД. */
  private async countAnswered(sessionId: string, index: number): Promise<number> {
    try {
      const key = answeredKey(sessionId, index);
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 3600);
      return n;
    } catch {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(battleAnswers)
        .where(and(eq(battleAnswers.sessionId, sessionId), eq(battleAnswers.questionIndex, index)));
      return row?.n ?? 0;
    }
  }

  /** answer_progress ведущему не чаще раза в 250 мс; последнее значение отправляется с задержкой. */
  private progress(sessionId: string, index: number, version: number): void {
    const key = `${sessionId}:${index}`;
    if (this.progressTimers.has(key)) return;
    this.progressTimers.set(
      key,
      setTimeout(() => {
        this.progressTimers.delete(key);
        void this.state
          .host(sessionId)
          .then((s) =>
            this.engine.publish([
              {
                type: 'answer_progress',
                sessionId,
                version,
                audience: 'host',
                data: { index, answered: s.phase === 'question' ? s.answered : null, active: s.active },
              },
            ]),
          )
          // Сессию могли уже удалить (тесты) или api останавливается — прогресс не критичен.
          .catch(() => undefined);
      }, PROGRESS_INTERVAL_MS),
    );
  }

  /** API-BTL-45: прошедшие игры ученика (выгнанные — не показываются). */
  async history(studentId: string, query: BattleHistoryQuery) {
    const rows = await this.db
      .select({
        id: battleSessions.id,
        createdAt: battleSessions.createdAt,
        battleTitle: battleQuizzes.title,
        teacherName: users.displayName,
        finishedAt: battleSessions.finishedAt,
        rank: battleParticipants.finalRank,
        correctCount: battleParticipants.correctCount,
        questionsCount: sql<number>`jsonb_array_length(${battleSessions.questionsSnapshot})`,
        participantsCount: sql<number>`(select count(*)::int from battle_participants p where p.session_id = ${battleSessions.id} and p.kicked_at is null)`,
      })
      .from(battleParticipants)
      .innerJoin(battleSessions, eq(battleSessions.id, battleParticipants.sessionId))
      .innerJoin(battleQuizzes, eq(battleQuizzes.id, battleSessions.battleQuizId))
      .innerJoin(users, eq(users.id, battleSessions.hostId))
      .where(
        and(
          eq(battleParticipants.studentId, studentId),
          isNull(battleParticipants.kickedAt),
          eq(battleSessions.status, 'finished'),
          isNotNull(battleSessions.finishedAt),
          cursorCondition(query.cursor, battleSessions.createdAt, battleSessions.id),
        ),
      )
      .orderBy(...newestFirst(battleSessions.createdAt, battleSessions.id))
      .limit(query.limit + 1);
    const result = page(rows, query.limit);
    return {
      items: result.rows.map(({ createdAt: _c, finishedAt, ...r }) => ({
        ...r,
        finishedAt: finishedAt!.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }

  /** API-BTL-46: только после finished; ответы — только свои. */
  async results(studentId: string, sessionId: string) {
    const p = await this.participant(studentId, sessionId);
    const session = await this.state.session(sessionId);
    if (p.kickedAt) throw battleError(HttpStatus.CONFLICT, 'kicked');
    if (session.status !== 'finished') throw battleError(HttpStatus.CONFLICT, 'notFinished');
    return this.state.results(sessionId, p.id);
  }
}
