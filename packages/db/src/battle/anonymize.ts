import { eq, inArray } from 'drizzle-orm';
import { BATTLE_ANONYMOUS_NAME } from '@syntara/shared';
import { type Database } from '../index';
import { battleAnswers, battleParticipants } from '../schema/battle';

/**
 * BR-BTL-11: исполнение запроса на удаление данных ученика («Мои данные», PH-08 — обращение data_privacy,
 * исполняет сотрудник командой `pnpm battle:anonymize --student=<id>`). Ответы ученика удаляются; в чужой истории
 * и итогах участник показывается как «Участник», итоговые числа (место, правильных, время) сохраняются.
 * Повторный запуск ничего не меняет.
 */
export async function anonymizeStudentBattles(
  db: Database,
  studentId: string,
): Promise<{ participants: number; answers: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: battleParticipants.id })
      .from(battleParticipants)
      .where(eq(battleParticipants.studentId, studentId));
    if (rows.length === 0) return { participants: 0, answers: 0 };
    const ids = rows.map((r) => r.id);
    const deleted = await tx
      .delete(battleAnswers)
      .where(inArray(battleAnswers.participantId, ids))
      .returning({ id: battleAnswers.id });
    await tx
      .update(battleParticipants)
      .set({ displayName: BATTLE_ANONYMOUS_NAME })
      .where(inArray(battleParticipants.id, ids));
    return { participants: ids.length, answers: deleted.length };
  });
}
