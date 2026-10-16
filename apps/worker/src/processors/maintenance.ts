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

/** BR-FILE-07: срок незавершённой загрузки. */
export const STALE_UPLOAD_HOURS = 24;

/**
 * BR-FILE-07 (решение владельца 2026-10-16): раз в сутки удаляются незавершённые загрузки — записи «pending»
 * старше 24 часов, которые так и не были подтверждены (API-T-17 не вызван, события file.scan нет), и их объект
 * в хранилище, если он есть. Файлы, ждущие проверки после подтверждения, не трогаются.
 */
export async function cleanupStaleUploads(
  db: Database,
  storage: { remove(key: string): Promise<void> },
  now = new Date(),
): Promise<number> {
  const { mediaFiles: m, topicMaterials, topics, topicSections, outboxEvents: o } = schema;
  const threshold = new Date(now.getTime() - STALE_UPLOAD_HOURS * 60 * 60 * 1000);
  const keys = await db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: m.id, key: m.storageKey })
      .from(m)
      .where(
        and(
          eq(m.scanStatus, 'pending'),
          lt(m.createdAt, threshold),
          sql`NOT EXISTS (SELECT 1 FROM ${o} WHERE ${o.type} = 'file.scan' AND ${o.payload}->>'mediaId' = ${m.id}::text)`,
        ),
      )
      .for('update', { skipLocked: true });
    for (const { id } of stale) {
      await tx.delete(topicMaterials).where(eq(topicMaterials.mediaId, id));
      await tx.update(topics).set({ coverMediaId: null }).where(eq(topics.coverMediaId, id));
      await tx
        .update(topicSections)
        .set({ illustrationMediaId: null })
        .where(eq(topicSections.illustrationMediaId, id));
      await tx.delete(m).where(eq(m.id, id));
    }
    return stale.map((s) => s.key);
  });
  // Объекта может не быть (загрузка не началась) — удаление отсутствующего ключа в S3 не ошибка.
  for (const key of keys) await storage.remove(key).catch(() => undefined);
  return keys.length;
}
