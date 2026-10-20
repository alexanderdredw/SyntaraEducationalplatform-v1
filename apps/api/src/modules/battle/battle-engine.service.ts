import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';
import {
  activeParticipantIds,
  BATTLE_QUEUE,
  battleTimerJob,
  type BattleTimer,
  type BattleWireEvent,
  cancelSession,
  closeQuestion,
  finishSession,
  nextPhase,
  startSession,
  type TransitionResult,
} from '@syntara/db/battle';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';
import { BattleRealtime } from './battle-realtime.gateway';

/**
 * BattleEngine (BR-BTL-08): единственная точка api, где меняется фаза игры. Переходы выполняет общая реализация
 * `@syntara/db/battle` (её же вызывает worker по таймерам); здесь — публикация событий и постановка таймеров
 * в очередь BullMQ `battle` (закрытие вопроса на дедлайн + 500 мс, автопереход).
 */
@Injectable()
export class BattleEngine implements OnModuleDestroy {
  private readonly logger = new Logger(BattleEngine.name);
  private readonly queueConnection: Redis;
  private queueInstance?: Queue;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) env: Env,
    private readonly realtime: BattleRealtime,
  ) {
    // BullMQ: отдельное соединение с maxRetriesPerRequest = null.
    this.queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    this.queueConnection.on('error', () => undefined);
  }

  /**
   * Очередь создаётся при первом таймере: процесс, который не ставит таймеры (например, `pnpm openapi` с фиктивным
   * Redis), не открывает соединение — иначе отказ подключения после close() падает необработанным 'error'.
   */
  private get queue(): Queue {
    if (!this.queueInstance) {
      this.queueInstance = new Queue(BATTLE_QUEUE, { connection: this.queueConnection });
      this.queueInstance.on('error', () => undefined);
    }
    return this.queueInstance;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueInstance?.close().catch(() => undefined);
    await this.queueConnection.quit().catch(() => undefined);
  }

  start(sessionId: string, expectedVersion?: number) {
    return this.apply(startSession(this.db, sessionId, { expectedVersion }));
  }
  close(sessionId: string, expectedVersion?: number, index?: number) {
    return this.apply(closeQuestion(this.db, sessionId, { expectedVersion, index }));
  }
  next(sessionId: string, expectedVersion?: number) {
    return this.apply(nextPhase(this.db, sessionId, { expectedVersion }));
  }
  finish(sessionId: string, expectedVersion?: number) {
    return this.apply(finishSession(this.db, sessionId, { expectedVersion }));
  }
  cancel(sessionId: string, expectedVersion?: number) {
    return this.apply(cancelSession(this.db, sessionId, { expectedVersion, reason: 'host' }));
  }

  /** События вне переходов (вход, выход, выгон, ответ) — те же каналы. */
  publish(events: BattleWireEvent[]): Promise<void> {
    return this.realtime.publish(events);
  }

  /**
   * BR-BTL-03: вопрос закрывается досрочно, когда ответили все активные участники. Счётчик ответов — Redis INCR
   * (`answered`), число активных — по БД; переход идемпотентен, поэтому гонка двух последних ответов безопасна.
   */
  async closeIfAllAnswered(sessionId: string, index: number, answered: number): Promise<void> {
    const active = await activeParticipantIds(this.db, sessionId);
    if (active.length === 0 || answered < active.length) return;
    // Счётчик Redis мог учесть ответ выгнанного или вышедшего — подтверждаем по БД.
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.battleAnswers)
      .where(
        and(
          eq(schema.battleAnswers.sessionId, sessionId),
          eq(schema.battleAnswers.questionIndex, index),
          inArray(schema.battleAnswers.participantId, active),
        ),
      );
    if ((row?.n ?? 0) >= active.length) await this.close(sessionId, undefined, index);
  }

  private async apply(pending: Promise<TransitionResult>): Promise<TransitionResult> {
    const result = await pending;
    if (!result.changed) return result;
    await this.realtime.publish(result.events);
    await this.schedule(result.timers);
    return result;
  }

  private async schedule(timers: BattleTimer[]): Promise<void> {
    for (const timer of timers) {
      try {
        const job = battleTimerJob(timer);
        await this.queue.add(job.name, job.data, job.opts);
      } catch (err) {
        this.logger.warn(`battle timer not scheduled: ${(err as Error).message}`);
      }
    }
  }
}

/** Ключ Redis — счётчик ответов на вопрос (BR-BTL-03). */
export const answeredKey = (sessionId: string, index: number) => `battle:answered:${sessionId}:${index}`;
