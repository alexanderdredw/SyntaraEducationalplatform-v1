import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from 'bullmq';
import { type Logger } from 'pino';
import { type OutboxFileScanPayload } from '@syntara/shared';
import { type Database } from '@syntara/db';
import { type EmailJobData, type MailTransport, sendEmail, type TokenStore } from './processors/email';
import { type ObjectStorage, scanFile } from './processors/file-scan';
import { autoCloseResolved, cleanupIdempotencyKeys } from './processors/maintenance';
import { processOutbox } from './processors/outbox';
import { type Scanners } from './processors/scanners';

/** Очереди worker (раздел 2.2 SPEC). */
export const QUEUE_NAMES = ['outbox', 'email', 'file-scan', 'recalc', 'cleanup'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface WorkerDeps {
  db: Database;
  transport: MailTransport;
  mailFrom: string;
  tokens: TokenStore;
  appBaseUrl: string;
  /** Проверка файлов (BR-FILE-03). */
  storage: ObjectStorage;
  scanners: Scanners;
}

/** Периодические задачи (BullMQ job schedulers): опрос outbox, автозакрытие обращений, очистка ключей. */
export const SCHEDULES = [
  { queue: 'outbox', id: 'outbox-poll', name: 'poll', every: 2_000 },
  { queue: 'cleanup', id: 'auto-close-resolved', name: 'auto-close', every: 60 * 60_000 },
  { queue: 'cleanup', id: 'idempotency-keys', name: 'idempotency-keys', every: 60 * 60_000 },
] as const satisfies ReadonlyArray<{ queue: QueueName; id: string; name: string; every: number }>;

/**
 * Процессор-заготовка для очереди, логика которой появится позже: recalc — итерация 8. Данные задания в журнал не пишутся (REQ-NFR-SEC-07).
 */
export function placeholderProcessor(queue: QueueName, logger: Logger): Processor {
  return async (job: Job) => {
    logger.info({ queue, jobId: job.id, jobName: job.name }, 'job received (no processor yet)');
    return { queue, handled: false };
  };
}

export function createProcessors(
  connection: ConnectionOptions,
  logger: Logger,
  deps: WorkerDeps,
): { processors: Record<QueueName, Processor>; close: () => Promise<void> } {
  const emailQueue = new Queue('email', { connection });
  const fileScanQueue = new Queue('file-scan', { connection });
  const processors: Record<QueueName, Processor> = {
    // BR-FRM-01: события outbox → очередь email.
    outbox: async () => ({
      published: await processOutbox(deps.db, { email: emailQueue, fileScan: fileScanQueue }, logger),
    }),
    // BR-FRM-03/04, API-SUP-04: отправка письма с повторами.
    email: async (job: Job<EmailJobData>) => ({ result: await sendEmail(job, { ...deps, logger }) }),
    // BR-FILE-03, SM-FILE: ClamAV + olevba; отклонённый файл удаляется из хранилища.
    'file-scan': async (job: Job<OutboxFileScanPayload>) => ({
      result: await scanFile(job, { ...deps, logger }),
    }),
    recalc: placeholderProcessor('recalc', logger),
    cleanup: async (job: Job) => {
      if (job.name === 'auto-close') return { closed: await autoCloseResolved(deps.db) };
      if (job.name === 'idempotency-keys') return { deleted: await cleanupIdempotencyKeys(deps.db) };
      return { handled: false };
    },
  };
  return {
    processors,
    close: async () => {
      await Promise.allSettled([emailQueue.close(), fileScanQueue.close()]);
    },
  };
}

export function createWorkers(
  connection: ConnectionOptions,
  logger: Logger,
  deps: WorkerDeps,
): { workers: Worker[]; close: () => Promise<void> } {
  const { processors, close } = createProcessors(connection, logger, deps);
  const workers = QUEUE_NAMES.map((queue) => {
    const worker = new Worker(queue, processors[queue], { connection });
    worker.on('failed', (job, err) =>
      logger.error({ queue, jobId: job?.id, err: err.message }, 'job failed'),
    );
    return worker;
  });
  return {
    workers,
    close: async () => {
      await Promise.allSettled(workers.map((w) => w.close()));
      await close();
    },
  };
}

export async function scheduleJobs(connection: ConnectionOptions): Promise<void> {
  for (const s of SCHEDULES) {
    const queue = new Queue(s.queue, { connection });
    await queue.upsertJobScheduler(
      s.id,
      { every: s.every },
      { name: s.name, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    await queue.close();
  }
}
