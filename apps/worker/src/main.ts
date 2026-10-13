import './instrument';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { createWorkers } from './queues';

const env = z
  .object({
    REDIS_URL: z.url(),
    // DATABASE_URL, SMTP_URL, CLAMD_HOST, OLEVBA_URL станут обязательными вместе с процессорами (итерации 4, 7).
  })
  .parse(process.env);

const logger = pino({ name: 'worker' });
// BullMQ требует maxRetriesPerRequest: null для блокирующих команд.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workers = createWorkers(connection, logger);
logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker stopping');
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
