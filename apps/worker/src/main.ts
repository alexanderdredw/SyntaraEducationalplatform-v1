import './instrument';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { createDb } from '@syntara/db';
import { loadEnv } from './env';
import { createWorkers, scheduleJobs } from './queues';

const env = loadEnv(process.env);
const logger = pino({ name: 'worker' });
// BullMQ требует maxRetriesPerRequest: null для блокирующих команд.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const db = createDb(env.DATABASE_URL, { max: 5 });
const transport = nodemailer.createTransport(env.SMTP_URL);

const { workers, close } = createWorkers(connection, logger, {
  db,
  transport,
  mailFrom: env.MAIL_FROM,
  tokens: connection,
  appBaseUrl: env.APP_BASE_URL,
});
void scheduleJobs(connection).catch((err: Error) => logger.error({ err: err.message }, 'scheduling failed'));
logger.info({ queues: workers.map((w) => w.name) }, 'worker started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker stopping');
  await close();
  await Promise.allSettled([connection.quit(), db.$client.end({ timeout: 5 })]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
