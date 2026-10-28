import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { VisibilityService } from '../content/visibility.service';
import { type TeacherTestDto } from './student-quiz.dto';

const { subjects, topics, quizzes, questions, questionTranslations: qt } = schema;
const { answerOptions, answerOptionTranslations: aot } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

/**
 * API-T-34 (решение владельца 2026-10-28): тест темы для учителя — тот же, что у ученика (вопросы по одному, сразу
 * «верно/неверно» и правильный ответ, экран результата), но проверка идёт в браузере учителя: вопросы приходят вместе
 * с правильным ответом и объяснением, ничего не записывается и XP не начисляются. Тема — своя (любой статус) или
 * опубликованная тема, которую видит гость (базовая программа, BR-VIS-04); иначе 404.
 */
@Injectable()
export class TeacherTestService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly visibility: VisibilityService,
  ) {}

  async test(teacherId: string, topicId: string, locale: Locale): Promise<TeacherTestDto> {
    if (!(await this.owns(teacherId, topicId)) && !(await this.visibility.canGuestSeeTopic(topicId)))
      throw notFound();
    const list = await this.db
      .select({
        id: questions.id,
        type: questions.type,
        difficulty: questions.difficulty,
        textAnswer: questions.textAnswer,
      })
      .from(questions)
      .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
      .where(and(eq(quizzes.topicId, topicId), isNull(questions.archivedAt)))
      .orderBy(asc(questions.position), asc(questions.id));
    if (list.length === 0) return { questions: [] };
    const ids = list.map((q) => q.id);
    const [texts, options, optionTr] = await Promise.all([
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
    ]);
    return {
      questions: list.map((q) => {
        const tr = pickTranslation(
          texts.filter((t) => t.questionId === q.id),
          locale,
        );
        const own = options.filter((o) => o.questionId === q.id);
        return {
          id: q.id,
          type: q.type,
          difficulty: q.difficulty,
          text: tr?.text ?? '',
          options: own.map((o) => ({
            id: o.id,
            text:
              pickTranslation(
                optionTr.filter((t) => t.optionId === o.id),
                locale,
              )?.text ?? '',
          })),
          correctOptionId: own.find((o) => o.isCorrect)?.id ?? null,
          correctAnswer: q.type === 'text_input' ? q.textAnswer : null,
          explanation: tr?.explanation ?? null,
        };
      }),
    };
  }

  private async owns(teacherId: string, topicId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(subjects, eq(subjects.id, topics.subjectId))
      .where(
        and(
          eq(topics.id, topicId),
          isNull(topics.archivedAt),
          eq(subjects.ownerId, teacherId),
          isNull(subjects.archivedAt),
        ),
      );
    return Boolean(row);
  }
}
