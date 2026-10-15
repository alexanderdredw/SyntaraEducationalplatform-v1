import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { type Database } from '@syntara/db';
import { createWorkers, QUEUE_NAMES, SCHEDULES, scheduleJobs } from '../src/queues';

/** Integration (Testcontainers Redis 7): worker регистрирует все очереди раздела 2.2 и обрабатывает задания. */
describe('worker queues', () => {
  let redis: StartedRedisContainer;
  let connection: Redis;
  const deps = {
    db: {} as Database,
    transport: { sendMail: async () => ({}) },
    mailFrom: 'noreply@syntara-edu.me',
    tokens: { set: async () => 'OK' },
    appBaseUrl: 'http://localhost:3000',
  };

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

  it('REQ-NFR-SEC-07 processes jobs on not-yet-implemented queues without logging their payload', async () => {
    const lines: string[] = [];
    const logger = pino({}, { write: (line: string) => lines.push(line) });
    const { close } = createWorkers(connection, logger, deps);
    try {
      for (const name of ['file-scan', 'recalc'] as const) {
        const queue = new Queue(name, { connection });
        // QueueEvents по умолчанию читает поток с «$» и не видит события, записанные до первого XREAD:
        // если worker завершал задание раньше, «completed» терялся и тест падал по таймауту.
        // Очередь в контейнере новая — читаем с начала потока; блокирующее чтение — на своём соединении.
        const eventsConnection = connection.duplicate();
        const events = new QueueEvents(name, { connection: eventsConnection, lastEventId: '0-0' });
        await events.waitUntilReady();
        const job = await queue.add('probe', { email: 'kid@example.kz' });
        const result = await job.waitUntilFinished(events, 10_000);
        expect(result).toEqual({ queue: name, handled: false });
        await Promise.all([queue.close(), events.close()]);
        await eventsConnection.quit();
      }
      expect(lines.join('')).not.toContain('kid@example.kz');
    } finally {
      await close();
    }
  });

  it('BR-FRM-01, BR-SUP-02, API-GEN-05 schedules outbox polling, auto-close and idempotency cleanup', async () => {
    await scheduleJobs(connection);
    await scheduleJobs(connection); // повторный запуск не плодит расписания
    for (const queueName of ['outbox', 'cleanup'] as const) {
      const queue = new Queue(queueName, { connection });
      const schedulers = await queue.getJobSchedulers();
      const expected = SCHEDULES.filter((s) => s.queue === queueName).map((s) => s.id);
      expect(schedulers.map((s) => s.key).sort()).toEqual([...expected].sort());
      await queue.close();
    }
  });
});
