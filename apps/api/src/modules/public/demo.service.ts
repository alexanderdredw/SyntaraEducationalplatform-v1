import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type DemoAnswerDto, type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { type DemoAnswerResponse, type DemoQuestionDto } from './public.dto';

const { questions: q, questionTranslations: qt, answerOptions: o, answerOptionTranslations: ot } = schema;
const { quizzes, topics } = schema;

interface DemoQuestion {
  id: string;
  translations: Array<typeof qt.$inferSelect>;
  options: Array<{
    id: string;
    position: number;
    isCorrect: boolean;
    translations: Array<typeof ot.$inferSelect>;
  }>;
}

/**
 * Пробный вопрос гостя (API-PUB-02/03, SM-DEMO, BR-QZ-09): вопрос настоящего урока с is_demo = true из
 * опубликованной темы официального каталога. Правильный ответ до проверки не отдаётся (BR-QZ-01);
 * проверка ничего не пишет в БД — ни событий, ни баллов.
 */
@Injectable()
export class DemoService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** API-PUB-02: случайный пробный вопрос, кроме `exclude` (если есть другие). */
  async question(locale: Locale, exclude: string | undefined): Promise<DemoQuestionDto> {
    const ids = await this.visibleIds();
    if (ids.length === 0) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No demo question');
    const pool = ids.length > 1 && exclude ? ids.filter((id) => id !== exclude) : ids;
    const question = await this.load(pool[randomInt(0, pool.length)]!);
    const tr = pickTranslation(question.translations, locale);
    // «Перейти к предмету» для вошедшего ученика ведёт на страницу предмета вопроса (решение владельца 2026-10-14).
    const [subject] = await this.db
      .select({ id: topics.subjectId })
      .from(q)
      .innerJoin(quizzes, eq(quizzes.id, q.quizId))
      .innerJoin(topics, eq(topics.id, quizzes.topicId))
      .where(eq(q.id, question.id));
    return {
      id: question.id,
      subjectId: subject!.id,
      version: versionOf(question),
      text: tr?.text ?? '',
      options: question.options.map((opt) => ({
        id: opt.id,
        text: pickTranslation(opt.translations, tr?.locale ?? locale)?.text ?? '',
      })),
      hasAnother: ids.length > 1,
      locale: tr?.locale ?? locale,
    };
  }

  /** API-PUB-03: результат проверки; другая версия вопроса — 409 (вопрос изменился, нужно загрузить заново). */
  async answer(dto: DemoAnswerDto, locale: Locale): Promise<DemoAnswerResponse> {
    const ids = await this.visibleIds();
    if (!ids.includes(dto.questionId)) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const question = await this.load(dto.questionId);
    if (versionOf(question) !== dto.version) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Question has changed');
    }
    const chosen = question.options.find((opt) => opt.id === dto.optionId);
    if (!chosen) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const correct = question.options.find((opt) => opt.isCorrect)!;
    const tr = pickTranslation(question.translations, locale);
    return {
      correct: chosen.isCorrect,
      correctOptionId: correct.id,
      explanation: tr?.explanation ?? null,
      locale: tr?.locale ?? locale,
    };
  }

  private async visibleIds(): Promise<string[]> {
    const { subjects } = schema;
    const rows = await this.db
      .select({ id: q.id })
      .from(q)
      .innerJoin(quizzes, eq(quizzes.id, q.quizId))
      .innerJoin(topics, eq(topics.id, quizzes.topicId))
      .innerJoin(subjects, eq(subjects.id, topics.subjectId))
      .where(
        and(
          eq(q.isDemo, true),
          isNull(q.archivedAt),
          eq(topics.status, 'published'),
          isNull(topics.archivedAt),
          eq(subjects.inPublicCatalog, true),
          isNull(subjects.archivedAt),
        ),
      )
      .orderBy(asc(q.id));
    return rows.map((r) => r.id);
  }

  private async load(id: string): Promise<DemoQuestion> {
    const translations = await this.db.select().from(qt).where(eq(qt.questionId, id));
    const options = await this.db
      .select({ id: o.id, position: o.position, isCorrect: o.isCorrect })
      .from(o)
      .where(eq(o.questionId, id))
      .orderBy(asc(o.position), asc(o.id));
    const optionTranslations = options.length
      ? await this.db
          .select()
          .from(ot)
          .where(
            inArray(
              ot.optionId,
              options.map((opt) => opt.id),
            ),
          )
      : [];
    return {
      id,
      translations,
      options: options.map((opt) => ({
        ...opt,
        translations: optionTranslations.filter((t) => t.optionId === opt.id),
      })),
    };
  }
}

/** Версия вопроса — хеш его содержимого: меняется при любой правке текста, вариантов или ответа. */
function versionOf(question: DemoQuestion): string {
  const canonical = JSON.stringify({
    t: question.translations
      .map((t) => [t.locale, t.text, t.explanation])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    o: question.options.map((opt) => [
      opt.id,
      opt.position,
      opt.isCorrect,
      opt.translations
        .map((t) => [t.locale, t.text])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ]),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
