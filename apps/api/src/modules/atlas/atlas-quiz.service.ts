import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  AtlasQuizAnswerDto,
  ATLAS_QUIZ_LENGTH,
  type AtlasQuizKind,
  ELEMENT_QUIZ,
  elementDifficulty,
  type Locale,
  maskElementText,
  nextElementLevel,
  nextScientistLevel,
  nonUniqueDescriptions,
  periodicElement,
  SCIENTIST_QUIZ,
  scientistDescription,
  scientistDifficulty,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { atlasQuizEventKey, GamificationService } from '../gamification/gamification.service';
import { type AtlasPreviewDto, type AtlasQuizAnswerResultDto, type AtlasQuizSessionDto } from './atlas.dto';
import { AtlasService, type AtlasTopicRow, notFound, pick } from './atlas.service';

const { atlasQuizSessions: sessions, learningEvents } = schema;

interface Current {
  item: string;
  level: number;
  options: string[];
}

/** Состояние сессии (atlas_quiz_sessions.state). */
interface QuizState {
  items: string[];
  index: number;
  level: number;
  /** Квиз элементов: окно последних ответов (1 — верно). */
  history: number[];
  /** Игра про учёных: верные и неверные подряд. */
  streak: { correct: number; wrong: number };
  current: Current | null;
  answers: Array<{ item: string; selected: string; correct: boolean }>;
}

type Session = typeof sessions.$inferSelect;

/** Вопрос: ID — тема-элемент или код раздела учёного; текст и названия — на языке запроса. */
interface PoolItem {
  id: string;
  /** Код для ссылки «Рекомендуется повторить»: элемент — код темы, учёный — код раздела. */
  code: string;
  title: string;
  description: string;
  text: (level: number) => string;
}

const conflict = (field: string, code: string) =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Conflict', { [field]: code });

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Квиз «Проверь знания» и игра «Кто этот учёный?» модуля «Mendeleev Atlas» (REQ-ATL-03, решения А-5, А-11). Правила
 * — как в оригинале атласа (packages/shared/src/atlas.ts). Вопросы строит и проверяет сервер: правильный вариант не
 * уходит в браузер до ответа (BR-QZ-01). Сессии — только свои (BR-ACL-03, чужая → 404). Завершение — событие
 * atlas_quiz_finished: XP за верные ответы с дневным лимитом (BR-XP-05) и день серии (BR-ST-02).
 */
@Injectable()
export class AtlasQuizService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly atlas: AtlasService,
    private readonly gamification: GamificationService,
  ) {}

  /** API-S-24: новая сессия. */
  async start(
    studentId: string,
    subjectId: string,
    kind: AtlasQuizKind,
    locale: Locale,
  ): Promise<AtlasQuizSessionDto> {
    await this.atlas.assertAtlas(studentId, subjectId);
    const pool = this.pool(kind, await this.atlas.topics(subjectId), locale);
    if (pool.length < 2) throw conflict('quiz', 'quizEmpty');
    const items = shuffle(pool.map((p) => p.id)).slice(0, Math.min(ATLAS_QUIZ_LENGTH, pool.length));
    const level = kind === 'elements' ? ELEMENT_QUIZ.start : SCIENTIST_QUIZ.start;
    const state: QuizState = {
      items,
      index: 0,
      level,
      history: [],
      streak: { correct: 0, wrong: 0 },
      current: this.makeCurrent(kind, items[0]!, level, pool),
      answers: [],
    };
    const [session] = await this.db
      .insert(sessions)
      .values({ studentId, subjectId, kind, state, total: items.length })
      .returning();
    return this.dto(session!, pool);
  }

  /** API-S-26: состояние своей сессии на языке запроса (обновление страницы, смена языка). */
  async get(studentId: string, sessionId: string, locale: Locale): Promise<AtlasQuizSessionDto> {
    const session = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, session.subjectId);
    return this.dto(
      session,
      this.pool(session.kind as AtlasQuizKind, await this.atlas.topics(session.subjectId), locale),
    );
  }

  /** API-S-25: ответ на текущий вопрос — проверка сразу; следующий вопрос — по адаптивной сложности. */
  async answer(
    studentId: string,
    sessionId: string,
    body: unknown,
    locale: Locale,
  ): Promise<AtlasQuizAnswerResultDto> {
    const owned = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, owned.subjectId);
    const parsed = AtlasQuizAnswerDto.safeParse(body);
    if (!parsed.success)
      throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', {
        optionId: 'required',
      });
    const { optionId } = parsed.data;
    const kind = owned.kind as AtlasQuizKind;
    const pool = this.pool(kind, await this.atlas.topics(owned.subjectId), locale);
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, sessionId);
      const state = session.state as QuizState;
      if (session.status !== 'in_progress' || !state.current) throw conflict('quiz', 'quizFinished');
      const current = state.current;
      if (!current.options.includes(optionId))
        throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', {
          optionId: 'required',
        });
      const correct = optionId === current.item;
      state.answers.push({ item: current.item, selected: optionId, correct });
      if (kind === 'elements') {
        const next = nextElementLevel(state.level, [...state.history, correct ? 1 : 0]);
        state.level = next.level;
        state.history = next.history;
      } else {
        const next = nextScientistLevel(state.level, state.streak, correct);
        state.level = next.level;
        state.streak = next.streak;
      }
      state.index += 1;
      state.current =
        state.index < state.items.length
          ? this.makeCurrent(kind, state.items[state.index]!, state.level, pool)
          : null;
      const [saved] = await tx
        .update(sessions)
        .set({ state, correctCount: session.correctCount + (correct ? 1 : 0) })
        .where(eq(sessions.id, sessionId))
        .returning();
      return {
        correct,
        correctOptionId: current.item,
        next: state.current ? this.question(saved!, state, pool) : null,
      };
    });
  }

  /** API-S-27: завершение после ответа на все вопросы — событие atlas_quiz_finished, XP (BR-XP-05), серия. */
  async finish(studentId: string, sessionId: string, locale: Locale): Promise<AtlasQuizSessionDto> {
    const owned = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, owned.subjectId);
    const pool = this.pool(owned.kind as AtlasQuizKind, await this.atlas.topics(owned.subjectId), locale);
    const finished = await this.db.transaction(async (tx) => {
      const session = await this.lock(tx, sessionId);
      const state = session.state as QuizState;
      if (session.status !== 'in_progress') throw conflict('quiz', 'quizFinished');
      if (state.current) throw conflict('quiz', 'quizNotComplete');
      const now = new Date();
      const [event] = await tx
        .insert(learningEvents)
        .values({
          studentId,
          type: 'atlas_quiz_finished',
          subjectId: session.subjectId,
          topicId: null,
          occurredAt: now,
          idempotencyKey: atlasQuizEventKey(sessionId),
        })
        .returning();
      const { xpAwarded } = await this.gamification.process(
        tx,
        {
          id: event!.id,
          studentId,
          type: 'atlas_quiz_finished',
          topicId: null,
          idempotencyKey: event!.idempotencyKey,
        },
        locale,
      );
      const [saved] = await tx
        .update(sessions)
        .set({ status: 'finished', finishedAt: now, xpAwarded })
        .where(eq(sessions.id, sessionId))
        .returning();
      return saved!;
    });
    return this.dto(finished, pool);
  }

  /**
   * API-T-32 (решение А-9): предпросмотр для учителя — вопросы квиза или игры на среднем уровне, без правильных
   * ответов; ничего не сохраняется. Только базовый предмет с модулем атласа.
   */
  async preview(subjectId: string, kind: AtlasQuizKind, locale: Locale): Promise<AtlasPreviewDto> {
    await this.atlas.assertAtlas(null, subjectId);
    const pool = this.pool(kind, await this.atlas.topics(subjectId), locale);
    const level = kind === 'elements' ? ELEMENT_QUIZ.start : SCIENTIST_QUIZ.start;
    const items = shuffle(pool.map((p) => p.id)).slice(0, Math.min(ATLAS_QUIZ_LENGTH, pool.length));
    const byId = new Map(pool.map((p) => [p.id, p]));
    return {
      questions: items.map((item) => {
        const current = this.makeCurrent(kind, item, level, pool);
        const p = byId.get(item)!;
        return {
          text: p.text(level),
          options: current.options.map((id) => byId.get(id)?.title ?? ''),
          difficulty: kind === 'elements' ? elementDifficulty(level) : scientistDifficulty(level),
          correct: current.options.indexOf(item),
          answer: { code: p.code, title: p.title, description: p.description },
        };
      }),
    };
  }

  /* ---------- Вопросы ---------- */

  /** Пул вопросов на языке запроса: элементы предмета или учёные урока «Учёные-химики». */
  private pool(kind: AtlasQuizKind, rows: AtlasTopicRow[], locale: Locale): PoolItem[] {
    if (kind === 'elements') {
      const elements = AtlasService.elements(rows);
      // Решение владельца 2026-10-28: элементы с неуникальным (шаблонным) описанием в квиз не попадают.
      const skip = nonUniqueDescriptions(
        elements.map((e) => ({
          id: e.id,
          description: pick(e.snapshot.translations, 'ru')?.[1]?.description ?? '',
        })),
      );
      return elements.flatMap((e) => {
        if (skip.has(e.id)) return [];
        const tr = pick(e.snapshot.translations, locale)?.[1];
        if (!tr?.title) return [];
        const symbol = periodicElement(e.elementNumber)?.symbol ?? '';
        const description = tr.description ?? '';
        return [
          {
            id: e.id,
            code: e.code,
            title: tr.title,
            description,
            // Сложный уровень — интересный факт вместо описания (если факта нет — описание, как в оригинале).
            text: (level: number) =>
              maskElementText(level >= 3 && tr.funFact ? tr.funFact : description, tr.title, symbol),
          },
        ];
      });
    }
    const topic = AtlasService.scientists(rows);
    if (!topic) return [];
    const [actual] = pick(topic.snapshot.translations, locale) ?? [locale];
    return topic.snapshot.sections
      .sort((a, b) => a.position - b.position)
      .flatMap((s) => {
        const tr = s.translations[actual] ?? s.translations.ru;
        const description = scientistDescription(tr?.body);
        const code = (s.code ?? '').split('#').pop() ?? s.id;
        if (!tr || !description) return [];
        return [
          {
            id: code,
            code,
            title: tr.title,
            description,
            text: () => description,
          },
        ];
      });
  }

  /** Варианты: верный + отвлекающие из пула; лёгкий уровень — 2 варианта, остальные — 4. */
  private makeCurrent(kind: AtlasQuizKind, item: string, level: number, pool: PoolItem[]): Current {
    const easy = kind === 'elements' ? level <= 1 : level <= 0;
    const distractors = shuffle(pool.filter((p) => p.id !== item).map((p) => p.id)).slice(0, easy ? 1 : 3);
    return { item, level, options: shuffle([item, ...distractors]) };
  }

  private question(session: Session, state: QuizState, pool: PoolItem[]) {
    const current = state.current!;
    const byId = new Map(pool.map((p) => [p.id, p]));
    const kind = session.kind as AtlasQuizKind;
    return {
      index: state.index + 1,
      difficulty: kind === 'elements' ? elementDifficulty(current.level) : scientistDifficulty(current.level),
      text: byId.get(current.item)?.text(current.level) ?? '',
      options: current.options.map((id) => ({ id, title: byId.get(id)?.title ?? '' })),
    };
  }

  private dto(session: Session, pool: PoolItem[]): AtlasQuizSessionDto {
    const state = session.state as QuizState;
    const byId = new Map(pool.map((p) => [p.id, p]));
    const wrong = [...new Set(state.answers.filter((a) => !a.correct).map((a) => a.item))];
    return {
      id: session.id,
      kind: session.kind as AtlasQuizKind,
      status: session.status as 'in_progress' | 'finished',
      total: session.total,
      answered: state.answers.length,
      correct: session.correctCount,
      question:
        state.current && session.status === 'in_progress' ? this.question(session, state, pool) : null,
      result:
        session.status === 'finished'
          ? {
              correct: session.correctCount,
              total: session.total,
              percent: Math.round((100 * session.correctCount) / Math.max(1, session.total)),
              xpAwarded: session.xpAwarded,
              mistakes: wrong.flatMap((id) => {
                const p = byId.get(id);
                return p ? [{ code: p.code, title: p.title, description: p.description }] : [];
              }),
            }
          : null,
    };
  }

  private async own(studentId: string, sessionId: string): Promise<Session> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.studentId, studentId)));
    if (!session) throw notFound();
    return session;
  }

  private async lock(tx: Tx, sessionId: string): Promise<Session> {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
    if (!session) throw notFound();
    return session;
  }
}
