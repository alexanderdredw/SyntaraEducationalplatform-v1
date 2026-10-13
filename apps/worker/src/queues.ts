import { Worker, type ConnectionOptions, type Job, type Processor } from 'bullmq';
import { type Logger } from 'pino';

/** Очереди worker (раздел 2.2 SPEC). */
export const QUEUE_NAMES = ['outbox', 'email', 'file-scan', 'recalc', 'cleanup'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Процессоры-заготовки. Логика появляется по плану: outbox и email — итерация 4 (BR-FRM-*),
 * file-scan — итерация 7 (BR-FILE-03), recalc — итерация 8, cleanup — итерации 4 и 11 (PH-18).
 * Данные задания в журнал не пишутся (REQ-NFR-SEC-07).
 */
export function placeholderProcessor(queue: QueueName, logger: Logger): Processor {
  return async (job: Job) => {
    logger.info({ queue, jobId: job.id, jobName: job.name }, 'job received (no processor yet)');
    return { queue, handled: false };
  };
}

export function createWorkers(connection: ConnectionOptions, logger: Logger): Worker[] {
  return QUEUE_NAMES.map((queue) => {
    const worker = new Worker(queue, placeholderProcessor(queue, logger), { connection });
    worker.on('failed', (job, err) =>
      logger.error({ queue, jobId: job?.id, err: err.message }, 'job failed'),
    );
    return worker;
  });
}
