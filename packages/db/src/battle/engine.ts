import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { BATTLE_ANSWER_GRACE_MS, rankBattle, scoreBattleAnswers, type BattleSettings } from '@syntara/shared';
import { type Database } from '../index';
import {
  battleAnswers,
  battleParticipants,
  battleSessions,
  type BattleSnapshotQuestion,
} from '../schema/battle';

/**
 * Переходы автомата SM-BTL (SPEC 9, BR-BTL-08) — единственная реализация: её вызывают api (BattleEngine)
 * и worker (очередь battle: таймер закрытия вопроса, автопереход, истечение сессий).
 * Каждый переход — одна транзакция с SELECT … FOR UPDATE строки сессии и проверкой ожидаемых фазы, номера вопроса
 * и версии; повторный или запоздавший переход ничего не меняет. Изменение состояния увеличивает state_version.
 * Результат перехода — внутренние события для Redis Pub/Sub (персонализацию и снятие лишнего делает api перед
 * отправкой в SSE) и таймеры, которые вызывающий ставит в очередь battle.
 */

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type SessionRow = typeof battleSessions.$inferSelect;

/** Получатели события (SPEC 6.9). */
export type BattleAudience = 'all' | 'host' | 'students' | `participant:${string}`;

/** Внутреннее событие (Redis `battle:{sessionId}`); правильность чужих ответов уходит только ведущему (6.9). */
export interface BattleWireEvent {
  type:
    | 'participant_joined'
    | 'participant_left'
    | 'participant_kicked'
    | 'question_started'
    | 'answer_progress'
    | 'answer_accepted'
    | 'question_revealed'
    | 'leaderboard'
    | 'finished'
    | 'cancelled'
    | 'kicked';
  sessionId: string;
  version: number;
  audience: BattleAudience;
  data: Record<string, unknown>;
}

export interface BattleTimer {
  name: 'close-question' | 'auto-next';
  delayMs: number;
  data: { sessionId: string; index: number | null; version: number };
}

export interface TransitionResult {
  /** true — состояние изменилось. */
  changed: boolean;
  /** Причина отказа для api: версия не совпала, переход недопустим, нет участников. */
  reason?: 'staleState' | 'invalidTransition' | 'noParticipants';
  session: SessionRow | null;
  events: BattleWireEvent[];
  timers: BattleTimer[];
}

export interface Standing {
  participantId: string;
  displayName: string;
  correctCount: number;
  correctTimeMs: number;
  answeredCount: number;
  rank: number;
}

/** Автопереход после reveal и leaderboard (SPEC 7.12, настройки). */
export const BATTLE_AUTO_NEXT_MS = 5_000;
/** Промежуточный рейтинг — топ-5 (BR-BTL-04, 6.9). */
export const BATTLE_TOP = 5;
/** BR-BTL-06: срок жизни лобби и игры без активности. */
export const BATTLE_LOBBY_TTL_MS = 60 * 60_000;
export const BATTLE_IDLE_TTL_MS = 30 * 60_000;

const unchanged = (session: SessionRow | null, reason?: TransitionResult['reason']): TransitionResult => ({
  changed: false,
  reason,
  session,
  events: [],
  timers: [],
});

async function lock(tx: Tx, sessionId: string): Promise<SessionRow | null> {
  const [row] = await tx.select().from(battleSessions).where(eq(battleSessions.id, sessionId)).for('update');
  return row ?? null;
}

/** Участники в рейтинге — без выгнанных (BR-BTL-04); вышедшие сами остаются. */
const ranked = (sessionId: string) =>
  and(eq(battleParticipants.sessionId, sessionId), isNull(battleParticipants.kickedAt));

/**
 * BR-BTL-04: места по ответам на вопросы с номером ≤ uptoIndex (null — все ответы).
 * Порядок равных — по времени входа (стабильно).
 */
export async function standings(
  db: Tx | Database,
  sessionId: string,
  uptoIndex: number | null,
): Promise<Standing[]> {
  const participants = await db
    .select({ id: battleParticipants.id, displayName: battleParticipants.displayName })
    .from(battleParticipants)
    .where(ranked(sessionId))
    .orderBy(asc(battleParticipants.joinedAt), asc(battleParticipants.id));
  if (participants.length === 0) return [];
  const answers = await db
    .select({
      participantId: battleAnswers.participantId,
      isCorrect: battleAnswers.isCorrect,
      responseMs: battleAnswers.responseMs,
      questionIndex: battleAnswers.questionIndex,
    })
    .from(battleAnswers)
    .where(eq(battleAnswers.sessionId, sessionId));
  const relevant = uptoIndex === null ? answers : answers.filter((a) => a.questionIndex <= uptoIndex);
  return rankBattle(
    participants.map((p) => ({
      participantId: p.id,
      displayName: p.displayName,
      ...scoreBattleAnswers(relevant.filter((a) => a.participantId === p.id)),
    })),
  );
}

/** Активные участники (BR-BTL-03): не выгнаны, не вышли, на связи за последние 30 с. */
export async function activeParticipantIds(
  db: Tx | Database,
  sessionId: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ id: battleParticipants.id })
    .from(battleParticipants)
    .where(
      and(
        eq(battleParticipants.sessionId, sessionId),
        isNull(battleParticipants.kickedAt),
        isNull(battleParticipants.leftAt),
        gte(battleParticipants.lastSeenAt, new Date(now.getTime() - 30_000)),
      ),
    );
  return rows.map((r) => r.id);
}

function questionStarted(session: SessionRow, q: BattleSnapshotQuestion, now: Date): BattleWireEvent {
  return {
    type: 'question_started',
    sessionId: session.id,
    version: session.stateVersion,
    audience: 'all',
    data: {
      index: q.index,
      total: session.questionsSnapshot.length,
      type: q.type,
      text: q.text,
      imageMediaId: q.imageMediaId,
      timeLimitSec: q.timeLimitSec,
      options: q.options.map((o) => ({ position: o.position, text: o.text })),
      startedAt: session.questionStartedAt!.toISOString(),
      deadlineAt: session.deadlineAt!.toISOString(),
      serverNow: now.toISOString(),
    },
  };
}

const closeTimer = (session: SessionRow, now: Date): BattleTimer => ({
  name: 'close-question',
  delayMs: Math.max(0, session.deadlineAt!.getTime() + BATTLE_ANSWER_GRACE_MS - now.getTime()),
  data: { sessionId: session.id, index: session.currentIndex, version: session.stateVersion },
});

const autoNextTimer = (session: SessionRow): BattleTimer[] =>
  (session.settings as BattleSettings).autoAdvance
    ? [
        {
          name: 'auto-next',
          delayMs: BATTLE_AUTO_NEXT_MS,
          data: { sessionId: session.id, index: session.currentIndex, version: session.stateVersion },
        },
      ]
    : [];

async function openQuestion(
  tx: Tx,
  session: SessionRow,
  index: number,
  now: Date,
  extra: Partial<SessionRow> = {},
) {
  const q = session.questionsSnapshot[index]!;
  const [next] = await tx
    .update(battleSessions)
    .set({
      ...extra,
      status: 'in_progress',
      phase: 'question',
      currentIndex: index,
      questionStartedAt: now,
      deadlineAt: new Date(now.getTime() + q.timeLimitSec * 1000),
      stateVersion: session.stateVersion + 1,
      lastActivityAt: now,
    })
    .where(eq(battleSessions.id, session.id))
    .returning();
  return {
    changed: true,
    session: next!,
    events: [questionStarted(next!, q, now)],
    timers: [closeTimer(next!, now)],
  } satisfies TransitionResult;
}

/** lobby → question(0) (API-BTL-23); без участников — отказ noParticipants. */
export async function startSession(
  db: Database,
  sessionId: string,
  opts: { expectedVersion?: number; now?: Date } = {},
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const session = await lock(tx, sessionId);
    if (!session) return unchanged(null, 'invalidTransition');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== session.stateVersion)
      return unchanged(session, 'staleState');
    if (session.phase !== 'lobby') return unchanged(session, 'invalidTransition');
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(battleParticipants)
      .where(and(ranked(sessionId), isNull(battleParticipants.leftAt)));
    if (!count || count.n === 0) return unchanged(session, 'noParticipants');
    return openQuestion(tx, session, 0, now, { startedAt: now });
  });
}

/** Распределение ответов по вариантам и среднее время (BT-T06). */
export async function questionStats(tx: Tx | Database, session: SessionRow, index: number) {
  const rows = await tx
    .select({
      participantId: battleAnswers.participantId,
      position: battleAnswers.optionPosition,
      responseMs: battleAnswers.responseMs,
    })
    .from(battleAnswers)
    .innerJoin(battleParticipants, eq(battleParticipants.id, battleAnswers.participantId))
    .where(
      and(
        eq(battleAnswers.sessionId, session.id),
        eq(battleAnswers.questionIndex, index),
        isNull(battleParticipants.kickedAt),
      ),
    );
  const q = session.questionsSnapshot[index]!;
  return {
    correctPosition: q.options.find((o) => o.isCorrect)!.position,
    distribution: q.options.map((o) => ({
      position: o.position,
      count: rows.filter((r) => r.position === o.position).length,
    })),
    avgResponseMs: rows.length ? Math.round(rows.reduce((s, r) => s + r.responseMs, 0) / rows.length) : null,
    answers: Object.fromEntries(rows.map((r) => [r.participantId, r.position])),
  };
}

/**
 * question → reveal (дедлайн + 500 мс, «все ответили», «Завершить вопрос» — API-BTL-24). Вопрос другого номера или
 * уже закрытый — без изменений.
 */
export async function closeQuestion(
  db: Database,
  sessionId: string,
  opts: { index?: number | null; expectedVersion?: number; now?: Date } = {},
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const session = await lock(tx, sessionId);
    if (!session) return unchanged(null, 'invalidTransition');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== session.stateVersion)
      return unchanged(session, 'staleState');
    if (session.phase !== 'question') return unchanged(session, 'invalidTransition');
    if (opts.index !== undefined && opts.index !== null && opts.index !== session.currentIndex)
      return unchanged(session, 'invalidTransition');
    const index = session.currentIndex!;
    const [next] = await tx
      .update(battleSessions)
      .set({ phase: 'reveal', stateVersion: session.stateVersion + 1, lastActivityAt: now })
      .where(eq(battleSessions.id, session.id))
      .returning();
    const stats = await questionStats(tx, next!, index);
    const table = await standings(tx, sessionId, index);
    return {
      changed: true,
      session: next!,
      events: [
        {
          type: 'question_revealed',
          sessionId,
          version: next!.stateVersion,
          audience: 'all',
          data: { index, ...stats, standings: table },
        },
      ],
      timers: autoNextTimer(next!),
    };
  });
}

/** Итоги участников и событие finished (BR-BTL-04). */
async function finishIn(tx: Tx, session: SessionRow, now: Date): Promise<TransitionResult> {
  const table = await standings(tx, session.id, null);
  for (const s of table) {
    await tx
      .update(battleParticipants)
      .set({
        correctCount: s.correctCount,
        correctTimeMs: s.correctTimeMs,
        answeredCount: s.answeredCount,
        finalRank: s.rank,
      })
      .where(eq(battleParticipants.id, s.participantId));
  }
  const [next] = await tx
    .update(battleSessions)
    .set({
      status: 'finished',
      phase: 'finished',
      deadlineAt: null,
      stateVersion: session.stateVersion + 1,
      finishedAt: now,
      lastActivityAt: now,
    })
    .where(eq(battleSessions.id, session.id))
    .returning();
  return {
    changed: true,
    session: next!,
    events: [
      {
        type: 'finished',
        sessionId: session.id,
        version: next!.stateVersion,
        audience: 'all',
        data: { standings: table, questionsCount: session.questionsSnapshot.length },
      },
    ],
    timers: [],
  };
}

/**
 * «Далее» (API-BTL-25, автопереход): reveal → leaderboard (если включён и вопрос не последний) → question(i+1);
 * на последнем вопросе → finished.
 */
export async function nextPhase(
  db: Database,
  sessionId: string,
  opts: { expectedVersion?: number; now?: Date } = {},
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const session = await lock(tx, sessionId);
    if (!session) return unchanged(null, 'invalidTransition');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== session.stateVersion)
      return unchanged(session, 'staleState');
    if (session.phase !== 'reveal' && session.phase !== 'leaderboard')
      return unchanged(session, 'invalidTransition');
    const index = session.currentIndex!;
    const last = index >= session.questionsSnapshot.length - 1;
    if (last) return finishIn(tx, session, now);
    if (session.phase === 'reveal' && (session.settings as BattleSettings).leaderboard) {
      const [next] = await tx
        .update(battleSessions)
        .set({ phase: 'leaderboard', stateVersion: session.stateVersion + 1, lastActivityAt: now })
        .where(eq(battleSessions.id, session.id))
        .returning();
      const table = await standings(tx, sessionId, index);
      return {
        changed: true,
        session: next!,
        events: [
          {
            type: 'leaderboard',
            sessionId,
            version: next!.stateVersion,
            audience: 'all',
            data: { index, standings: table },
          },
        ],
        timers: autoNextTimer(next!),
      };
    }
    return openQuestion(tx, session, index + 1, now);
  });
}

/** Досрочное завершение (API-BTL-26): итог по отвеченным вопросам. Из lobby — тоже finished. */
export async function finishSession(
  db: Database,
  sessionId: string,
  opts: { expectedVersion?: number; now?: Date } = {},
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const session = await lock(tx, sessionId);
    if (!session) return unchanged(null, 'invalidTransition');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== session.stateVersion)
      return unchanged(session, 'staleState');
    if (session.status === 'finished' || session.status === 'cancelled')
      return unchanged(session, 'invalidTransition');
    return finishIn(tx, session, now);
  });
}

/** Отмена (API-BTL-27: только из lobby) и истечение (BR-BTL-06: лобби или игра без активности). */
export async function cancelSession(
  db: Database,
  sessionId: string,
  opts: { expectedVersion?: number; reason: 'host' | 'expired'; now?: Date },
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const session = await lock(tx, sessionId);
    if (!session) return unchanged(null, 'invalidTransition');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== session.stateVersion)
      return unchanged(session, 'staleState');
    const allowed =
      opts.reason === 'host'
        ? session.status === 'lobby'
        : session.status === 'lobby' || session.status === 'in_progress';
    if (!allowed) return unchanged(session, 'invalidTransition');
    const [next] = await tx
      .update(battleSessions)
      .set({
        status: 'cancelled',
        cancelReason: opts.reason,
        deadlineAt: null,
        stateVersion: session.stateVersion + 1,
        finishedAt: now,
        lastActivityAt: now,
      })
      .where(eq(battleSessions.id, session.id))
      .returning();
    return {
      changed: true,
      session: next!,
      events: [
        {
          type: 'cancelled',
          sessionId,
          version: next!.stateVersion,
          audience: 'all',
          data: { reason: opts.reason },
        },
      ],
      timers: [],
    };
  });
}

/** BR-BTL-06: лобби без старта 60 минут, игра без активности 30 минут → cancelled (expired). Раз в минуту (worker). */
export async function expireSessions(db: Database, now = new Date()): Promise<TransitionResult[]> {
  const stale = await db
    .select({ id: battleSessions.id })
    .from(battleSessions)
    .where(
      or(
        and(
          eq(battleSessions.status, 'lobby'),
          lt(battleSessions.createdAt, new Date(now.getTime() - BATTLE_LOBBY_TTL_MS)),
        ),
        and(
          inArray(battleSessions.status, ['lobby', 'in_progress']),
          lt(battleSessions.lastActivityAt, new Date(now.getTime() - BATTLE_IDLE_TTL_MS)),
        ),
      ),
    );
  const results: TransitionResult[] = [];
  for (const s of stale) {
    const res = await cancelSession(db, s.id, { reason: 'expired', now });
    if (res.changed) results.push(res);
  }
  return results;
}

/** Задача очереди battle (worker): таймер закрытия вопроса или автопереход — тот же идемпотентный переход. */
export async function runBattleTimer(db: Database, timer: BattleTimer): Promise<TransitionResult> {
  return timer.name === 'close-question'
    ? closeQuestion(db, timer.data.sessionId, {
        index: timer.data.index,
        expectedVersion: timer.data.version,
      })
    : nextPhase(db, timer.data.sessionId, { expectedVersion: timer.data.version });
}

/** Канал Redis Pub/Sub сессии (BATTLE_TZ 6.4). */
export const battleChannel = (sessionId: string) => `battle:${sessionId}`;

/** Имя очереди BullMQ таймеров Battle (BR-BTL-08). */
export const BATTLE_QUEUE = 'battle';

/** Параметры задачи BullMQ для таймера: повторная постановка того же таймера не создаёт второй задачи. */
export const battleTimerJob = (timer: BattleTimer) => ({
  name: timer.name,
  data: timer,
  opts: {
    delay: timer.delayMs,
    jobId: `${timer.name}-${timer.data.sessionId}-${timer.data.index ?? 'x'}-${timer.data.version}`,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});
