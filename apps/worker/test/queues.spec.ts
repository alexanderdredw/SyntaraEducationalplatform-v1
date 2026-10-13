import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { createWorkers, QUEUE_NAMES } from '../src/queues';

/** Integration (Testcontainers Redis 7): worker регистрирует все очереди раздела 2.2 и обрабатывает задания. */
describe('worker queues', () => {
  let redis: StartedRedisContainer;
  let connection: Redis;

  beforeAll(async () => {
    redis = await new RedisContainer('redis:7-alpine').start();
    connection = new Redis(redis.getConnectionUrl(), { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await connection?.quit();
    await redis?.stop();
  });

  it('registers exactly the queues outbox, email, file-scan, recalc, cleanup', () => {
    expect(QUEUE_NAMES).toEqual(['outbox', 'email', 'file-scan', 'recalc', 'cleanup']);
  });

  it('REQ-NFR-SEC-07 processes a job on every queue without logging its payload', async () => {
    const lines: string[] = [];
    const logger = pino({}, { write: (line: string) => lines.push(line) });
    const workers = createWorkers(connection, logger);
    try {
      for (const name of QUEUE_NAMES) {
        const queue = new Queue(name, { connection });
        const events = new QueueEvents(name, { connection });
        await events.waitUntilReady();
        const job = await queue.add('probe', { email: 'kid@example.kz' });
        const result = await job.waitUntilFinished(events, 10_000);
        expect(result).toEqual({ queue: name, handled: false });
        await Promise.all([queue.close(), events.close()]);
      }
      expect(lines.join('')).not.toContain('kid@example.kz');
    } finally {
      await Promise.all(workers.map((w) => w.close()));
    }
  });
});
