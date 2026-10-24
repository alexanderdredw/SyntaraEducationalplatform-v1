import { and, eq, lt, sql } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';
import { FILE_SCAN_JOB_OPTIONS } from './file-scan';

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

/** SM-ATTEMPT: срок бездействия незавершённой попытки. */
export const ABANDON_AFTER_DAYS = 30;

/**
 * SM-ATTEMPT: in_progress --(30 дней без активности)--> abandoned. Активность — старт попытки или последний ответ.
 * Брошенная попытка не продолжается: следующий старт квиза создаёт новую (BR-QZ-06).
 */
export async function abandonStaleAttempts(db: Database, now = new Date()): Promise<number> {
  const { quizAttempts: a, attemptAnswers: ans } = schema;
  const threshold = new Date(now.getTime() - ABANDON_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const updated = await db
    .update(a)
    .set({ status: 'abandoned' })
    .where(
      and(
        eq(a.status, 'in_progress'),
        lt(a.startedAt, threshold),
        sql`NOT EXISTS (SELECT 1 FROM ${ans} WHERE ${ans.attemptId} = ${a.id} AND ${ans.answeredAt} >= ${threshold.toISOString()}::timestamptz)`,
      ),
    )
    .returning({ id: a.id });
  return updated.length;
}

/** AC-DEL-09: сколько ждать после передачи в очередь, прежде чем считать проверку зависшей. */
export const STUCK_SCAN_MINUTES = 10;

/**
 * AC-DEL-09 (docs/DELETE_TZ.md, раздел 5): файл загружен (событие file.scan передано в очередь), но всё ещё
 * pending — у задания проверки кончились повторы (ClamAV или olevba долго недоступны) или задание потеряно.
 * Такое задание запускается снова: упавшее — retry, отсутствующее — заново с тем же jobId. Проверка
 * не ослабляется — файл по-прежнему проходит ClamAV и olevba.
 */
export async function requeueStuckScans(
  db: Database,
  queue: {
    getJob(id: string): Promise<{ getState(): Promise<string>; retry(): Promise<void> } | undefined>;
    add(name: string, data: { mediaId: string }, opts: object): Promise<unknown>;
  },
  now = new Date(),
): Promise<number> {
  const { mediaFiles: m, outboxEvents: o } = schema;
  const threshold = new Date(now.getTime() - STUCK_SCAN_MINUTES * 60 * 1000);
  const stuck = await db
    .select({ id: m.id })
    .from(m)
    .innerJoin(o, sql`${o.type} = 'file.scan' AND ${o.payload}->>'mediaId' = ${m.id}::text`)
    .where(and(eq(m.scanStatus, 'pending'), lt(o.processedAt, threshold)));
  let requeued = 0;
  for (const { id } of stuck) {
    const job = await queue.getJob(id);
    const state = job ? await job.getState() : 'missing';
    if (state === 'failed') await job!.retry();
    else if (state === 'missing')
      await queue.add('scan', { mediaId: id }, { ...FILE_SCAN_JOB_OPTIONS, jobId: id });
    else continue; // ждёт, выполняется или в задержке перед повтором — не мешаем.
    requeued += 1;
  }
  return requeued;
}
