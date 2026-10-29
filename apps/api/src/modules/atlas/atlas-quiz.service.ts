import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import {
  AtlasQuizAnswerDto,
  answerKind,
  ATLAS_QUIZ_LENGTH,
  type AtlasQuestionSpec,
  type AtlasQuestionType,
  type AtlasQuizKind,
  type AtlasQuizMode,
  buildQuestion,
  checkSymbol,
  ELECTRON_SHELLS,
  ELEMENT_QUIZ,
  electronConfig,
  type ElementFamily,
  elementDifficulty,
  elementQuizText,
  familiesWithLessons,
  getMessage,
  HINT_LIMIT,
  hintAllowed,
  type Locale,
  type Messages,
  MISTAKES_MODE_SESSIONS,
  nextElementLevel,
  nextScientistLevel,
  nonUniqueDescriptions,
  periodicElement,
  pickHintRemovals,
  pickQuestionType,
  pickScientistDistractors,
  type QuizElement,
  SCIENTIST_QUIZ,
  scientistDescription,
  scientistDifficulty,
  tableHintPeriods,
  typeAvailable,
  withAnswer,
} from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { atlasQuizEventKey, GamificationService } from '../gamification/gamification.service';
import {
  type AtlasAnswerInfoDto,
  type AtlasHintResultDto,
  type AtlasPreviewDto,
  type AtlasQuizAnswerResultDto,
  type AtlasQuizQuestionDto,
  type AtlasQuizSessionDto,
} from './atlas.dto';
import { AtlasService, type AtlasTopicRow, notFound, pick } from './atlas.service';

const { atlasQuizSessions: sessions, learningEvents } = schema;
const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/**
 * Текущий вопрос сессии. До T2 (docs/TESTS_TZ.md) — только выбор элемента по описанию: без `type` и `answer`
 * (правильный — `item`). REQ-TST-10: тип, правильный ответ, вид, утверждение; «50/50» — убранные варианты или, у
 * таблицы, подсвеченные периоды (`rows`).
 */
interface Current extends Partial<Omit<AtlasQuestionSpec, 'item' | 'options'>> {
  item: string;
  level: number;
  options: string[];
  /** REQ-TST-04: варианты, убранные подсказкой «50/50». */
  removed?: string[];
  /** REQ-TST-10.3: «50/50» у `table-click` — два подсвеченных периода. */
  rows?: number[];
}

interface Answered {
  item: string;
  selected: string;
  correct: boolean;
  hinted?: boolean;
  level?: number;
  /** REQ-TST-10: вопрос, как он был задан (текст ошибки в результате). */
  question?: Current;
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
  answers: Answered[];
  /** REQ-TST-04: сколько подсказок «50/50» взято (до T1 — нет). */
  hintsUsed?: number;
  /** REQ-TST-11: режим квиза (до T2 — нет, как «Быстрый»). */
  mode?: AtlasQuizMode;
  family?: ElementFamily;
}

type Session = typeof sessions.$inferSelect;

/** Вопрос: ID — тема-элемент или код раздела учёного; текст и названия — на языке запроса. */
interface PoolItem {
  id: string;
  /** Код для ссылки «Открыть урок»: элемент — код темы, учёный — код раздела. */
  code: string;
  title: string;
  description: string;
  /** Текст вопроса на уровне; null — не удаётся надёжно замаскировать (BR-TST-03), на этом уровне не спрашивается. */
  text: (level: number) => string | null;
  /** REQ-TST-10 `description`: описание, если оно уникально и маскируется (решение владельца 2026-10-28, BR-TST-03). */
  maskedDescription?: string | null;
  /** REQ-TST-10 `fun-fact`: только интересный факт (без замены описанием). */
  maskedFact?: string | null;
  /** Элемент: данные таблицы — варианты (BR-TST-02), новые типы вопросов, объяснение и семейства. */
  element?: QuizElement & { family: ElementFamily };
  /** Учёный: год открытия по ленте урока — эпоха для сложного уровня (REQ-TST-07.4). */
  year?: number | null;
}

const conflict = (field: string, code: string) =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Conflict', { [field]: code });
const invalid = (field: string) =>
  new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', { [field]: 'required' });

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const percentOf = (correct: number, total: number) => Math.round((100 * correct) / Math.max(1, total));

/** Текст из i18n на языке запроса (RU — запасной) с подстановкой {параметров}. */
function message(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const text = getMessage(BUNDLES[locale], key) ?? getMessage(BUNDLES.ru, key) ?? key;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => String(params[name] ?? all));
}

/** «Быстрый» — 10 вопросов; «По семейству» — элементы семейства по кругу до 10, без одного и того же подряд. */
function fill(ids: string[], length: number): string[] {
  const out: string[] = [];
  while (out.length < length && ids.length) {
    for (const id of shuffle(ids)) {
      if (out.length >= length) break;
      if (out.at(-1) === id) continue;
      out.push(id);
    }
  }
  return out;
}

/**
 * Квиз «Проверь знания» и игра «Кто этот учёный?» модуля «Mendeleev Atlas» (REQ-ATL-03, решения А-5, А-11). Правила
 * — как в оригинале атласа (packages/shared/src/atlas.ts). Вопросы строит и проверяет сервер: правильный вариант не
 * уходит в браузер до ответа (BR-QZ-01). Сессии — только свои (BR-ACL-03, чужая → 404). Завершение — событие
 * atlas_quiz_finished: XP за верные ответы с дневным лимитом (BR-XP-05) и день серии (BR-ST-02). Подсказка «50/50»
 * (REQ-TST-04) — решает и записывает сервер; верный ответ с ней весит для XP 0,5 (BR-TST-01). Квиз элементов (T2):
 * 9 типов вопросов по уровню с чередованием (REQ-TST-10) и режимы «Быстрый», «По семейству», «Работа над ошибками»,
 * «Таблица-челлендж» (REQ-TST-11).
 */
@Injectable()
export class AtlasQuizService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly atlas: AtlasService,
    private readonly gamification: GamificationService,
  ) {}

  /**
   * API-S-24: новая сессия. `retry` — «Повторить ошибки» (REQ-TST-05.4): своя завершённая сессия того же вида,
   * вопросы — только по элементам (учёным), в которых были ошибки. `mode` (REQ-TST-11) — только у квиза элементов.
   */
  async start(
    studentId: string,
    subjectId: string,
    kind: AtlasQuizKind,
    locale: Locale,
    retry?: string,
    mode: AtlasQuizMode = 'quick',
    family?: ElementFamily,
  ): Promise<AtlasQuizSessionDto> {
    await this.atlas.assertAtlas(studentId, subjectId);
    const pool = this.pool(kind, await this.atlas.topics(subjectId), locale);
    if (pool.length < 2) throw conflict('quiz', 'quizEmpty');
    const known = new Set(pool.map((p) => p.id));
    let items: string[];
    let stateMode: AtlasQuizMode = kind === 'elements' ? mode : 'quick';
    if (retry) {
      const source = await this.own(studentId, retry);
      if (source.subjectId !== subjectId || source.kind !== kind || source.status !== 'finished')
        throw notFound();
      const prior = source.state as QuizState;
      const wrong = [...new Set(prior.answers.filter((a) => !a.correct).map((a) => a.item))];
      items = shuffle(wrong.filter((id) => known.has(id)));
      if (items.length === 0) throw conflict('quiz', 'quizEmpty');
      // Ошибки «Таблицы-челленджа» повторяются на таблице, остальные — смешанными типами.
      stateMode = prior.mode === 'table' ? 'table' : 'quick';
    } else if (stateMode === 'family') {
      const families = familiesWithLessons(pool.flatMap((p) => (p.element ? [p.element.family] : [])));
      if (!family || !families.includes(family)) throw invalid('family');
      items = fill(
        pool.filter((p) => p.element?.family === family).map((p) => p.id),
        ATLAS_QUIZ_LENGTH,
      );
    } else if (stateMode === 'mistakes') {
      items = shuffle(await this.recentMistakes(studentId, subjectId, known)).slice(0, ATLAS_QUIZ_LENGTH);
      if (items.length === 0) throw conflict('quiz', 'noMistakes');
    } else {
      items = shuffle(pool.map((p) => p.id)).slice(0, Math.min(ATLAS_QUIZ_LENGTH, pool.length));
    }
    const level = kind === 'elements' ? ELEMENT_QUIZ.start : SCIENTIST_QUIZ.start;
    const state: QuizState = {
      items,
      index: 0,
      level,
      history: [],
      streak: { correct: 0, wrong: 0 },
      current: null,
      answers: [],
      hintsUsed: 0,
      mode: stateMode,
      ...(stateMode === 'family' && family ? { family } : {}),
    };
    state.current = this.current(kind, state, pool);
    const [session] = await this.db
      .insert(sessions)
      .values({ studentId, subjectId, kind, state, total: items.length })
      .returning();
    return this.dto(session!, pool, locale);
  }

  /** API-S-26: состояние своей сессии на языке запроса (обновление страницы, смена языка). */
  async get(studentId: string, sessionId: string, locale: Locale): Promise<AtlasQuizSessionDto> {
    const session = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, session.subjectId);
    const pool = this.pool(session.kind as AtlasQuizKind, await this.atlas.topics(session.subjectId), locale);
    return this.dto(session, pool, locale, await this.compare(this.db, session));
  }

  /**
   * API-S-29 (REQ-TST-04, BR-TST-01): подсказка «50/50» к текущему вопросу — сервер убирает два случайных неверных
   * варианта и записывает это в сессию. Одна на вопрос (повторный запрос — та же), не больше трёх на сессию; только
   * у вопросов с 4 вариантами. У `table-click` — подсветка двух периодов вместо удаления вариантов (REQ-TST-10.3).
   */
  async hint(studentId: string, sessionId: string): Promise<AtlasHintResultDto> {
    const owned = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, owned.subjectId);
    const pool =
      owned.kind === 'elements' ? this.pool('elements', await this.atlas.topics(owned.subjectId), 'ru') : [];
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, sessionId);
      const state = session.state as QuizState;
      if (session.status !== 'in_progress' || !state.current) throw conflict('quiz', 'quizFinished');
      const used = state.hintsUsed ?? 0;
      const current = state.current;
      const left = () => Math.max(0, HINT_LIMIT - (state.hintsUsed ?? 0));
      if (current.removed || current.rows)
        return { removedOptionIds: current.removed ?? [], rows: current.rows ?? [], hintsLeft: left() };
      if (used >= HINT_LIMIT) throw conflict('hint', 'hintLimit');
      if (current.type === 'table-click') {
        const period = pool.find((p) => p.id === current.item)?.element?.period;
        if (!period) throw conflict('hint', 'hintUnavailable');
        current.rows = tableHintPeriods(
          period,
          pool.flatMap((p) => (p.element ? [p.element.period] : [])),
          randomInt,
        );
      } else {
        const choice = current.type === undefined || answerKind(current.type) === 'choice';
        if (!choice || !hintAllowed('single_choice', current.options.length, used))
          throw conflict('hint', 'hintUnavailable');
        current.removed = pickHintRemovals(current.options, current.answer ?? current.item, randomInt);
      }
      state.hintsUsed = used + 1;
      await tx.update(sessions).set({ state }).where(eq(sessions.id, sessionId));
      return { removedOptionIds: current.removed ?? [], rows: current.rows ?? [], hintsLeft: left() };
    });
  }

  /**
   * API-S-25: ответ на текущий вопрос — проверка сразу; следующий вопрос — по адаптивной сложности. Вариант
   * (`optionId`) — выбор, «Верно/Неверно» или ячейка таблицы (ID элемента с уроком); текст — «Впишите символ».
   */
  async answer(
    studentId: string,
    sessionId: string,
    body: unknown,
    locale: Locale,
  ): Promise<AtlasQuizAnswerResultDto> {
    const owned = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, owned.subjectId);
    const parsed = AtlasQuizAnswerDto.safeParse(body);
    if (!parsed.success) throw invalid('optionId');
    const { optionId, text } = parsed.data;
    const kind = owned.kind as AtlasQuizKind;
    const pool = this.pool(kind, await this.atlas.topics(owned.subjectId), locale);
    return this.db.transaction(async (tx) => {
      const session = await this.lock(tx, sessionId);
      const state = session.state as QuizState;
      if (session.status !== 'in_progress' || !state.current) throw conflict('quiz', 'quizFinished');
      const current = state.current;
      const how = current.type ? answerKind(current.type) : 'choice';
      const expected = current.answer ?? current.item;
      let correct: boolean;
      let selected: string;
      let caseHint = false;
      if (how === 'input') {
        if (text === undefined) throw invalid('text');
        const check = checkSymbol(text, expected);
        correct = check === 'correct';
        caseHint = check === 'case';
        selected = text.trim();
      } else {
        if (optionId === undefined) throw invalid('optionId');
        const allowed =
          how === 'table'
            ? pool.some((p) => p.id === optionId && p.element)
            : current.options.includes(optionId) && !current.removed?.includes(optionId);
        if (!allowed) throw invalid('optionId');
        correct = optionId === expected;
        selected = optionId;
      }
      const hinted = Boolean(current.removed?.length || current.rows?.length);
      state.answers.push({
        item: current.item,
        selected,
        correct,
        hinted,
        level: current.level,
        ...(current.type ? { question: current } : {}),
      });
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
      state.current = state.index < state.items.length ? this.current(kind, state, pool) : null;
      const [saved] = await tx
        .update(sessions)
        .set({ state, correctCount: session.correctCount + (correct ? 1 : 0) })
        .where(eq(sessions.id, sessionId))
        .returning();
      const answer = pool.find((p) => p.id === current.item);
      const byId = new Map(pool.map((p) => [p.id, p]));
      return {
        correct,
        hinted,
        correctOptionId: how === 'input' ? null : expected,
        correctAnswer: this.answerLabel(current, expected, byId),
        caseHint,
        answer: answer ? this.info(answer) : null,
        next: state.current ? this.question(saved!, state, pool, locale) : null,
      };
    });
  }

  /** API-S-27: завершение после ответа на все вопросы — событие atlas_quiz_finished, XP (BR-XP-05), серия. */
  async finish(studentId: string, sessionId: string, locale: Locale): Promise<AtlasQuizSessionDto> {
    const owned = await this.own(studentId, sessionId);
    await this.atlas.assertAtlas(studentId, owned.subjectId);
    const pool = this.pool(owned.kind as AtlasQuizKind, await this.atlas.topics(owned.subjectId), locale);
    const { finished, history } = await this.db.transaction(async (tx) => {
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
      return { finished: saved!, history: await this.compare(tx, saved!) };
    });
    return this.dto(finished, pool, locale, history);
  }

  /**
   * API-T-32 (решение А-9, AC-TST-12): предпросмотр для учителя — вопросы квиза или игры с правильным ответом; ничего
   * не сохраняется. Квиз элементов — по режиму (REQ-TST-11), уровни по порядку: лёгкие, средние, сложные — чтобы
   * учитель видел все типы (без ответов ученика уровень не меняется). Только базовый предмет с модулем атласа.
   */
  async preview(
    subjectId: string,
    kind: AtlasQuizKind,
    locale: Locale,
    mode: AtlasQuizMode = 'quick',
    family?: ElementFamily,
  ): Promise<AtlasPreviewDto> {
    await this.atlas.assertAtlas(null, subjectId);
    const pool = this.pool(kind, await this.atlas.topics(subjectId), locale);
    const byId = new Map(pool.map((p) => [p.id, p]));
    if (kind === 'scientists') {
      const level = SCIENTIST_QUIZ.start;
      const items = shuffle(pool.map((p) => p.id)).slice(0, ATLAS_QUIZ_LENGTH);
      return {
        questions: items.map((item) => {
          const current = this.makeCurrent(kind, item, level, pool);
          return this.previewQuestion(current, byId, locale, 'scientists');
        }),
      };
    }
    let ids = pool.map((p) => p.id);
    if (mode === 'family') {
      if (!family) throw invalid('family');
      ids = pool.filter((p) => p.element?.family === family).map((p) => p.id);
      if (!familiesWithLessons(pool.flatMap((p) => (p.element ? [p.element.family] : []))).includes(family))
        throw invalid('family');
    }
    // У учителя нет своих ошибок — «Работа над ошибками» в предпросмотре показывает «Ошибок нет».
    if (mode === 'mistakes') throw conflict('quiz', 'noMistakes');
    const items = mode === 'family' ? fill(ids, ATLAS_QUIZ_LENGTH) : shuffle(ids).slice(0, ATLAS_QUIZ_LENGTH);
    const state: QuizState = {
      items,
      index: 0,
      level: 1,
      history: [],
      streak: { correct: 0, wrong: 0 },
      current: null,
      answers: [],
      mode,
    };
    const questions: AtlasPreviewDto['questions'] = [];
    for (let i = 0; i < items.length; i++) {
      state.index = i;
      state.level = Math.min(3, 1 + Math.floor((3 * i) / items.length));
      const current = this.current('elements', state, pool);
      state.answers.push({ item: current.item, selected: '', correct: true, question: current });
      questions.push(this.previewQuestion(current, byId, locale, 'elements'));
    }
    return { questions };
  }

  /* ---------- Вопросы ---------- */

  /** Пул вопросов на языке запроса: элементы предмета или учёные урока «Учёные-химики». */
  private pool(kind: AtlasQuizKind, rows: AtlasTopicRow[], locale: Locale): PoolItem[] {
    if (kind === 'elements') {
      const elements = AtlasService.elements(rows);
      // Решение владельца 2026-10-28: элементы с неуникальным (шаблонным) описанием не спрашиваются по описанию.
      const skip = nonUniqueDescriptions(
        elements.map((e) => ({
          id: e.id,
          description: pick(e.snapshot.translations, 'ru')?.[1]?.description ?? '',
        })),
      );
      return elements.flatMap((e) => {
        const [actual, tr] = pick(e.snapshot.translations, locale) ?? [];
        const known = periodicElement(e.elementNumber);
        if (!actual || !tr?.title || !known) return [];
        const symbol = known.symbol;
        return [
          {
            id: e.id,
            code: e.code,
            title: tr.title,
            description: tr.description ?? '',
            // Сложный уровень — интересный факт вместо описания; маскировка всех форм названия (BR-TST-03).
            text: (level: number) =>
              skip.has(e.id) && level < 3 ? null : elementQuizText(level, tr, symbol, actual),
            maskedDescription: skip.has(e.id) ? null : elementQuizText(2, tr, symbol, actual),
            maskedFact: elementQuizText(3, { ...tr, description: null }, symbol, actual),
            element: {
              id: e.id,
              number: known.number,
              symbol,
              family: known.family,
              period: known.period,
              group: known.group,
            },
          },
        ];
      });
    }
    const topic = AtlasService.scientists(rows);
    if (!topic) return [];
    const [actual] = pick(topic.snapshot.translations, locale) ?? [locale];
    // REQ-TST-07.4: год открытия учёного — из ленты урока (раздел — полный код `<тема>#<учёный>`).
    const years = new Map(
      (topic.snapshot.timeline ?? []).map((ev) => [ev.section.split('#').pop(), ev.year]),
    );
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
            year: years.get(code) ?? null,
          },
        ];
      });
  }

  /**
   * Текущий вопрос сессии. Квиз элементов (REQ-TST-10): тип — из набора уровня (режим «Таблица-челлендж» — только
   * таблица), без третьего одинакового подряд; тип, который для элемента невозможен (текст не маскируется,
   * BR-TST-03), не выбирается; если невозможен ни один — элемент заменяется другим ещё не заданным.
   */
  private current(kind: AtlasQuizKind, state: QuizState, pool: PoolItem[]): Current {
    if (kind !== 'elements') return this.makeCurrent(kind, state.items[state.index]!, state.level, pool);
    const elements = pool.flatMap((p) => (p.element ? [p.element] : []));
    const recent = state.answers.flatMap((a) => (a.question?.type ? [a.question.type] : []));
    const typeFor = (p: PoolItem | undefined): AtlasQuestionType | null =>
      p?.element
        ? pickQuestionType(
            state.level,
            state.mode ?? 'quick',
            recent,
            (t) =>
              typeAvailable(t, p.element!, {
                description: Boolean(p.maskedDescription),
                funFact: Boolean(p.maskedFact),
              }),
            randomInt,
          )
        : null;
    let p = pool.find((x) => x.id === state.items[state.index]);
    let type = typeFor(p);
    if (!type) {
      const used = new Set(state.items);
      for (const swap of shuffle(pool.filter((x) => !used.has(x.id)))) {
        type = typeFor(swap);
        if (type) {
          state.items[state.index] = swap.id;
          p = swap;
          break;
        }
      }
    }
    if (!type || !p?.element) return this.makeCurrent(kind, state.items[state.index]!, state.level, pool);
    return { ...buildQuestion(type, p.element, elements, state.level, randomInt), level: state.level };
  }

  /** Игра про учёных: выбор из 4 (REQ-TST-07, BR-TST-02), неверные — по уровню, верный — на случайной позиции. */
  private makeCurrent(kind: AtlasQuizKind, item: string, level: number, pool: PoolItem[]): Current {
    const p = pool.find((x) => x.id === item);
    const distractors =
      kind === 'scientists'
        ? pickScientistDistractors(
            { id: item, year: p?.year ?? null },
            pool.map((x) => ({ id: x.id, year: x.year ?? null })),
            scientistDifficulty(level),
            randomInt,
          )
        : buildQuestion(
            'description',
            p!.element!,
            pool.flatMap((x) => (x.element ? [x.element] : [])),
            level,
            randomInt,
          ).options.filter((id) => id !== item);
    return { item, level, options: withAnswer(item, distractors, randomInt) };
  }

  /** Правильный ответ для объяснения и ссылки «Открыть урок» (REQ-TST-01, REQ-TST-09.3). */
  private info(p: PoolItem): AtlasAnswerInfoDto {
    return {
      code: p.code,
      title: p.title,
      description: p.description,
      symbol: p.element?.symbol ?? null,
      number: p.element?.number ?? null,
      family: p.element?.family ?? null,
    };
  }

  /** Подпись варианта на языке запроса: название, символ, число или «Верно/Неверно». */
  private optionTitle(current: Current, id: string, byId: Map<string, PoolItem>, locale: Locale): string {
    if (current.type === 'fact-true-false')
      return message(locale, `atlas.quiz.q.${id === 'true' ? 'true' : 'false'}`);
    if (current.type === 'bohr' && current.variant === 'count') return id;
    if (current.type === 'type-symbol') return id;
    const p = byId.get(id);
    if (current.type === 'name-to-symbol') return p?.element?.symbol ?? '';
    return p?.title ?? '';
  }

  /** Правильный ответ словами — для ввода и таблицы (у выбора он подсвечен среди вариантов). */
  private answerLabel(current: Current, expected: string, byId: Map<string, PoolItem>): string | null {
    if (current.type === 'type-symbol') return expected;
    if (current.type !== 'table-click') return null;
    const e = byId.get(expected);
    return e ? `${e.title} (${e.element?.symbol ?? ''})` : null;
  }

  /** Заголовок и текст вопроса на языке запроса (REQ-TST-10). */
  private prompt(
    current: Current,
    byId: Map<string, PoolItem>,
    locale: Locale,
    kind: AtlasQuizKind,
  ): { intro: string | null; text: string } {
    const p = byId.get(current.item);
    const e = p?.element;
    const name = p?.title ?? '';
    const element = message(locale, 'atlas.quiz.questionIntro');
    switch (current.type) {
      case undefined:
        return { intro: kind === 'elements' ? element : null, text: p?.text(current.level) ?? '' };
      case 'description':
        return { intro: element, text: p?.maskedDescription ?? p?.text(current.level) ?? '' };
      case 'fun-fact':
        return { intro: element, text: p?.maskedFact ?? p?.text(3) ?? '' };
      case 'symbol-to-name':
        return {
          intro: null,
          text: message(locale, 'atlas.quiz.q.symbolToName', { symbol: e?.symbol ?? '' }),
        };
      case 'name-to-symbol':
        return { intro: null, text: message(locale, 'atlas.quiz.q.nameToSymbol', { name }) };
      case 'fact-true-false': {
        const fact = current.fact!;
        const params: Record<string, string | number> = { name };
        let key: string;
        if (fact.kind === 'family') {
          key = 'factFamily';
          params.family = message(locale, `atlas.group.${fact.family}`);
        } else if (fact.kind === 'period') {
          key = 'factPeriod';
          params.period = fact.period;
        } else if (fact.kind === 'group') {
          key = 'factGroup';
          params.group = fact.group;
        } else {
          key = 'factNumber';
          params.other = byId.get(fact.other)?.title ?? '';
        }
        return {
          intro: message(locale, 'atlas.quiz.q.trueFalse'),
          text: message(locale, `atlas.quiz.q.${key}`, params),
        };
      }
      case 'bohr':
        return {
          intro: null,
          text: message(
            locale,
            current.variant === 'count' ? 'atlas.quiz.q.bohrCount' : 'atlas.quiz.q.bohrElement',
          ),
        };
      case 'table-click':
        return {
          intro: null,
          text:
            current.variant === 'cell'
              ? message(locale, 'atlas.quiz.q.tableCell', { period: e?.period ?? '', group: e?.group ?? '' })
              : message(locale, 'atlas.quiz.q.tableName', { name }),
        };
      case 'config':
        return {
          intro: null,
          text: message(locale, 'atlas.quiz.q.config', { config: electronConfig(e?.number ?? 1) }),
        };
      case 'type-symbol':
        return { intro: null, text: message(locale, 'atlas.quiz.q.typeSymbol', { name }) };
    }
  }

  /** Вопрос для клиента: без правильного ответа (BR-QZ-01). */
  private view(
    current: Current,
    byId: Map<string, PoolItem>,
    locale: Locale,
    kind: AtlasQuizKind,
    index: number,
  ): AtlasQuizQuestionDto {
    const { intro, text } = this.prompt(current, byId, locale, kind);
    const e = byId.get(current.item)?.element;
    return {
      index,
      type: current.type ?? null,
      answerKind: current.type ? answerKind(current.type) : 'choice',
      difficulty: kind === 'elements' ? elementDifficulty(current.level) : scientistDifficulty(current.level),
      intro,
      text,
      options: current.options.map((id) => ({ id, title: this.optionTitle(current, id, byId, locale) })),
      // Схема Бора — только оболочки и электроны, без символа и номера (REQ-TST-10.2).
      shells: current.type === 'bohr' && e ? [...(ELECTRON_SHELLS[e.number] ?? [])] : null,
      removed: current.removed ?? [],
      rows: current.rows ?? [],
    };
  }

  private question(
    session: Session,
    state: QuizState,
    pool: PoolItem[],
    locale: Locale,
  ): AtlasQuizQuestionDto {
    const byId = new Map(pool.map((p) => [p.id, p]));
    return this.view(state.current!, byId, locale, session.kind as AtlasQuizKind, state.index + 1);
  }

  /** Вопрос предпросмотра учителя: тот же вид + правильный ответ (проверка и «50/50» — в браузере учителя). */
  private previewQuestion(
    current: Current,
    byId: Map<string, PoolItem>,
    locale: Locale,
    kind: AtlasQuizKind,
  ): AtlasPreviewDto['questions'][number] {
    const p = byId.get(current.item)!;
    const expected = current.answer ?? current.item;
    return {
      ...this.view(current, byId, locale, kind, 0),
      correctOptionId: current.type === 'type-symbol' ? null : expected,
      correctText: current.type === 'type-symbol' ? expected : null,
      correctAnswer: this.answerLabel(current, expected, byId),
      hintRows:
        current.type === 'table-click' && p.element
          ? tableHintPeriods(
              p.element.period,
              [...byId.values()].flatMap((x) => (x.element ? [x.element.period] : [])),
              randomInt,
            )
          : [],
      answer: this.info(p),
    };
  }

  /** «Работа над ошибками» (REQ-TST-11): элементы с ошибками в последних 5 завершённых попытках квиза элементов. */
  private async recentMistakes(studentId: string, subjectId: string, known: Set<string>): Promise<string[]> {
    const recent = await this.db
      .select({ state: sessions.state })
      .from(sessions)
      .where(
        and(
          eq(sessions.studentId, studentId),
          eq(sessions.subjectId, subjectId),
          eq(sessions.kind, 'elements'),
          eq(sessions.status, 'finished'),
        ),
      )
      .orderBy(desc(sessions.finishedAt))
      .limit(MISTAKES_MODE_SESSIONS);
    const wrong = recent.flatMap((s) =>
      (s.state as QuizState).answers.filter((a) => !a.correct).map((a) => a.item),
    );
    return [...new Set(wrong)].filter((id) => known.has(id));
  }

  /**
   * REQ-TST-05.2: прошлые завершённые сессии этого вида у ученика по предмету — лучший результат (с этой сессией) и
   * результат прошлой.
   */
  private async compare(
    db: Tx | Database,
    session: Session,
  ): Promise<{ bestPercent: number; previousPercent: number | null } | null> {
    if (session.status !== 'finished') return null;
    const prior = await db
      .select({ correct: sessions.correctCount, total: sessions.total })
      .from(sessions)
      .where(
        and(
          eq(sessions.studentId, session.studentId),
          eq(sessions.subjectId, session.subjectId),
          eq(sessions.kind, session.kind),
          eq(sessions.status, 'finished'),
          ne(sessions.id, session.id),
          lt(sessions.finishedAt, session.finishedAt ?? new Date()),
        ),
      )
      .orderBy(desc(sessions.finishedAt));
    const before = prior.map((p) => percentOf(p.correct, p.total));
    const own = percentOf(session.correctCount, session.total);
    return { bestPercent: Math.max(own, ...before), previousPercent: before[0] ?? null };
  }

  private dto(
    session: Session,
    pool: PoolItem[],
    locale: Locale,
    history: { bestPercent: number; previousPercent: number | null } | null = null,
  ): AtlasQuizSessionDto {
    const state = session.state as QuizState;
    const kind = session.kind as AtlasQuizKind;
    const byId = new Map(pool.map((p) => [p.id, p]));
    const families = new Map<ElementFamily, { correct: number; total: number }>();
    for (const a of state.answers) {
      const family = byId.get(a.item)?.element?.family;
      if (!family) continue;
      const row = families.get(family) ?? { correct: 0, total: 0 };
      row.total += 1;
      if (a.correct) row.correct += 1;
      families.set(family, row);
    }
    return {
      id: session.id,
      kind,
      mode: state.mode ?? 'quick',
      family: state.family ?? null,
      status: session.status as 'in_progress' | 'finished',
      total: session.total,
      answered: state.answers.length,
      correct: session.correctCount,
      answers: state.answers.map((a) => ({ correct: a.correct, hinted: Boolean(a.hinted) })),
      hintsLeft: Math.max(0, HINT_LIMIT - (state.hintsUsed ?? 0)),
      question:
        state.current && session.status === 'in_progress'
          ? this.question(session, state, pool, locale)
          : null,
      result:
        session.status === 'finished'
          ? {
              correct: session.correctCount,
              total: session.total,
              percent: percentOf(session.correctCount, session.total),
              hinted: state.answers.filter((a) => a.correct && a.hinted).length,
              xpAwarded: session.xpAwarded,
              bestPercent: history?.bestPercent ?? percentOf(session.correctCount, session.total),
              previousPercent: history?.previousPercent ?? null,
              families: [...families].map(([family, v]) => ({ family, ...v })),
              mistakes: state.answers.flatMap((a) => {
                const p = byId.get(a.item);
                if (a.correct || !p) return [];
                const asked: Current = a.question ?? {
                  item: a.item,
                  level: a.level ?? state.level,
                  options: [],
                };
                const { text } = this.prompt(asked, byId, locale, kind);
                return [
                  {
                    ...this.info(p),
                    question: text,
                    selected: asked.type
                      ? this.selectedLabel(asked, a.selected, byId, locale)
                      : (byId.get(a.selected)?.title ?? ''),
                  },
                ];
              }),
            }
          : null,
    };
  }

  /** Ответ ученика словами — для списка ошибок. */
  private selectedLabel(
    current: Current,
    selected: string,
    byId: Map<string, PoolItem>,
    locale: Locale,
  ): string {
    if (current.type === 'type-symbol') return selected;
    if (current.type === 'table-click') {
      const e = byId.get(selected);
      return e ? `${e.title} (${e.element?.symbol ?? ''})` : '';
    }
    return this.optionTitle(current, selected, byId, locale);
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
