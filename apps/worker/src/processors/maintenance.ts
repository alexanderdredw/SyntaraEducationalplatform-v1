import { and, eq, lt, sql } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';

/** BR-SUP-02: resolved → closed через 7 дней без ответа пользователя. */
export const AUTO_CLOSE_DAYS = 7;

/**
 * Автозакрытие (SM-TICKET auto_close). Ответ пользователя переводит обращение в reopened и сбрасывает
 * resolved_at, поэтому «7 дней без ответа» = 7 дней в статусе resolved. Смена статуса пишется
 * в ticket_status_history и audit_log (BR-SUP-03); автор — система (changed_by = NULL).
 */
export async function autoCloseResolved(db: Database, now = new Date()): Promise<number> {
  const { supportTickets: t, ticketStatusHistory: h, auditLog } = schema;
  const threshold = new Date(now.getTime() - AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.status, 'resolved'), lt(t.resolvedAt, threshold)))
      .for('update', { skipLocked: true });
    for (const { id } of due) {
      await tx.update(t).set({ status: 'closed', closedAt: now }).where(eq(t.id, id));
      await tx.insert(h).values({
        ticketId: id,
        fromStatus: 'resolved',
        toStatus: 'closed',
        changedBy: null,
        changedAt: now,
      });
      await tx.insert(auditLog).values({
        actorId: null,
        entityType: 'support_ticket',
        entityId: id,
        action: 'status_change',
        before: { status: 'resolved' },
        after: { status: 'closed' },
      });
    }
    return due.length;
  });
}

/** API-GEN-05: удаление просроченных ключей идемпотентности (роль app_maintenance, 5.8). */
export async function cleanupIdempotencyKeys(db: Database): Promise<number> {
  const k = schema.idempotencyKeys;
  const deleted = await db
    .delete(k)
    .where(lt(k.expiresAt, sql`now()`))
    .returning({ key: k.key });
  return deleted.length;
}
