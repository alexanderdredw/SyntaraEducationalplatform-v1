import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { type Response } from 'express';
import Redis from 'ioredis';
import { type Database, schema } from '@syntara/db';
import { battleChannel, type BattleWireEvent, type Standing } from '@syntara/db/battle';
import { DB, REDIS } from '../../infra/tokens';
import { StorageService } from '../files/storage.service';
import { finalView, hostReveal, leaderboardView, type RevealData, studentReveal } from './battle-views';

/** Heartbeat SSE (6.9) и отметка «на связи» участника (BR-BTL-03). */
export const BATTLE_HEARTBEAT_MS = 15_000;
/** BATTLE_TZ 6.4: соединения закрываются через 60 с после finished / cancelled. */
const CLOSE_AFTER_END_MS = 60_000;
/** Не больше 2 одновременных потоков на пользователя в одной сессии (лишние закрываются, старейший первым). */
const MAX_STREAMS_PER_USER = 2;

export interface BattleConnection {
  sessionId: string;
  role: 'host' | 'student';
  userId: string;
  /** Сессия входа — поток закрывается после выхода из аккаунта. */
  authSessionId: string;
  participantId: string | null;
  res: Response;
  seq: number;
  openedAt: number;
}

/**
 * Слой реального времени Battle (BATTLE_TZ 6.4, SPEC 6.9): публикация через Redis `PUBLISH battle:{id}`,
 * одна подписка `PSUBSCRIBE battle:*` на экземпляр api, раздача своим SSE-соединениям по сессии и аудитории.
 * Персональные данные ученика формируются здесь, на экземпляре, держащем его соединение. Замена транспорта
 * (например, на WebSocket) затрагивает только этот класс.
 */
@Injectable()
export class BattleRealtime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BattleRealtime.name);
  private readonly connections = new Map<string, Set<BattleConnection>>();
  private subscriber: Redis | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate({ lazyConnect: true });
    this.subscriber.on('error', (err: Error) => this.logger.warn(`battle subscriber: ${err.message}`));
    this.subscriber.on('pmessage', (_pattern: string, _channel: string, message: string) => {
      void this.deliver(JSON.parse(message) as BattleWireEvent).catch((err: Error) =>
        this.logger.warn(`battle delivery failed: ${err.message}`),
      );
    });
    try {
      await this.subscriber.connect();
      await this.subscriber.psubscribe('battle:*');
    } catch (err) {
      this.logger.warn(`battle subscribe failed: ${(err as Error).message}`);
    }
    this.heartbeat = setInterval(() => void this.beat(), BATTLE_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const set of this.connections.values()) for (const c of set) c.res.end();
    this.connections.clear();
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Публикует события всем экземплярам api; без Redis — доставляет локально (один экземпляр продолжает работать). */
  async publish(events: BattleWireEvent[]): Promise<void> {
    for (const event of events) {
      try {
        if (this.redis.status === 'wait') await this.redis.connect();
        await this.redis.publish(battleChannel(event.sessionId), JSON.stringify(event));
      } catch {
        await this.deliver(event);
      }
    }
  }

  /** Открывает SSE-поток: заголовки, первое событие `snapshot`, регистрация соединения. */
  open(conn: Omit<BattleConnection, 'seq' | 'openedAt'>, snapshot: { version: number; data: unknown }): void {
    const { res } = conn;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const full: BattleConnection = { ...conn, seq: 0, openedAt: Date.now() };
    const set = this.connections.get(conn.sessionId) ?? new Set<BattleConnection>();
    this.connections.set(conn.sessionId, set);
    const mine = [...set].filter((c) => c.userId === conn.userId).sort((a, b) => a.openedAt - b.openedAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_STREAMS_PER_USER + 1))) this.close(old);
    set.add(full);
    res.on('close', () => this.forget(full));
    this.write(full, 'snapshot', snapshot.version, snapshot.data);
  }

  /** Число открытых потоков сессии на этом экземпляре (для тестов и отладки). */
  streams(sessionId: string): number {
    return this.connections.get(sessionId)?.size ?? 0;
  }

  private write(conn: BattleConnection, type: string, version: number, data: unknown): void {
    conn.seq += 1;
    conn.res.write(`id: ${version}-${conn.seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private close(conn: BattleConnection): void {
    this.forget(conn);
    conn.res.end();
  }

  private forget(conn: BattleConnection): void {
    const set = this.connections.get(conn.sessionId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.connections.delete(conn.sessionId);
  }

  /** Раздача события своим соединениям с учётом аудитории и роли. */
  private async deliver(event: BattleWireEvent): Promise<void> {
    const set = this.connections.get(event.sessionId);
    if (!set || set.size === 0) return;
    const shared = await this.prepare(event);
    for (const conn of [...set]) {
      if (!this.addressed(event, conn)) continue;
      const data = this.shape(event, shared, conn);
      if (data === undefined) continue;
      this.write(conn, event.type, event.version, data);
      if (event.type === 'kicked') this.close(conn);
    }
    if (event.type === 'finished' || event.type === 'cancelled') {
      setTimeout(() => {
        for (const conn of [...(this.connections.get(event.sessionId) ?? [])]) this.close(conn);
      }, CLOSE_AFTER_END_MS).unref();
    }
  }

  private addressed(event: BattleWireEvent, conn: BattleConnection): boolean {
    if (event.audience === 'all') return true;
    if (event.audience === 'host') return conn.role === 'host';
    if (event.audience === 'students') return conn.role === 'student';
    return conn.role === 'student' && event.audience === `participant:${conn.participantId}`;
  }

  /** Общая для всех соединений часть: подписанная ссылка картинки вопроса (BR-FILE-04, только clean). */
  private async prepare(event: BattleWireEvent): Promise<{ imageUrl: string | null }> {
    if (event.type !== 'question_started') return { imageUrl: null };
    return { imageUrl: await this.imageUrl((event.data.imageMediaId as string | null) ?? null) };
  }

  async imageUrl(mediaId: string | null): Promise<string | null> {
    if (!mediaId) return null;
    const [media] = await this.db
      .select({ key: schema.mediaFiles.storageKey, status: schema.mediaFiles.scanStatus })
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.id, mediaId));
    return media?.status === 'clean' ? this.storage.downloadUrl(media.key) : null;
  }

  private shape(
    event: BattleWireEvent,
    shared: { imageUrl: string | null },
    conn: BattleConnection,
  ): unknown {
    const host = conn.role === 'host';
    const d = event.data;
    switch (event.type) {
      case 'participant_joined':
      case 'participant_left':
      case 'participant_kicked':
        return host ? d : { participantsCount: d.participantsCount };
      case 'question_started': {
        const { imageMediaId: _media, ...rest } = d;
        return { version: event.version, ...rest, imageUrl: shared.imageUrl };
      }
      case 'question_revealed':
        return host
          ? hostReveal(d as unknown as RevealData)
          : studentReveal(d as unknown as RevealData, conn.participantId ?? '');
      case 'leaderboard':
        return leaderboardView(
          d.index as number,
          d.standings as Standing[],
          host ? undefined : conn.participantId,
        );
      case 'finished':
        return finalView(
          d.standings as Standing[],
          d.questionsCount as number,
          host ? undefined : conn.participantId,
        );
      default:
        return d;
    }
  }

  /** Каждые 15 с: `: ping`, отметка «на связи» участника, закрытие потоков вышедших из аккаунта. */
  private async beat(): Promise<void> {
    const all = [...this.connections.values()].flatMap((set) => [...set]);
    if (all.length === 0) return;
    const now = new Date();
    for (const conn of all) conn.res.write(': ping\n\n');
    const participants = all.filter((c) => c.participantId).map((c) => c.participantId!);
    try {
      for (const id of new Set(participants)) {
        await this.db
          .update(schema.battleParticipants)
          .set({ lastSeenAt: now })
          .where(eq(schema.battleParticipants.id, id));
      }
      const { authSessions } = schema;
      for (const conn of all) {
        const [alive] = await this.db
          .select({ id: authSessions.id })
          .from(authSessions)
          .where(
            and(
              eq(authSessions.id, conn.authSessionId),
              isNull(authSessions.revokedAt),
              gt(authSessions.expiresAt, now),
            ),
          );
        if (!alive) this.close(conn);
      }
    } catch (err) {
      this.logger.warn(`battle heartbeat: ${(err as Error).message}`);
    }
  }
}
