import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  type AnswerDto,
  HINT_LIMIT,
  hintAllowed,
  type HintDto,
  type Locale,
  normalizeAnswer,
  pickHintRemovals,
  scorePercent,
  xpPercent,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { AssignmentsService } from '../assignments/assignments.service';
import { VisibilityService } from '../content/visibility.service';
import { GamificationService, quizEventKey } from '../gamification/gamification.service';
import {
  type AnswerResultDto,
  type AttemptDto,
  type FinishResultDto,
  type HintResultDto,
} from './student-quiz.dto';

const { quizzes, questions, questionTranslations: qt, answerOptions, answerOptionTranslations: aot } = schema;
const { quizAttempts: attempts, attemptAnswers, attemptHints, topics, topicMastery, learningEvents } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
const invalidTransition = () =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', 'Attempt is not in progress');
const hintConflict = (code: 'hintLimit' | 'hintUnavailable') =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Hint is not available', { hint: code });

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
    private readonly assignments: AssignmentsService,
  ) {}

  /**
   * API-S-07: начать или продолжить попытку. Из задания (Q-18) — с assignmentId: назначение действующего класса по
   * этой теме; незавершённая попытка продолжается и связывается с заданием (BR-ASG-03).
   */
  async start(studentId: string, quizId: string, locale: Locale, assignmentId?: string): Promise<AttemptDto> {
    const quiz = await this.visibleQuiz(studentId, quizId);
    if (assignmentId) await this.assignments.assertStudentAssignment(studentId, assignmentId, quiz.topicId);
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
      if (current) {
        if (!assignmentId || current.assignmentId === assignmentId) return current;
        const [linked] = await tx
          .update(attempts)
          .set({ assignmentId })
          .where(eq(attempts.id, current.id))
          .returning();
        return linked!;
      }
      const [topic] = await tx
        .select({ versionId: topics.publishedVersionId })
        .from(topics)
        .where(eq(topics.id, quiz.topicId));
      // BR-QZ-08: попытка связана с опубликованной версией темы на момент старта.
      const [created] = await tx
        .insert(attempts)
        .values({
          studentId,
          quizId,
          topicVersionId: topic?.versionId ?? null,
          assignmentId: assignmentId ?? null,
        })
        .returning();
      return created!;
    });

    const ids = list.map((q) => q.id);
    const [translations, options, optionTr, answers, hints] = await Promise.all([
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
      this.db.select().from(attemptHints).where(eq(attemptHints.attemptId, attempt.id)),
    ]);
    const hinted = new Map(hints.map((h) => [h.questionId, h.removedOptionIds]));

    const answered: AttemptDto['answered'] = {};
    for (const a of answers) {
      const q = list.find((x) => x.id === a.questionId);
      if (!q) continue;
      answered[a.questionId!] = {
        optionId: a.optionId,
        textAnswer: a.textAnswer,
        ...this.result(q, a.isCorrect, hinted.has(q.id), options, translations, locale),
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
      // REQ-TST-04: подсказки «50/50» этой попытки — убранные варианты по id вопроса и сколько осталось.
      hints: Object.fromEntries(hinted),
      hintsLeft: Math.max(0, HINT_LIMIT - hints.length),
    };
  }

  /**
   * API-S-28 (REQ-TST-04, BR-TST-01): подсказка «50/50» — сервер убирает два случайных неверных варианта и записывает
   * это в попытку. Одна на вопрос (повторный запрос возвращает ту же), не больше трёх на попытку; только до ответа и
   * только у выбора из 4 и более вариантов.
   */
  async hint(studentId: string, attemptId: string, dto: HintDto): Promise<HintResultDto> {
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
    return this.db.transaction(async (tx) => {
      // Блокировка попытки: два одновременных запроса не превысят лимит.
      await tx.select({ id: attempts.id }).from(attempts).where(eq(attempts.id, attemptId)).for('update');
      const used = await tx.select().from(attemptHints).where(eq(attemptHints.attemptId, attemptId));
      const existing = used.find((h) => h.questionId === question.id);
      if (existing)
        return {
          questionId: question.id,
          removedOptionIds: existing.removedOptionIds,
          hintsLeft: Math.max(0, HINT_LIMIT - used.length),
        };
      const [answered] = await tx
        .select({ id: attemptAnswers.questionId })
        .from(attemptAnswers)
        .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, question.id)));
      if (answered) throw hintConflict('hintUnavailable');
      if (used.length >= HINT_LIMIT) throw hintConflict('hintLimit');
      const options = await tx
        .select({ id: answerOptions.id, isCorrect: answerOptions.isCorrect })
        .from(answerOptions)
        .where(eq(answerOptions.questionId, question.id));
      const correct = options.find((o) => o.isCorrect);
      if (!correct || !hintAllowed(question.type, options.length, used.length))
        throw hintConflict('hintUnavailable');
      const removedOptionIds = pickHintRemovals(
        options.map((o) => o.id),
        correct.id,
        randomInt,
      );
      await tx.insert(attemptHints).values({ attemptId, questionId: question.id, removedOptionIds });
      return { questionId: question.id, removedOptionIds, hintsLeft: HINT_LIMIT - used.length - 1 };
    });
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
    const [options, translations, [hint]] = await Promise.all([
      this.db.select().from(answerOptions).where(eq(answerOptions.questionId, question.id)),
      this.db.select().from(qt).where(eq(qt.questionId, question.id)),
      this.db
        .select({ id: attemptHints.questionId })
        .from(attemptHints)
        .where(and(eq(attemptHints.attemptId, attemptId), eq(attemptHints.questionId, question.id))),
    ]);
    const hinted = Boolean(hint);

    const [previous] = await this.db
      .select()
      .from(attemptAnswers)
      .where(and(eq(attemptAnswers.attemptId, attemptId), eq(attemptAnswers.questionId, question.id)));
    if (previous) return this.result(question, previous.isCorrect, hinted, options, translations, locale);

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
    return this.result(question, correct, hinted, options, translations, locale);
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
      const [given, hints] = current.length
        ? await Promise.all([
            tx
              .select({ questionId: attemptAnswers.questionId, correct: attemptAnswers.isCorrect })
              .from(attemptAnswers)
              .where(
                and(
                  eq(attemptAnswers.attemptId, attemptId),
                  inArray(
                    attemptAnswers.questionId,
                    current.map((q) => q.id),
                  ),
                ),
              ),
            tx
              .select({ questionId: attemptHints.questionId })
              .from(attemptHints)
              .where(eq(attemptHints.attemptId, attemptId)),
          ])
        : [[], []];
      const hinted = new Set(hints.map((h) => h.questionId));
      const marked = given.map((a) => ({ correct: a.correct, hinted: hinted.has(a.questionId!) }));
      // BR-QZ-05: верный с подсказкой — верный (освоение, задания); BR-TST-01: для XP он весит 0,5.
      const score = scorePercent(marked.filter((a) => a.correct).length, current.length);
      const forXp = xpPercent(marked, current.length);
      // REQ-TST-05.2: прошлые завершённые попытки этой темы — лучший результат и разница с прошлой.
      const prior = await tx
        .select({ score: attempts.scorePercent })
        .from(attempts)
        .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
        .where(
          and(
            eq(attempts.studentId, studentId),
            eq(quizzes.topicId, quiz.topicId),
            eq(attempts.status, 'finished'),
            ne(attempts.id, attemptId),
          ),
        )
        .orderBy(desc(attempts.finishedAt));
      const priorScores = prior.map((p) => Number(p.score ?? 0));
      await tx
        .update(attempts)
        .set({ status: 'finished', scorePercent: String(score), xpPercent: String(forXp), finishedAt: now })
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
      // BR-ASG-03: сдача «Оценено» с лучшим результатом (PH-29) — по заданию попытки и по всем заданиям этой темы
      // действующих классов ученика, выданным до завершения попытки.
      await this.assignments.recordSubmissions(tx, {
        assignmentId: attempt.assignmentId,
        topicId: quiz.topicId,
        studentId,
        attemptId,
        score,
        finishedAt: now,
      });
      return {
        scorePercent: score,
        xpAwarded,
        badgesAwarded,
        bestPercent: Math.max(score, ...priorScores),
        previousPercent: priorScores[0] ?? null,
      };
    });
  }

  private result(
    question: Question,
    correct: boolean,
    hinted: boolean,
    options: Array<typeof answerOptions.$inferSelect>,
    translations: Array<typeof qt.$inferSelect>,
    locale: Locale,
  ): AnswerResultDto {
    return {
      correct,
      hinted,
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
