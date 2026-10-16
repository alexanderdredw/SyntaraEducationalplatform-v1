import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { type AnswerDto, type Locale, normalizeAnswer, scorePercent } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { VisibilityService } from '../content/visibility.service';
import { GamificationService, quizEventKey } from '../gamification/gamification.service';
import { type AnswerResultDto, type AttemptDto, type FinishResultDto } from './student-quiz.dto';

const { quizzes, questions, questionTranslations: qt, answerOptions, answerOptionTranslations: aot } = schema;
const { quizAttempts: attempts, attemptAnswers, topics, topicMastery, learningEvents } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
const invalidTransition = () =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', 'Attempt is not in progress');

type Question = typeof questions.$inferSelect;
type Attempt = typeof attempts.$inferSelect;

/**
 * Квиз ученика (8.4.4, SM-ATTEMPT, 7.2). Видимость темы — VisibilityService (BR-VIS-01); попытки — только свои
 * (BR-ACL-03, чужая → 404). Правильный ответ не уходит в ответах до ответа на вопрос (BR-QZ-01); проверка —
 * сразу (BR-QZ-04, PH-37). Попыток сколько угодно, в зачёт — лучшая (BR-QZ-06); незавершённая продолжается.
 * Вопросы — текущие неархивированные вопросы опубликованной темы (решение по Q-17).
 */
@Injectable()
export class StudentQuizService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly visibility: VisibilityService,
    private readonly gamification: GamificationService,
    private readonly config: AppConfigService,
  ) {}

  /** API-S-07: начать или продолжить попытку. */
  async start(studentId: string, quizId: string, locale: Locale): Promise<AttemptDto> {
    const quiz = await this.visibleQuiz(studentId, quizId);
    const list = await this.questions(quizId);
    if (list.length === 0)
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Quiz has no questions', { quiz: 'quizEmpty' });

    const attempt = await this.db.transaction(async (tx) => {
      // Блокировка квиза: два одновременных старта не создадут две попытки in_progress.
      await tx.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, quizId)).for('update');
      const [current] = await tx
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.studentId, studentId),
            eq(attempts.quizId, quizId),
            eq(attempts.status, 'in_progress'),
          ),
        );
      if (current) return current;
      const [topic] = await tx
        .select({ versionId: topics.publishedVersionId })
        .from(topics)
        .where(eq(topics.id, quiz.topicId));
      // BR-QZ-08: попытка связана с опубликованной версией темы на момент старта.
      const [created] = await tx
        .insert(attempts)
        .values({ studentId, quizId, topicVersionId: topic?.versionId ?? null })
        .returning();
      return created!;
    });

    const ids = list.map((q) => q.id);
    const [translations, options, optionTr, answers] = await Promise.all([
      this.db.select().from(qt).where(inArray(qt.questionId, ids)),
      this.db
        .select()
        .from(answerOptions)
        .where(inArray(answerOptions.questionId, ids))
        .orderBy(asc(answerOptions.position)),
      this.db
        .select({ optionId: aot.optionId, locale: aot.locale, text: aot.text })
        .from(aot)
        .innerJoin(answerOptions, eq(answerOptions.id, aot.optionId))
        .where(inArray(answerOptions.questionId, ids)),
      this.db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attempt.id)),
    ]);

    const answered: AttemptDto['answered'] = {};
    for (const a of answers) {
      const q = list.find((x) => x.id === a.questionId);
      if (!q) continue;
      answered[a.questionId!] = {
        optionId: a.optionId,
        textAnswer: a.textAnswer,
        ...this.result(q, a.isCorrect, options, translations, locale),
      };
    }
    return {
      attemptId: attempt.id,
      questions: list.map((q) => ({
        id: q.id,
        type: q.type,
        difficulty: q.difficulty,
        text:
          pickTranslation(
            translations.filter((t) => t.questionId === q.id),
            locale,
          )?.text ?? '',
        // Без is_correct (BR-QZ-01).
        options: options
          .filter((o) => o.questionId === q.id)
          .map((o) => ({
            id: o.id,
            text:
              pickTranslation(
                optionTr.filter((t) => t.optionId === o.id),
                locale,
              )?.text ?? '',
          })),
      })),
      answered,
    };
  }

  /** API-S-08: проверка сразу после ответа; повторный ответ на тот же вопрос возвращает прежний результат. */
  async answer(
    studentId: string,
    attemptId: string,
    dto: AnswerDto,
    locale: Locale,
  ): Promise<AnswerResultDto> {
    const attempt = await this.ownAttempt(studentId, attemptId);
    if (attempt.status !== 'in_progress') throw invalidTransition();
    await this.visibleQuiz(studentId, attempt.quizId);
    const [question] = await this.db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.id, dto.questionId),
          eq(questions.quizId, attempt.quizId),
          isNull(questions.archivedAt),
        ),
      );
    if (!question) throw notFound();
    const [options, translations] = await Promise.all([
      this.db.select().from(answerOptions).where(eq(answerOptions.questionId, question.id)),
      this.db.select().from(qt).where(eq(qt.questionId, question.id)),
    ]);

    const [previous] = await this.db
      .select()
      .from(attemptAnswers)
      .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, question.id)));
    if (previous) return this.result(question, previous.isCorrect, options, translations, locale);

    let correct: boolean;
    if (question.type === 'text_input') {
      if (dto.textAnswer === undefined) throw this.invalid({ textAnswer: 'required' });
      correct = normalizeAnswer(dto.textAnswer) === normalizeAnswer(question.textAnswer ?? '');
    } else {
      const option = options.find((o) => o.id === dto.optionId);
      if (!option) throw this.invalid({ optionId: 'required' });
      correct = option.isCorrect;
    }
    await this.db
      .insert(attemptAnswers)
      .values({
        attemptId,
        questionId: question.id,
        optionId: question.type === 'text_input' ? null : dto.optionId!,
        textAnswer: question.type === 'text_input' ? dto.textAnswer! : null,
        isCorrect: correct,
      })
      .onConflictDoNothing();
    return this.result(question, correct, options, translations, locale);
  }

  /**
   * API-S-09: балл BR-QZ-05 (без ответа — неверно), лучший результат и освоение темы (BR-QZ-06/07, PH-38),
   * событие quiz_finished и XP/бейджи (BR-XP-01, BR-BDG-01) — в одной транзакции.
   */
  async finish(studentId: string, attemptId: string, locale: Locale): Promise<FinishResultDto> {
    const attempt = await this.ownAttempt(studentId, attemptId);
    if (attempt.status !== 'in_progress') throw invalidTransition();
    const quiz = await this.visibleQuiz(studentId, attempt.quizId);
    const { mastery_threshold: threshold } = await this.config.get<{ mastery_threshold: number }>('progress');
    const current = await this.questions(attempt.quizId);
    const [topic] = await this.db
      .select({ subjectId: topics.subjectId })
      .from(topics)
      .where(eq(topics.id, quiz.topicId));

    return this.db.transaction(async (tx) => {
      // Повторный finish одновременно: только один переведёт попытку в finished.
      const now = new Date();
      const [locked] = await tx
        .select({ status: attempts.status })
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .for('update');
      if (locked?.status !== 'in_progress') throw invalidTransition();
      const [correctRow] = current.length
        ? await tx
            .select({ n: count() })
            .from(attemptAnswers)
            .where(
              and(
                eq(attemptAnswers.attemptId, attemptId),
                eq(attemptAnswers.isCorrect, true),
                inArray(
                  attemptAnswers.questionId,
                  current.map((q) => q.id),
                ),
              ),
            )
        : [{ n: 0 }];
      const score = scorePercent(Number(correctRow?.n ?? 0), current.length);
      await tx
        .update(attempts)
        .set({ status: 'finished', scorePercent: String(score), finishedAt: now })
        .where(eq(attempts.id, attemptId));

      const [before] = await tx
        .select()
        .from(topicMastery)
        .where(and(eq(topicMastery.studentId, studentId), eq(topicMastery.topicId, quiz.topicId)));
      const best = Math.max(Number(before?.bestPercent ?? 0), score);
      const newlyMastered = !before?.masteredAt && best >= threshold;
      const values = {
        bestPercent: String(best),
        attemptsCount: (before?.attemptsCount ?? 0) + 1,
        masteredAt: before?.masteredAt ?? (newlyMastered ? now : null),
      };
      await tx
        .insert(topicMastery)
        .values({ studentId, topicId: quiz.topicId, ...values })
        .onConflictDoUpdate({ target: [topicMastery.studentId, topicMastery.topicId], set: values });

      const [event] = await tx
        .insert(learningEvents)
        .values({
          studentId,
          type: 'quiz_finished',
          subjectId: topic?.subjectId ?? null,
          topicId: quiz.topicId,
          occurredAt: now,
          idempotencyKey: quizEventKey(attemptId),
        })
        .returning();
      if (newlyMastered) {
        await tx
          .insert(learningEvents)
          .values({
            studentId,
            type: 'topic_mastered',
            subjectId: topic?.subjectId ?? null,
            topicId: quiz.topicId,
            occurredAt: now,
            idempotencyKey: `topic_mastered:${quiz.topicId}`,
          })
          .onConflictDoNothing();
      }
      const { xpAwarded, badgesAwarded } = await this.gamification.process(
        tx,
        {
          id: event!.id,
          studentId,
          type: 'quiz_finished',
          topicId: quiz.topicId,
          idempotencyKey: event!.idempotencyKey,
        },
        locale,
      );
      return { scorePercent: score, xpAwarded, badgesAwarded };
    });
  }

  private result(
    question: Question,
    correct: boolean,
    options: Array<typeof answerOptions.$inferSelect>,
    translations: Array<typeof qt.$inferSelect>,
    locale: Locale,
  ): AnswerResultDto {
    return {
      correct,
      correctOptionId: options.find((o) => o.questionId === question.id && o.isCorrect)?.id ?? null,
      correctAnswer: question.type === 'text_input' ? question.textAnswer : null,
      explanation:
        pickTranslation(
          translations.filter((t) => t.questionId === question.id),
          locale,
        )?.explanation ?? null,
    };
  }

  private questions(quizId: string): Promise<Question[]> {
    return this.db
      .select()
      .from(questions)
      .where(and(eq(questions.quizId, quizId), isNull(questions.archivedAt)))
      .orderBy(asc(questions.position), asc(questions.id));
  }

  private async visibleQuiz(studentId: string, quizId: string): Promise<{ topicId: string }> {
    const [quiz] = await this.db
      .select({ topicId: quizzes.topicId })
      .from(quizzes)
      .where(eq(quizzes.id, quizId));
    if (!quiz || !(await this.visibility.canStudentSeeTopic(studentId, quiz.topicId))) throw notFound();
    return quiz;
  }

  private async ownAttempt(studentId: string, attemptId: string): Promise<Attempt> {
    const [attempt] = await this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.studentId, studentId)));
    if (!attempt) throw notFound();
    return attempt;
  }

  private invalid(fieldErrors: Record<string, string>) {
    return new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', fieldErrors);
  }
}
