import { type Queue } from 'bullmq';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { type Logger } from 'pino';
import { OUTBOX_EVENT_TYPES, type OutboxEmailPayload, type OutboxFileScanPayload } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { FILE_SCAN_JOB_OPTIONS } from './file-scan';

/** BullMQ: повтор отправки письма с экспоненциальной задержкой (BR-FRM-04, AC-FRM-05). */
export const EMAIL_JOB_OPTIONS = {
  attempts: 10,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

const BATCH = 50;
const EMAIL_EVENTS = new Set<string>([
  OUTBOX_EVENT_TYPES.emailConfirmation,
  OUTBOX_EVENT_TYPES.emailTicketReply,
  OUTBOX_EVENT_TYPES.emailAccount,
]);

export interface OutboxQueues {
  email: Queue;
  /** BR-FILE-03: событие file.scan → очередь file-scan (jobId = mediaId — без повторной проверки). */
  fileScan?: Queue;
}

/**
 * Transactional outbox: необработанные события берутся с FOR UPDATE SKIP LOCKED (несколько worker не берут
 * одно событие), публикуются в очередь `email` и помечаются processed_at в той же транзакции.
 * jobId = id строки email_queue, поэтому повторная публикация после сбоя не дублирует письмо.
 */
export async function processOutbox(db: Database, queues: OutboxQueues, logger: Logger): Promise<number> {
  const { email: emailQueue, fileScan } = queues;
  const { outboxEvents: o } = schema;
  return db.transaction(async (tx) => {
    const events = await tx
      .select()
      .from(o)
      .where(isNull(o.processedAt))
      .orderBy(asc(o.createdAt))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    let published = 0;
    for (const event of events) {
      try {
        if (event.type === OUTBOX_EVENT_TYPES.fileScan && fileScan) {
          const { mediaId } = event.payload as OutboxFileScanPayload;
          await fileScan.add('scan', { mediaId }, { ...FILE_SCAN_JOB_OPTIONS, jobId: mediaId });
        } else if (EMAIL_EVENTS.has(event.type)) {
          const { emailQueueId } = event.payload as OutboxEmailPayload;
          await emailQueue.add('send', { emailQueueId }, { ...EMAIL_JOB_OPTIONS, jobId: emailQueueId });
        } else {
          throw new Error(`Unknown outbox event type "${event.type}"`);
        }
        await tx
          .update(o)
          .set({ processedAt: new Date(), attempts: sql`${o.attempts} + 1`, lastError: null })
          .where(eq(o.id, event.id));
        published += 1;
      } catch (err) {
        logger.warn(
          { eventId: event.id, type: event.type, err: (err as Error).message },
          'outbox publish failed',
        );
        await tx
          .update(o)
          .set({ attempts: sql`${o.attempts} + 1`, lastError: (err as Error).message.slice(0, 500) })
          .where(and(eq(o.id, event.id), isNull(o.processedAt)));
      }
    }
    return published;
  });
}
