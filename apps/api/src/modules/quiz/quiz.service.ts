import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, max } from 'drizzle-orm';
import { getMessage, LOCALES, type Locale, type Messages, type QuestionDto } from '@syntara/shared';
import ru from '@syntara/shared/i18n/ru.json';
import kk from '@syntara/shared/i18n/kk.json';
import en from '@syntara/shared/i18n/en.json';
import { type Database, schema } from '@syntara/db';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { type QuestionItemDto, type QuizDto } from './quiz.dto';

const { quizzes, questions, questionTranslations: qt, answerOptions, answerOptionTranslations: aot } = schema;
const { attemptAnswers } = schema;

const BUNDLES: Record<Locale, Messages> = { ru, kk, en };

/** BR-QZ-02, PH-28: два фиксированных варианта «Верно» / «Неверно» на всех языках интерфейса. */
const TRUE_FALSE_TEXTS = (['optionTrue', 'optionFalse'] as const).map((key) =>
  Object.fromEntries(LOCALES.map((l) => [l, getMessage(BUNDLES[l], `teacher.quiz.${key}`) ?? ''])),
) as Array<Record<Locale, string>>;

/**
 * Вопросы квиза темы (8.3.5): владение проверяет OwnershipGuard (BR-ACL-01). Правильность хранится в варианте
 * и одинакова для всех языков (REQ-TCH-QZ-03); ровно один правильный — Zod и ux_one_correct (BR-QZ-02).
 */
@Injectable()
export class QuizService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** API-T-19 */
  async get(topicId: string): Promise<QuizDto> {
    const quizId = await this.quizOf(topicId);
    const rows = await this.db
      .select()
      .from(questions)
      .where(and(eq(questions.quizId, quizId), isNull(questions.archivedAt)))
      .orderBy(asc(questions.position), asc(questions.id));
    if (rows.length === 0) return { quizId, questions: [] };
    const ids = rows.map((r) => r.id);
    const [translations, options] = await Promise.all([
      this.db.select().from(qt).where(inArray(qt.questionId, ids)),
      this.db
        .select()
        .from(answerOptions)
        .where(inArray(answerOptions.questionId, ids))
        .orderBy(asc(answerOptions.position)),
    ]);
    const optionTr = options.length
      ? await this.db
          .select()
          .from(aot)
          .where(
            inArray(
              aot.optionId,
              options.map((o) => o.id),
            ),
          )
      : [];
    return {
      quizId,
      questions: rows.map((q, i): QuestionItemDto => ({
        id: q.id,
        number: i + 1,
        type: q.type,
        difficulty: q.difficulty,
        textAnswer: q.textAnswer,
        translations: Object.fromEntries(
          translations
            .filter((t) => t.questionId === q.id)
            .map((t) => [t.locale!, { text: t.text, explanation: t.explanation }]),
        ),
        options: options
          .filter((o) => o.questionId === q.id)
          .map((o) => ({
            id: o.id,
            isCorrect: o.isCorrect,
            translations: Object.fromEntries(
              optionTr.filter((t) => t.optionId === o.id).map((t) => [t.locale!, t.text]),
            ),
          })),
      })),
    };
  }

  /** API-T-20: вопрос в конец списка. */
  async create(topicId: string, dto: QuestionDto): Promise<{ id: string }> {
    const quizId = await this.quizOf(topicId);
    return this.db.transaction(async (tx) => {
      await tx.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, quizId)).for('update');
      const [last] = await tx
        .select({ position: max(questions.position) })
        .from(questions)
        .where(eq(questions.quizId, quizId));
      return { id: await this.insert(tx, quizId, (last?.position ?? 0) + 1, dto) };
    });
  }

  /**
   * API-T-21 PUT. На вопрос ещё не отвечали — замена на месте. Если ответы есть (attempt_answers ссылаются на
   * варианты), старый вопрос архивируется, а новый встаёт на его позицию: история попыток не меняется.
   */
  async update(questionId: string, dto: QuestionDto): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [question] = await tx.select().from(questions).where(eq(questions.id, questionId)).for('update');
      const [answers] = await tx
        .select({ n: count() })
        .from(attemptAnswers)
        .where(eq(attemptAnswers.questionId, questionId));
      if (Number(answers?.n ?? 0) > 0) {
        await tx.update(questions).set({ archivedAt: new Date() }).where(eq(questions.id, questionId));
        return { id: await this.insert(tx, question!.quizId, question!.position, dto) };
      }
      const oldOptions = await tx
        .select({ id: answerOptions.id })
        .from(answerOptions)
        .where(eq(answerOptions.questionId, questionId));
      if (oldOptions.length) {
        await tx.delete(aot).where(
          inArray(
            aot.optionId,
            oldOptions.map((o) => o.id),
          ),
        );
        await tx.delete(answerOptions).where(eq(answerOptions.questionId, questionId));
      }
      await tx.delete(qt).where(eq(qt.questionId, questionId));
      await tx
        .update(questions)
        .set({ type: dto.type, difficulty: dto.difficulty, textAnswer: this.textAnswer(dto) })
        .where(eq(questions.id, questionId));
      await this.insertContent(tx, questionId, dto);
      return { id: questionId };
    });
  }

  /** API-T-21 DELETE: архивирование (учебные сущности не удаляются физически, 5.1). */
  async archive(questionId: string): Promise<void> {
    await this.db.update(questions).set({ archivedAt: new Date() }).where(eq(questions.id, questionId));
  }

  private async insert(tx: Tx, quizId: string, position: number, dto: QuestionDto): Promise<string> {
    const [row] = await tx
      .insert(questions)
      .values({
        quizId,
        type: dto.type,
        difficulty: dto.difficulty,
        position,
        textAnswer: this.textAnswer(dto),
      })
      .returning({ id: questions.id });
    await this.insertContent(tx, row!.id, dto);
    return row!.id;
  }

  private async insertContent(tx: Tx, questionId: string, dto: QuestionDto): Promise<void> {
    const translations = Object.entries(dto.translations).flatMap(([locale, t]) =>
      t
        ? [{ questionId, locale: locale as Locale, text: t.text, explanation: t.explanation?.trim() || null }]
        : [],
    );
    await tx.insert(qt).values(translations);
    if (dto.type === 'text_input') return;
    const options =
      dto.type === 'true_false'
        ? dto
            .options!.slice(0, 2)
            .map((o, i) => ({ isCorrect: o.isCorrect, translations: TRUE_FALSE_TEXTS[i]! }))
        : dto.options!.map((o) => ({ isCorrect: o.isCorrect, translations: o.translations }));
    for (const [i, option] of options.entries()) {
      const [row] = await tx
        .insert(answerOptions)
        .values({ questionId, position: i + 1, isCorrect: option.isCorrect })
        .returning({ id: answerOptions.id });
      const texts = Object.entries(option.translations).flatMap(([locale, text]) =>
        text ? [{ optionId: row!.id, locale: locale as Locale, text }] : [],
      );
      await tx.insert(aot).values(texts);
    }
  }

  private textAnswer(dto: QuestionDto): string | null {
    return dto.type === 'text_input' ? dto.textAnswer!.trim() : null;
  }

  /** Квиз темы (тема seed могла остаться без квиза — создаётся при первом обращении). */
  private async quizOf(topicId: string): Promise<string> {
    await this.db.insert(quizzes).values({ topicId }).onConflictDoNothing({ target: quizzes.topicId });
    const [quiz] = await this.db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.topicId, topicId));
    return quiz!.id;
  }
}
