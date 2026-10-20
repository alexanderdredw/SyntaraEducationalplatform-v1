import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, or, sql } from 'drizzle-orm';
import {
  BATTLE_DEFAULT_TIME_LIMIT,
  BATTLE_LIMITS,
  getMessage,
  type BattleConfig,
  type BattleImportDto,
  type BattleQuestionDto,
  type BattleQuizCreateDto,
  type BattleQuizUpdateDto,
  type BattleReorderDto,
  type Locale,
  type Messages,
} from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { pickTranslation } from '../../common/locale';
import { subjectTitles, topicTitles } from '../../common/titles';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { StorageService } from '../files/storage.service';
import {
  type BattleImportSourceDto,
  type BattleQuestionItemDto,
  type BattleQuizDto,
  type BattleQuizListItemDto,
} from './battle.dto';

const { battleQuizzes, battleQuestions, battleOptions, battleSessions, mediaFiles } = schema;
const {
  subjects,
  topics,
  quizzes,
  questions,
  questionTranslations,
  answerOptions,
  answerOptionTranslations,
} = schema;

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/** BR-BTL-10: «Верно» / «Неверно» на языке теста (как в квизе темы, BR-QZ-02). */
const trueFalseTexts = (locale: Locale): [string, string] => [
  getMessage(BUNDLES[locale], 'teacher.quiz.optionTrue') ?? '',
  getMessage(BUNDLES[locale], 'teacher.quiz.optionFalse') ?? '',
];

const unprocessable = (field: string, key: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'Battle change not accepted', {
    [field]: key,
  });
const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

const activeQuestion = (quizId: string) =>
  and(eq(battleQuestions.battleQuizId, quizId), isNull(battleQuestions.archivedAt));

/**
 * Battle-тесты учителя (SPEC 6.8 API-BTL-01…11, BR-BTL-10). Владение тестом проверяет OwnershipGuard до разбора
 * тела (404); вопрос чужого теста — тоже 404. Вопросы не удаляются физически — архивируются (5.1).
 */
@Injectable()
export class BattleQuizService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  /** API-BTL-01 */
  async list(ownerId: string, archived: boolean): Promise<BattleQuizListItemDto[]> {
    const rows = await this.db
      .select()
      .from(battleQuizzes)
      .where(
        and(
          eq(battleQuizzes.ownerId, ownerId),
          archived ? isNotNull(battleQuizzes.archivedAt) : isNull(battleQuizzes.archivedAt),
        ),
      )
      .orderBy(desc(battleQuizzes.updatedAt));
    const ids = rows.map((r) => r.id);
    const [questionCounts, games] = ids.length
      ? await Promise.all([
          this.db
            .select({ quizId: battleQuestions.battleQuizId, n: count() })
            .from(battleQuestions)
            .where(and(inArray(battleQuestions.battleQuizId, ids), isNull(battleQuestions.archivedAt)))
            .groupBy(battleQuestions.battleQuizId),
          this.db
            .select({ quizId: battleSessions.battleQuizId, n: count(), last: max(battleSessions.startedAt) })
            .from(battleSessions)
            .where(and(inArray(battleSessions.battleQuizId, ids), isNotNull(battleSessions.startedAt)))
            .groupBy(battleSessions.battleQuizId),
        ])
      : [[], []];
    return rows.map((r) => {
      const game = games.find((g) => g.quizId === r.id);
      return {
        id: r.id,
        title: r.title,
        locale: r.locale,
        questionsCount: Number(questionCounts.find((q) => q.quizId === r.id)?.n ?? 0),
        gamesCount: Number(game?.n ?? 0),
        lastPlayedAt: game?.last ? new Date(game.last).toISOString() : null,
        archived: r.archivedAt !== null,
      };
    });
  }

  /** API-BTL-02 */
  async create(ownerId: string, dto: BattleQuizCreateDto): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(battleQuizzes)
      .values({ ownerId, title: dto.title, description: dto.description || null, locale: dto.locale })
      .returning({ id: battleQuizzes.id });
    return { id: row!.id };
  }

  /** API-BTL-03 */
  async get(id: string): Promise<BattleQuizDto> {
    const [quiz] = await this.db.select().from(battleQuizzes).where(eq(battleQuizzes.id, id));
    const rows = await this.db
      .select({ q: battleQuestions, mediaKey: mediaFiles.storageKey, mediaStatus: mediaFiles.scanStatus })
      .from(battleQuestions)
      .leftJoin(mediaFiles, eq(mediaFiles.id, battleQuestions.imageMediaId))
      .where(activeQuestion(id))
      .orderBy(asc(battleQuestions.position));
    const options = rows.length
      ? await this.db
          .select()
          .from(battleOptions)
          .where(
            inArray(
              battleOptions.battleQuestionId,
              rows.map((r) => r.q.id),
            ),
          )
          .orderBy(asc(battleOptions.position))
      : [];
    const [games] = await this.db
      .select({ n: count() })
      .from(battleSessions)
      .where(and(eq(battleSessions.battleQuizId, id), isNotNull(battleSessions.startedAt)));
    const questionItems: BattleQuestionItemDto[] = [];
    for (const [i, { q, mediaKey, mediaStatus }] of rows.entries()) {
      questionItems.push({
        id: q.id,
        number: i + 1,
        type: q.type as 'single_choice' | 'true_false',
        text: q.text,
        imageMediaId: q.imageMediaId,
        // BR-FILE-04: только проверенный файл, по подписанной ссылке.
        imageUrl: mediaKey && mediaStatus === 'clean' ? await this.storage.downloadUrl(mediaKey) : null,
        timeLimitSec: q.timeLimitSec,
        imported: q.sourceQuestionId !== null,
        options: options
          .filter((o) => o.battleQuestionId === q.id)
          .map((o) => ({ position: o.position, text: o.text, isCorrect: o.isCorrect })),
      });
    }
    return {
      id: quiz!.id,
      title: quiz!.title,
      description: quiz!.description,
      locale: quiz!.locale,
      archived: quiz!.archivedAt !== null,
      gamesCount: Number(games?.n ?? 0),
      questions: questionItems,
    };
  }

  /** API-BTL-04: поля и архив; смена языка переписывает «Верно» / «Неверно» на новом языке. */
  async update(id: string, dto: BattleQuizUpdateDto): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(battleQuizzes)
        .set({
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description || null } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.archived !== undefined ? { archivedAt: dto.archived ? new Date() : null } : {}),
        })
        .where(eq(battleQuizzes.id, id));
      if (dto.locale === undefined) return;
      const [yes, no] = trueFalseTexts(dto.locale);
      const tf = await tx
        .select({ id: battleQuestions.id })
        .from(battleQuestions)
        .where(and(eq(battleQuestions.battleQuizId, id), eq(battleQuestions.type, 'true_false')));
      if (tf.length === 0) return;
      const ids = tf.map((q) => q.id);
      await tx
        .update(battleOptions)
        .set({ text: sql`CASE WHEN ${battleOptions.position} = 1 THEN ${yes} ELSE ${no} END` })
        .where(inArray(battleOptions.battleQuestionId, ids));
    });
  }

  /** API-BTL-05: копия теста с неархивными вопросами в том же порядке. */
  async duplicate(ownerId: string, id: string): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [quiz] = await tx.select().from(battleQuizzes).where(eq(battleQuizzes.id, id));
      const [copy] = await tx
        .insert(battleQuizzes)
        .values({ ownerId, title: quiz!.title, description: quiz!.description, locale: quiz!.locale })
        .returning({ id: battleQuizzes.id });
      const rows = await tx
        .select()
        .from(battleQuestions)
        .where(activeQuestion(id))
        .orderBy(asc(battleQuestions.position));
      const options = rows.length
        ? await tx
            .select()
            .from(battleOptions)
            .where(
              inArray(
                battleOptions.battleQuestionId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      for (const [i, q] of rows.entries()) {
        const [row] = await tx
          .insert(battleQuestions)
          .values({
            battleQuizId: copy!.id,
            position: i + 1,
            type: q.type,
            text: q.text,
            imageMediaId: q.imageMediaId,
            timeLimitSec: q.timeLimitSec,
            sourceQuestionId: q.sourceQuestionId,
          })
          .returning({ id: battleQuestions.id });
        const own = options.filter((o) => o.battleQuestionId === q.id);
        if (own.length)
          await tx.insert(battleOptions).values(
            own.map((o) => ({
              battleQuestionId: row!.id,
              position: o.position,
              text: o.text,
              isCorrect: o.isCorrect,
            })),
          );
      }
      return { id: copy!.id };
    });
  }

  /** API-BTL-06: вопрос в конец списка; не больше 50 (BR-BTL-10). */
  async addQuestion(ownerId: string, quizId: string, dto: BattleQuestionDto): Promise<{ id: string }> {
    await this.checkImage(ownerId, dto.imageMediaId);
    return this.db.transaction(async (tx) => {
      const quiz = await this.lockQuiz(tx, quizId);
      await this.ensureRoom(tx, quizId, 1);
      const id = await this.insertQuestion(tx, quizId, await this.nextPosition(tx, quizId), quiz.locale, dto);
      return { id };
    });
  }

  /** API-BTL-07: вопрос и варианты целиком (варианты пересоздаются — игры хранят свой снимок, BR-BTL-05). */
  async updateQuestion(
    ownerId: string,
    quizId: string,
    questionId: string,
    dto: BattleQuestionDto,
  ): Promise<void> {
    await this.checkImage(ownerId, dto.imageMediaId);
    await this.db.transaction(async (tx) => {
      const quiz = await this.lockQuiz(tx, quizId);
      await this.ownQuestion(tx, quizId, questionId);
      await tx
        .update(battleQuestions)
        .set({
          type: dto.type,
          text: dto.text,
          imageMediaId: dto.imageMediaId ?? null,
          timeLimitSec: dto.timeLimitSec,
        })
        .where(eq(battleQuestions.id, questionId));
      await tx.delete(battleOptions).where(eq(battleOptions.battleQuestionId, questionId));
      await tx.insert(battleOptions).values(this.optionRows(questionId, quiz.locale, dto));
    });
  }

  /** API-BTL-08: архивирование вопроса. */
  async archiveQuestion(quizId: string, questionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockQuiz(tx, quizId);
      await this.ownQuestion(tx, quizId, questionId);
      await tx
        .update(battleQuestions)
        .set({ archivedAt: new Date() })
        .where(eq(battleQuestions.id, questionId));
    });
  }

  /**
   * API-BTL-09: новый порядок всех неархивных вопросов (позиции 1…n в одной транзакции — уникальность отложена).
   * Архивные вопросы уходят за конец списка, чтобы не занимать позиции.
   */
  async reorder(quizId: string, dto: BattleReorderDto): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockQuiz(tx, quizId);
      const all = await tx
        .select({ id: battleQuestions.id, archivedAt: battleQuestions.archivedAt })
        .from(battleQuestions)
        .where(eq(battleQuestions.battleQuizId, quizId))
        .orderBy(asc(battleQuestions.position));
      const active = all.filter((q) => q.archivedAt === null).map((q) => q.id);
      const wanted = dto.questionIds.map((id) => id.toLowerCase());
      if (
        wanted.length !== active.length ||
        new Set(wanted).size !== wanted.length ||
        wanted.some((id) => !active.includes(id))
      )
        throw unprocessable('questionIds', 'invalidOrder');
      const order = [...wanted, ...all.filter((q) => q.archivedAt !== null).map((q) => q.id)];
      for (const [i, id] of order.entries()) {
        await tx
          .update(battleQuestions)
          .set({ position: i + 1 })
          .where(eq(battleQuestions.id, id));
      }
    });
  }

  /**
   * API-BTL-10: свои темы и опубликованные базовые темы платформы с вопросами, которые можно скопировать
   * (BR-BTL-10: выбор варианта и «Верно/Неверно», не больше 4 вариантов, тексты в лимитах Battle).
   */
  async importSources(ownerId: string, locale: Locale): Promise<BattleImportSourceDto[]> {
    const subjectRows = await this.db
      .select({ id: subjects.id, official: subjects.isOfficial, position: subjects.position })
      .from(subjects)
      .where(
        and(isNull(subjects.archivedAt), or(eq(subjects.ownerId, ownerId), eq(subjects.isOfficial, true))),
      )
      .orderBy(
        sql`${subjects.isOfficial} ASC`,
        sql`${subjects.position} ASC NULLS LAST`,
        asc(subjects.createdAt),
      );
    if (subjectRows.length === 0) return [];
    const topicRows = await this.db
      .select({ id: topics.id, subjectId: topics.subjectId, status: topics.status })
      .from(topics)
      .where(
        and(
          inArray(
            topics.subjectId,
            subjectRows.map((s) => s.id),
          ),
          isNull(topics.archivedAt),
        ),
      )
      .orderBy(asc(topics.position));
    const visibleTopics = topicRows.filter(
      (t) => !subjectRows.find((s) => s.id === t.subjectId)!.official || t.status === 'published',
    );
    const eligible = await this.eligibleQuestions(
      visibleTopics.map((t) => t.id),
      locale,
    );
    const [subjectNames, topicNames] = await Promise.all([
      subjectTitles(
        this.db,
        subjectRows.map((s) => s.id),
        locale,
      ),
      topicTitles(
        this.db,
        visibleTopics.map((t) => t.id),
        locale,
      ),
    ]);
    return subjectRows
      .map((s) => ({
        subjectId: s.id,
        subjectTitle: subjectNames.get(s.id) ?? '',
        official: s.official,
        topics: visibleTopics
          .filter((t) => t.subjectId === s.id)
          .map((t) => {
            const list = eligible.filter((q) => q.topicId === t.id);
            return {
              id: t.id,
              title: topicNames.get(t.id) ?? '',
              eligibleCount: list.length,
              questions: list.map((q) => ({ id: q.id, text: q.text, type: q.type })),
            };
          })
          .filter((t) => t.eligibleCount > 0),
      }))
      .filter((s) => s.topics.length > 0);
  }

  /** API-BTL-11: копии вопросов темы (время — значение по умолчанию PH-45); правка копии не меняет квиз. */
  async importQuestions(
    ownerId: string,
    quizId: string,
    dto: BattleImportDto,
  ): Promise<{ imported: number }> {
    const [topic] = await this.db
      .select({
        id: topics.id,
        status: topics.status,
        official: subjects.isOfficial,
        ownerId: subjects.ownerId,
      })
      .from(topics)
      .innerJoin(subjects, eq(subjects.id, topics.subjectId))
      .where(and(eq(topics.id, dto.topicId), isNull(topics.archivedAt), isNull(subjects.archivedAt)));
    // Чужая тема или неопубликованная базовая — как несуществующая (BR-ACL-01).
    if (!topic || (topic.official ? topic.status !== 'published' : topic.ownerId !== ownerId))
      throw notFound();
    const battleConfig = await this.config.get<BattleConfig>('battle');
    const timeLimitSec = battleConfig?.default_time_limit_sec ?? BATTLE_DEFAULT_TIME_LIMIT;
    return this.db.transaction(async (tx) => {
      const quiz = await this.lockQuiz(tx, quizId);
      const source = await this.eligibleQuestions([dto.topicId], quiz.locale, tx);
      const wanted = dto.questionIds?.map((id) => id.toLowerCase());
      const picked = wanted ? source.filter((q) => wanted.includes(q.id)) : source;
      if (wanted && picked.length !== new Set(wanted).size) throw unprocessable('questionIds', 'notEligible');
      if (picked.length === 0) return { imported: 0 };
      await this.ensureRoom(tx, quizId, picked.length);
      let position = await this.nextPosition(tx, quizId);
      for (const q of picked) {
        await this.insertQuestion(
          tx,
          quizId,
          position++,
          quiz.locale,
          { type: q.type, text: q.text, imageMediaId: null, timeLimitSec, options: q.options },
          q.id,
        );
      }
      return { imported: picked.length };
    });
  }

  /** Вопросы тем, подходящие для Battle, — текст на нужном языке (иначе RU), варианты по позиции. */
  private async eligibleQuestions(topicIds: string[], locale: Locale, tx: Tx | Database = this.db) {
    if (topicIds.length === 0) return [];
    const rows = await tx
      .select({ id: questions.id, type: questions.type, topicId: quizzes.topicId })
      .from(questions)
      .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
      .where(
        and(
          inArray(quizzes.topicId, topicIds),
          isNull(questions.archivedAt),
          inArray(questions.type, ['single_choice', 'true_false']),
        ),
      )
      .orderBy(asc(questions.position), asc(questions.id));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [texts, options] = await Promise.all([
      tx.select().from(questionTranslations).where(inArray(questionTranslations.questionId, ids)),
      tx
        .select()
        .from(answerOptions)
        .where(inArray(answerOptions.questionId, ids))
        .orderBy(asc(answerOptions.position)),
    ]);
    const optionTexts = options.length
      ? await tx
          .select()
          .from(answerOptionTranslations)
          .where(
            inArray(
              answerOptionTranslations.optionId,
              options.map((o) => o.id),
            ),
          )
      : [];
    return rows.flatMap((r) => {
      const text = pickTranslation(
        texts.filter((t) => t.questionId === r.id),
        locale,
      )?.text;
      const own = options.filter((o) => o.questionId === r.id);
      const opts = own.map((o) => ({
        text:
          pickTranslation(
            optionTexts.filter((t) => t.optionId === o.id),
            locale,
          )?.text ?? '',
        isCorrect: o.isCorrect,
      }));
      const fits =
        text &&
        text.length <= BATTLE_LIMITS.questionText &&
        opts.length >= BATTLE_LIMITS.minOptions &&
        opts.length <= BATTLE_LIMITS.maxOptions &&
        opts.filter((o) => o.isCorrect).length === 1 &&
        opts.every((o) => o.text && o.text.length <= BATTLE_LIMITS.optionText);
      return fits
        ? [
            {
              id: r.id,
              topicId: r.topicId,
              type: r.type as 'single_choice' | 'true_false',
              text,
              options: opts,
            },
          ]
        : [];
    });
  }

  private async insertQuestion(
    tx: Tx,
    quizId: string,
    position: number,
    locale: Locale,
    dto: BattleQuestionDto,
    sourceQuestionId: string | null = null,
  ): Promise<string> {
    const [row] = await tx
      .insert(battleQuestions)
      .values({
        battleQuizId: quizId,
        position,
        type: dto.type,
        text: dto.text,
        imageMediaId: dto.imageMediaId ?? null,
        timeLimitSec: dto.timeLimitSec,
        sourceQuestionId,
      })
      .returning({ id: battleQuestions.id });
    await tx.insert(battleOptions).values(this.optionRows(row!.id, locale, dto));
    return row!.id;
  }

  private optionRows(battleQuestionId: string, locale: Locale, dto: BattleQuestionDto) {
    const texts = dto.type === 'true_false' ? trueFalseTexts(locale) : null;
    return dto.options.map((o, i) => ({
      battleQuestionId,
      position: i + 1,
      text: texts ? texts[i]! : o.text,
      isCorrect: o.isCorrect,
    }));
  }

  /** Картинка вопроса — только файл галереи учителя (обложка), не отклонённый (BR-BTL-10). */
  private async checkImage(ownerId: string, mediaId: string | null | undefined): Promise<void> {
    if (!mediaId) return;
    const [media] = await this.db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.id, mediaId),
          eq(mediaFiles.ownerId, ownerId),
          eq(mediaFiles.kind, 'cover'),
          sql`${mediaFiles.scanStatus} <> 'rejected'`,
        ),
      );
    if (!media) throw unprocessable('imageMediaId', 'invalidFile');
  }

  private async lockQuiz(tx: Tx, quizId: string) {
    const [quiz] = await tx.select().from(battleQuizzes).where(eq(battleQuizzes.id, quizId)).for('update');
    return quiz!;
  }

  private async ownQuestion(tx: Tx, quizId: string, questionId: string): Promise<void> {
    const [row] = await tx
      .select({ id: battleQuestions.id })
      .from(battleQuestions)
      .where(and(eq(battleQuestions.id, questionId), activeQuestion(quizId)));
    if (!row) throw notFound();
  }

  private async ensureRoom(tx: Tx, quizId: string, adding: number): Promise<void> {
    const [row] = await tx.select({ n: count() }).from(battleQuestions).where(activeQuestion(quizId));
    if (Number(row?.n ?? 0) + adding > BATTLE_LIMITS.maxQuestions)
      throw unprocessable('questions', 'tooManyQuestions');
  }

  private async nextPosition(tx: Tx, quizId: string): Promise<number> {
    const [row] = await tx
      .select({ position: max(battleQuestions.position) })
      .from(battleQuestions)
      .where(eq(battleQuestions.battleQuizId, quizId));
    return (row?.position ?? 0) + 1;
  }
}
