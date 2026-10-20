import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  type BattleConfig,
  type BattleHistoryQuery,
  type BattleSessionCreateDto,
  getMessage,
  type Locale,
  type Messages,
} from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Database, schema } from '@syntara/db';
import { type BattleSnapshotQuestion, type TransitionResult } from '@syntara/db/battle';
import { ApiException } from '../../common/api-exception';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { cursorCondition, newestFirst, page } from '../support/pagination';
import { generateBattleCode, shuffled } from './battle-code';
import { BattleEngine } from './battle-engine.service';
import { BattleStateService } from './battle-state.service';

const { battleQuizzes, battleQuestions, battleOptions, battleSessions, battleParticipants, classes } = schema;
const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/** BR-BTL-05: не больше 3 активных сессий у учителя. */
export const BATTLE_MAX_ACTIVE_SESSIONS = 3;
/** BR-BTL-01: повторы генерации кода при коллизии. */
const CODE_ATTEMPTS = 10;

export const battleError = (status: number, key: string, snapshot?: unknown) =>
  new ApiException(
    status,
    status === HttpStatus.NOT_FOUND
      ? 'NOT_FOUND'
      : status === HttpStatus.UNPROCESSABLE_ENTITY
        ? 'UNPROCESSABLE'
        : status === HttpStatus.SERVICE_UNAVAILABLE
          ? 'SERVICE_UNAVAILABLE'
          : status === HttpStatus.CONFLICT && key === 'invalidTransition'
            ? 'INVALID_TRANSITION'
            : 'CONFLICT',
    `Battle: ${key}`,
    { battle: key },
    undefined,
    snapshot,
  );

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === '23505';
};

/**
 * Игровые сессии ведущего (SPEC 6.8 API-BTL-20…31, BR-BTL-01/05/07, SM-BTL). Сессия — только ведущему
 * (OwnershipGuard `battleSession`, иначе 404). Переходы — через BattleEngine (BR-BTL-08).
 */
@Injectable()
export class BattleSessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly engine: BattleEngine,
    private readonly state: BattleStateService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** API-BTL-20: снимок вопросов замораживается при запуске (BR-BTL-05). */
  async create(
    hostId: string,
    quizId: string,
    dto: BattleSessionCreateDto,
  ): Promise<{ sessionId: string; code: string }> {
    const [cls] = await this.db
      .select({ id: classes.id, schoolId: classes.schoolId })
      .from(classes)
      .where(and(eq(classes.id, dto.classId), eq(classes.teacherId, hostId), isNull(classes.archivedAt)));
    if (!cls) throw battleError(HttpStatus.NOT_FOUND, 'classNotFound');
    const questions = await this.db
      .select()
      .from(battleQuestions)
      .where(and(eq(battleQuestions.battleQuizId, quizId), isNull(battleQuestions.archivedAt)))
      .orderBy(asc(battleQuestions.position));
    if (questions.length === 0) throw battleError(HttpStatus.UNPROCESSABLE_ENTITY, 'noQuestions');
    const options = await this.db
      .select()
      .from(battleOptions)
      .where(
        inArray(
          battleOptions.battleQuestionId,
          questions.map((q) => q.id),
        ),
      )
      .orderBy(asc(battleOptions.position));
    if (questions.some((q) => options.filter((o) => o.battleQuestionId === q.id && o.isCorrect).length !== 1))
      throw battleError(HttpStatus.UNPROCESSABLE_ENTITY, 'noCorrectOption');
    const [active] = await this.db
      .select({ n: count() })
      .from(battleSessions)
      .where(
        and(eq(battleSessions.hostId, hostId), inArray(battleSessions.status, ['lobby', 'in_progress'])),
      );
    if (Number(active?.n ?? 0) >= BATTLE_MAX_ACTIVE_SESSIONS)
      throw battleError(HttpStatus.CONFLICT, 'tooManyActiveSessions');

    const battle = await this.config.get<BattleConfig>('battle');
    const settings = {
      ...dto.settings,
      maxParticipants: Math.min(dto.settings.maxParticipants, battle.max_participants),
    };
    // Один порядок для всех участников; цвета и фигуры привязаны к позиции (SPEC 7.12).
    const ordered = settings.shuffleQuestions ? shuffled(questions) : questions;
    const snapshot: BattleSnapshotQuestion[] = ordered.map((q, index) => {
      const own = options.filter((o) => o.battleQuestionId === q.id);
      const opts = settings.shuffleOptions && q.type === 'single_choice' ? shuffled(own) : own;
      return {
        index,
        type: q.type as 'single_choice' | 'true_false',
        text: q.text,
        imageMediaId: q.imageMediaId,
        timeLimitSec: q.timeLimitSec,
        options: opts.map((o, i) => ({ position: i + 1, text: o.text, isCorrect: o.isCorrect })),
      };
    });

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = generateBattleCode(battle.code);
      try {
        return await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(battleSessions)
            .values({
              battleQuizId: quizId,
              hostId,
              classId: cls.id,
              code,
              settings,
              questionsSnapshot: snapshot,
            })
            .returning({ id: battleSessions.id });
          await this.audit.record(
            {
              actorId: hostId,
              schoolId: cls.schoolId,
              entityType: 'battle_session',
              entityId: row!.id,
              action: 'battle_session.created',
              after: { battleQuizId: quizId, classId: cls.id, questions: snapshot.length },
            },
            tx,
          );
          return { sessionId: row!.id, code };
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw battleError(HttpStatus.SERVICE_UNAVAILABLE, 'codeUnavailable');
  }

  /** API-BTL-23…27: переход; версия не совпала — 409 staleState со свежим снимком. */
  async transition(
    hostId: string,
    sessionId: string,
    kind: 'start' | 'close' | 'next' | 'finish' | 'cancel',
    expectedVersion: number,
  ) {
    const run: Record<typeof kind, () => Promise<TransitionResult>> = {
      start: () => this.engine.start(sessionId, expectedVersion),
      close: () => this.engine.close(sessionId, expectedVersion),
      next: () => this.engine.next(sessionId, expectedVersion),
      finish: () => this.engine.finish(sessionId, expectedVersion),
      cancel: () => this.engine.cancel(sessionId, expectedVersion),
    };
    const result = await run[kind]();
    if (result.reason === 'staleState')
      throw battleError(HttpStatus.CONFLICT, 'staleState', await this.state.host(sessionId));
    if (result.reason === 'noParticipants')
      throw battleError(HttpStatus.UNPROCESSABLE_ENTITY, 'noParticipants');
    if (result.reason)
      throw battleError(HttpStatus.CONFLICT, 'invalidTransition', await this.state.host(sessionId));
    if (kind === 'start' || kind === 'finish' || kind === 'cancel') {
      await this.audit.record({
        actorId: hostId,
        entityType: 'battle_session',
        entityId: sessionId,
        action: `battle_session.${kind === 'start' ? 'started' : kind === 'finish' ? 'finished' : 'cancelled'}`,
      });
    }
    return this.state.host(sessionId);
  }

  /** API-BTL-28: выгнанный не возвращается и не входит в рейтинг (BR-BTL-07). */
  async kick(hostId: string, sessionId: string, participantId: string) {
    const [p] = await this.db
      .update(battleParticipants)
      .set({ kickedAt: new Date() })
      .where(
        and(
          eq(battleParticipants.id, participantId),
          eq(battleParticipants.sessionId, sessionId),
          isNull(battleParticipants.kickedAt),
        ),
      )
      .returning();
    if (!p) throw battleError(HttpStatus.NOT_FOUND, 'participantNotFound');
    await this.audit.record({
      actorId: hostId,
      entityType: 'battle_session',
      entityId: sessionId,
      action: 'battle_session.participant_kicked',
      after: { participantId },
    });
    const snapshot = await this.state.host(sessionId);
    await this.engine.publish([
      {
        type: 'participant_kicked',
        sessionId,
        version: snapshot.version,
        audience: 'all',
        data: {
          participant: {
            id: p.id,
            displayName: p.displayName,
            joinedAt: p.joinedAt.toISOString(),
            left: true,
          },
          participantsCount: snapshot.participantsCount,
        },
      },
      { type: 'kicked', sessionId, version: snapshot.version, audience: `participant:${p.id}`, data: {} },
    ]);
    // Выгнанный больше не считается — возможно, теперь ответили все (BR-BTL-03).
    if (snapshot.phase === 'question' && snapshot.question)
      await this.engine.closeIfAllAnswered(sessionId, snapshot.question.index, snapshot.answered);
    return this.state.host(sessionId);
  }

  /** API-BTL-29 */
  async history(hostId: string, query: BattleHistoryQuery) {
    const rows = await this.db
      .select({
        id: battleSessions.id,
        createdAt: battleSessions.createdAt,
        battleTitle: battleQuizzes.title,
        className: classes.name,
        status: battleSessions.status,
        questionsCount: sql<number>`jsonb_array_length(${battleSessions.questionsSnapshot})`,
        participantsCount: sql<number>`(select count(*)::int from battle_participants p where p.session_id = ${battleSessions.id} and p.kicked_at is null)`,
        startedAt: battleSessions.startedAt,
        finishedAt: battleSessions.finishedAt,
      })
      .from(battleSessions)
      .innerJoin(battleQuizzes, eq(battleQuizzes.id, battleSessions.battleQuizId))
      .innerJoin(classes, eq(classes.id, battleSessions.classId))
      .where(
        and(
          eq(battleSessions.hostId, hostId),
          query.battleId ? eq(battleSessions.battleQuizId, query.battleId) : undefined,
          query.classId ? eq(battleSessions.classId, query.classId) : undefined,
          cursorCondition(query.cursor, battleSessions.createdAt, battleSessions.id),
        ),
      )
      .orderBy(...newestFirst(battleSessions.createdAt, battleSessions.id))
      .limit(query.limit + 1);
    const result = page(rows, query.limit);
    return {
      items: result.rows.map(({ createdAt: _c, startedAt, finishedAt, ...r }) => ({
        ...r,
        startedAt: startedAt?.toISOString() ?? null,
        finishedAt: finishedAt?.toISOString() ?? null,
      })),
      nextCursor: result.nextCursor,
    };
  }

  /** API-BTL-31: UTF-8 с BOM, разделитель «;» (открывается в Excel). Заголовки — на языке интерфейса. */
  async csv(sessionId: string, locale: Locale): Promise<string> {
    const results = await this.state.results(sessionId);
    const t = (key: string) => getMessage(BUNDLES[locale], `battle.csv.${key}`) ?? key;
    const cell = (v: string | number) => {
      const s = String(v);
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const letters = ['A', 'B', 'C', 'D'];
    const header = [
      t('rank'),
      t('student'),
      t('correct'),
      t('answered'),
      t('time'),
      ...results.questions.map((q) => t('question').replace('{number}', String(q.index + 1))),
    ];
    const lines = results.students.map((s, i) => {
      const row = results.table[i]!;
      return [
        s.rank,
        s.displayName,
        row.correctCount,
        row.answeredCount,
        (row.correctTimeMs / 1000).toFixed(1).replace('.', ','),
        ...s.answers.map((a) =>
          a.optionPosition ? `${letters[a.optionPosition - 1]}${a.isCorrect ? ' ✓' : ''}` : '',
        ),
      ];
    });
    const bom = String.fromCharCode(0xfeff);
    return `${bom}${[header, ...lines].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
  }
}
