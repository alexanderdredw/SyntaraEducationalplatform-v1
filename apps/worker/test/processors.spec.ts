import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { type Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { EMAIL_TEMPLATES, OUTBOX_EVENT_TYPES } from '@syntara/shared';
import { createDb, type Database, schema } from '@syntara/db';
import { migrateUp } from '@syntara/db/migrator';
import { runSeed } from '@syntara/db/seed';
import { type EmailJobData, type MailMessage, sendEmail } from '../src/processors/email';
import { autoCloseResolved, cleanupIdempotencyKeys } from '../src/processors/maintenance';
import { EMAIL_JOB_OPTIONS, processOutbox } from '../src/processors/outbox';

/** Integration (Testcontainers: Postgres 16, Redis 7): outbox, письма, автозакрытие, очистка. */
describe('worker processors', () => {
  let pg: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let db: Database;
  let connection: Redis;
  let emailQueue: Queue;
  const lines: string[] = [];
  const logger = pino({}, { write: (line: string) => lines.push(line) });
  const sent: MailMessage[] = [];
  const okTransport = { sendMail: async (m: MailMessage) => sent.push(m) };

  const job = (emailQueueId: string, attemptsMade = 0) =>
    ({
      data: { emailQueueId },
      attemptsMade,
      opts: { attempts: EMAIL_JOB_OPTIONS.attempts },
    }) as Job<EmailJobData>;

  /** То же, что делает api в одной транзакции (BR-FRM-01). */
  async function queueConfirmation(number: string, description = 'секретный текст обращения') {
    const [ticket] = await db
      .insert(schema.supportTickets)
      .values({
        publicNumber: number,
        category: 'technical',
        subject: 'Тема',
        email: 'user@example.kz',
        description,
      })
      .returning();
    const [email] = await db
      .insert(schema.emailQueue)
      .values({
        toEmail: 'user@example.kz',
        template: EMAIL_TEMPLATES.supportTicketConfirmation,
        payload: { locale: 'ru', publicNumber: number, replyEmail: 'user@example.kz', category: 'technical' },
      })
      .returning();
    await db
      .insert(schema.outboxEvents)
      .values({ type: OUTBOX_EVENT_TYPES.emailConfirmation, payload: { emailQueueId: email!.id } });
    return { ticket: ticket!, email: email! };
  }

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    db = createDb(pg.getConnectionUri(), { max: 3 });
    await migrateUp(db);
    await runSeed(db, 'config');
    connection = new Redis(redis.getConnectionUrl(), { maxRetriesPerRequest: null });
    emailQueue = new Queue('email', { connection });
  });

  afterAll(async () => {
    await emailQueue?.close();
    await connection?.quit();
    await db?.$client.end();
    await Promise.all([pg?.stop(), redis?.stop()]);
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('BR-FRM-01 outbox events are published to the email queue once and marked processed', async () => {
    const { email } = await queueConfirmation('T-261014-0001');
    expect(await processOutbox(db, emailQueue, logger)).toBe(1);
    expect(await processOutbox(db, emailQueue, logger)).toBe(0);

    const queued = await emailQueue.getJob(email.id);
    expect(queued?.data).toEqual({ emailQueueId: email.id });
    expect(queued?.opts.attempts).toBe(EMAIL_JOB_OPTIONS.attempts);
    expect(queued?.opts.backoff).toEqual(EMAIL_JOB_OPTIONS.backoff);
    const events = await db.select().from(schema.outboxEvents);
    expect(events.every((e) => e.processedAt !== null)).toBe(true);
  });

  it('BR-FRM-03 confirmation contains number, type and reply channel, but not the request text', async () => {
    const { email } = await queueConfirmation('T-261014-0002');
    expect(
      await sendEmail(job(email.id), {
        db,
        transport: okTransport,
        mailFrom: 'noreply@syntara-edu.me',
        logger,
      }),
    ).toBe('sent');
    const [message] = sent;
    expect(message).toMatchObject({ to: 'user@example.kz', from: 'noreply@syntara-edu.me' });
    expect(message!.subject).toContain('T-261014-0002');
    expect(message!.text).toContain('T-261014-0002');
    expect(message!.text).toContain('Техническая проблема');
    expect(message!.text).toContain('user@example.kz');
    expect(message!.text).not.toContain('секретный текст обращения');

    const [row] = await db.select().from(schema.emailQueue).where(eq(schema.emailQueue.id, email.id));
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row!.sentAt).toBeInstanceOf(Date);
    // Повторная доставка того же задания письмо не дублирует.
    expect(await sendEmail(job(email.id), { db, transport: okTransport, mailFrom: 'x@y.kz', logger })).toBe(
      'skipped',
    );
    expect(sent).toHaveLength(1);
  });

  it('AC-FRM-05, BR-FRM-04 SMTP failure keeps the record and the email in the queue with growing attempts', async () => {
    const { ticket, email } = await queueConfirmation('T-261014-0003');
    // Недоступный SMTP-сервер (как остановленный mailpit).
    // Свободный порт, на котором никто не слушает: соединение отклоняется сразу на любой ОС.
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = server.address() as { port: number };
        server.close(() => resolve(free));
      });
    });
    const down = nodemailer.createTransport({ host: '127.0.0.1', port, connectionTimeout: 3000 });
    const deps = { db, transport: down, mailFrom: 'noreply@syntara-edu.me', logger };
    await expect(sendEmail(job(email.id, 0), deps)).rejects.toThrow();
    await expect(sendEmail(job(email.id, 1), deps)).rejects.toThrow();

    const [row] = await db.select().from(schema.emailQueue).where(eq(schema.emailQueue.id, email.id));
    expect(row).toMatchObject({ status: 'pending', attempts: 2 });
    const [stored] = await db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.id, ticket.id));
    expect(stored?.status).toBe('new');

    // Последняя попытка помечает письмо как failed.
    await expect(sendEmail(job(email.id, EMAIL_JOB_OPTIONS.attempts - 1), deps)).rejects.toThrow();
    const [final] = await db.select().from(schema.emailQueue).where(eq(schema.emailQueue.id, email.id));
    expect(final).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('API-SUP-04, API-SUP-08 reply email gets a Reply-To token stored only as a hash; message marked sent', async () => {
    const { ticket } = await queueConfirmation('T-261014-0004');
    const [message] = await db
      .insert(schema.ticketMessages)
      .values({ ticketId: ticket.id, direction: 'out', body: 'Ответ сотрудника' })
      .returning();
    const [email] = await db
      .insert(schema.emailQueue)
      .values({
        toEmail: ticket.email,
        template: EMAIL_TEMPLATES.ticketReply,
        payload: {
          locale: 'ru',
          publicNumber: ticket.publicNumber,
          body: 'Ответ сотрудника',
          ticketId: ticket.id,
          ticketMessageId: message!.id,
        },
      })
      .returning();

    await sendEmail(job(email!.id), {
      db,
      transport: okTransport,
      mailFrom: 'noreply@syntara-edu.me',
      logger,
    });
    const [mail] = sent;
    expect(mail!.text).toContain('Ответ сотрудника');
    const token = /^support\+([A-Za-z0-9_-]+)@syntara-edu\.me$/.exec(mail!.replyTo ?? '')?.[1];
    expect(token).toBeDefined();
    const tokens = await db.select().from(schema.ticketReplyTokens);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.ticketId).toBe(ticket.id);
    expect(tokens[0]!.tokenHash.equals(createHash('sha256').update(token!).digest())).toBe(true);
    expect(tokens[0]!.tokenHash.toString('utf8')).not.toContain(token!);

    const [stored] = await db
      .select()
      .from(schema.ticketMessages)
      .where(eq(schema.ticketMessages.id, message!.id));
    expect(stored!.sentAt).toBeInstanceOf(Date);
  });

  it('BR-SUP-02 resolved tickets close after 7 days, with history and audit; younger ones stay resolved', async () => {
    const now = new Date('2026-10-14T10:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const [old] = await db
      .insert(schema.supportTickets)
      .values({
        publicNumber: 'T-261001-0001',
        category: 'other',
        subject: 's',
        email: 'a@example.kz',
        description: 'd',
        status: 'resolved',
        resolvedAt: new Date(now.getTime() - 8 * day),
      })
      .returning();
    const [fresh] = await db
      .insert(schema.supportTickets)
      .values({
        publicNumber: 'T-261010-0001',
        category: 'other',
        subject: 's',
        email: 'b@example.kz',
        description: 'd',
        status: 'resolved',
        resolvedAt: new Date(now.getTime() - 6 * day),
      })
      .returning();

    expect(await autoCloseResolved(db, now)).toBe(1);
    const rows = await db.select().from(schema.supportTickets);
    expect(rows.find((r) => r.id === old!.id)).toMatchObject({ status: 'closed', closedAt: now });
    expect(rows.find((r) => r.id === fresh!.id)?.status).toBe('resolved');

    const history = await db
      .select()
      .from(schema.ticketStatusHistory)
      .where(eq(schema.ticketStatusHistory.ticketId, old!.id));
    expect(history).toEqual([
      expect.objectContaining({ fromStatus: 'resolved', toStatus: 'closed', changedBy: null }),
    ]);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, old!.id));
    expect(audit).toEqual([
      expect.objectContaining({ action: 'status_change', after: { status: 'closed' }, actorId: null }),
    ]);
  });

  it('API-GEN-05 expired idempotency keys are deleted, live ones are kept', async () => {
    const hash = Buffer.from('h');
    await db.insert(schema.idempotencyKeys).values([
      { scope: 's', key: 'old', requestHash: hash, response: {}, expiresAt: new Date(Date.now() - 1000) },
      { scope: 's', key: 'live', requestHash: hash, response: {}, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    expect(await cleanupIdempotencyKeys(db)).toBe(1);
    const keys = await db.select({ key: schema.idempotencyKeys.key }).from(schema.idempotencyKeys);
    expect(keys.map((k) => k.key)).toEqual(['live']);
  });

  it('REQ-NFR-SEC-07 worker logs contain neither email addresses nor message text', () => {
    const log = lines.join('');
    expect(log).not.toContain('user@example.kz');
    expect(log).not.toContain('Ответ сотрудника');
  });
});
