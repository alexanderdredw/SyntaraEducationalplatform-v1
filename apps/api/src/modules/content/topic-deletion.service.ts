import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';

const {
  topics,
  topicTranslations: tt,
  topicVersions,
  topicMaterials,
  topicSections,
  topicSectionTranslations,
} = schema;
const { quizzes, questions, questionTranslations, answerOptions, answerOptionTranslations } = schema;
const { quizAttempts, assignments } = schema;
const { learningEvents, aiConversations, topicMastery, battleQuestions } = schema;

/** Почему черновик нельзя удалить (BR-DEL-01). */
export type DeleteBlocker = 'topicHasHistory' | 'topicHasAssignments';

const conflict = (key: DeleteBlocker) =>
  new ApiException(HttpStatus.CONFLICT, 'CONFLICT', `Topic cannot be deleted: ${key}`, { topic: key });

/**
 * Удаление черновика темы (docs/DELETE_TZ.md, BR-DEL-01…03, API-T-30). Удалить можно только то, что не видели
 * ученики: тема ни разу не публиковалась (нет версий и published_version_id) и у неё нет следов учеников
 * (попыток, событий, освоения, диалогов ИИ — защита на случай старых данных). Тема с заданием не удаляется.
 * Результаты, попытки и опубликованные версии не затрагиваются — для таких тем удаление запрещено.
 */
@Injectable()
export class TopicDeletionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /** Причина запрета для каждой темы; тем без причины в результате нет (их можно удалить). */
  async blockers(topicIds: string[], db: Tx | Database = this.db): Promise<Map<string, DeleteBlocker>> {
    const result = new Map<string, DeleteBlocker>();
    if (topicIds.length === 0) return result;
    const ids = topicIds;
    const [published, versions, attempts, events, mastery, conversations, assigned] = await Promise.all([
      db
        .select({ id: topics.id })
        .from(topics)
        .where(and(inArray(topics.id, ids), isNotNull(topics.publishedVersionId))),
      db
        .selectDistinct({ id: topicVersions.topicId })
        .from(topicVersions)
        .where(inArray(topicVersions.topicId, ids)),
      db
        .selectDistinct({ id: quizzes.topicId })
        .from(quizAttempts)
        .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
        .where(inArray(quizzes.topicId, ids)),
      db
        .selectDistinct({ id: learningEvents.topicId })
        .from(learningEvents)
        .where(inArray(learningEvents.topicId, ids)),
      db
        .selectDistinct({ id: topicMastery.topicId })
        .from(topicMastery)
        .where(inArray(topicMastery.topicId, ids)),
      db
        .selectDistinct({ id: aiConversations.topicId })
        .from(aiConversations)
        .where(inArray(aiConversations.topicId, ids)),
      db
        .selectDistinct({ id: assignments.topicId })
        .from(assignments)
        .where(inArray(assignments.topicId, ids)),
    ]);
    for (const row of [...published, ...versions, ...attempts, ...events, ...mastery, ...conversations])
      if (row.id) result.set(row.id, 'topicHasHistory');
    for (const row of assigned) if (row.id && !result.has(row.id)) result.set(row.id, 'topicHasAssignments');
    return result;
  }

  /**
   * API-T-30. Всё — в одной транзакции (BR-DEL-02): переводы, квиз с вопросами и вариантами, разделы, материалы
   * (записи; объекты хранилища — задачей worker после фиксации), сама тема; нумерация оставшихся тем — без
   * пропусков (BR-DEL-03). Обложка из галереи остаётся. Скопированные в Battle вопросы остаются, теряется только
   * ссылка на источник (вопрос Battle — самостоятельная копия, BR-BTL-10).
   */
  async remove(teacherId: string, topicId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [topic] = await tx.select().from(topics).where(eq(topics.id, topicId)).for('update');
      if (!topic) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
      const blocker = (await this.blockers([topicId], tx)).get(topicId);
      if (blocker) throw conflict(blocker);

      const titles = await tx
        .select({ locale: tt.locale, title: tt.title })
        .from(tt)
        .where(eq(tt.topicId, topicId));
      const quizIds = (
        await tx.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.topicId, topicId))
      ).map((q) => q.id);
      if (quizIds.length) {
        const questionIds = (
          await tx.select({ id: questions.id }).from(questions).where(inArray(questions.quizId, quizIds))
        ).map((q) => q.id);
        if (questionIds.length) {
          await tx
            .update(battleQuestions)
            .set({ sourceQuestionId: null })
            .where(inArray(battleQuestions.sourceQuestionId, questionIds));
          const optionIds = (
            await tx
              .select({ id: answerOptions.id })
              .from(answerOptions)
              .where(inArray(answerOptions.questionId, questionIds))
          ).map((o) => o.id);
          if (optionIds.length)
            await tx
              .delete(answerOptionTranslations)
              .where(inArray(answerOptionTranslations.optionId, optionIds));
          await tx.delete(answerOptions).where(inArray(answerOptions.questionId, questionIds));
          await tx.delete(questionTranslations).where(inArray(questionTranslations.questionId, questionIds));
          await tx.delete(questions).where(inArray(questions.id, questionIds));
        }
        await tx.delete(quizzes).where(inArray(quizzes.id, quizIds));
      }
      const sectionIds = (
        await tx
          .select({ id: topicSections.id })
          .from(topicSections)
          .where(eq(topicSections.topicId, topicId))
      ).map((s) => s.id);
      if (sectionIds.length) {
        await tx
          .delete(topicSectionTranslations)
          .where(inArray(topicSectionTranslations.sectionId, sectionIds));
        await tx.delete(topicSections).where(inArray(topicSections.id, sectionIds));
      }
      const materialIds = (
        await tx
          .select({ id: topicMaterials.mediaId })
          .from(topicMaterials)
          .where(eq(topicMaterials.topicId, topicId))
      ).map((m) => m.id!);
      await tx.delete(topicMaterials).where(eq(topicMaterials.topicId, topicId));
      const keys = await this.files.releaseMaterials(tx, materialIds);
      await tx.delete(tt).where(eq(tt.topicId, topicId));
      await tx.delete(topics).where(eq(topics.id, topicId));
      // BR-DEL-03: «Тема N» без пропусков; уникальность (subject_id, position) проверяется в конце транзакции.
      await tx
        .update(topics)
        .set({ position: sql`${topics.position} - 1` })
        .where(and(eq(topics.subjectId, topic.subjectId), gt(topics.position, topic.position)));
      await this.files.enqueueDelete(tx, keys);
      await this.audit.record(
        {
          actorId: teacherId,
          entityType: 'topic',
          entityId: topicId,
          action: 'delete',
          before: {
            subjectId: topic.subjectId,
            number: topic.position,
            titles: Object.fromEntries(titles.map((t) => [t.locale, t.title])),
            materials: materialIds.length,
          },
        },
        tx,
      );
    });
  }
}
