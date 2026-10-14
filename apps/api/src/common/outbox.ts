import { type OutboxEmailPayload, type OutboxEventType } from '@syntara/shared';
import { schema } from '@syntara/db';
import { type Tx } from './idempotency';

/**
 * Письмо через transactional outbox (раздел 2.1): строка email_queue и событие outbox_events пишутся
 * в транзакции вызывающего кода; отправляет worker.
 */
export async function enqueueEmail(
  tx: Tx,
  event: OutboxEventType,
  template: string,
  to: string,
  payload: object,
): Promise<string> {
  const [email] = await tx
    .insert(schema.emailQueue)
    .values({ toEmail: to, template, payload })
    .returning({ id: schema.emailQueue.id });
  await tx.insert(schema.outboxEvents).values({
    type: event,
    payload: { emailQueueId: email!.id } satisfies OutboxEmailPayload,
  });
  return email!.id;
}
