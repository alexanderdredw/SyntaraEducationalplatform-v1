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
  const APP = 'http://localhost:3000';
  const extra = () => ({ tokens: connection, appBaseUrl: APP });

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
    expect(await processOutbox(db, { email: emailQueue }, logger)).toBe(1);
    expect(await processOutbox(db, { email: emailQueue }, logger)).toBe(0);

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
        ...extra(),
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
    expect(
      await sendEmail(job(email.id), { db, transport: okTransport, mailFrom: 'x@y.kz', logger, ...extra() }),
    ).toBe('skipped');
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
    const deps = { db, transport: down, mailFrom: 'noreply@syntara-edu.me', logger, ...extra() };
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
      ...extra(),
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

  it('API-AUTH-03, API-AUTH-06 registration email greets the teacher and carries a verification link', async () => {
    const [email] = await db
      .insert(schema.emailQueue)
      .values({
        toEmail: 'new.teacher@example.kz',
        template: EMAIL_TEMPLATES.accountRegistered,
        payload: { locale: 'ru', displayName: 'Айгерим', userId: '0190a1b2-0000-7000-8000-0000000000aa' },
      })
      .returning();
    await sendEmail(job(email!.id), {
      db,
      transport: okTransport,
      mailFrom: 'noreply@syntara-edu.me',
      logger,
      ...extra(),
    });
    expect(sent[0]).toMatchObject({ to: 'new.teacher@example.kz' });
    expect(sent[0]!.text).toContain('Айгерим');
    const token = /verifyToken=([A-Za-z0-9_-]+)/.exec(sent[0]!.text)?.[1];
    expect(sent[0]!.text).toContain('http://localhost:3000/ru/auth/login?verifyToken=');
    expect(token).toBeDefined();
    const key = `emailverify:${createHash('sha256').update(token!).digest('hex')}`;
    expect(await connection.get(key)).toBe('0190a1b2-0000-7000-8000-0000000000aa');
  });

  it('API-AUTH-06 resend email: subject «Подтвердите email» and a fresh one-time link', async () => {
    const [email] = await db
      .insert(schema.emailQueue)
      .values({
        toEmail: 'resend@example.kz',
        template: EMAIL_TEMPLATES.emailVerify,
        payload: { locale: 'ru', userId: '0190a1b2-0000-7000-8000-0000000000bb' },
      })
      .returning();
    await sendEmail(job(email!.id), {
      db,
      transport: okTransport,
      mailFrom: 'noreply@syntara-edu.me',
      logger,
      ...extra(),
    });
    expect(sent[0]!.subject).toBe('Подтвердите email');
    expect(sent[0]!.text).toMatch(/verifyToken=/);
  });

  it('API-AUTH-04 reset email carries a one-time link; Redis keeps only the token hash with PH-06 TTL', async () => {
    const userId = '0190a1b2-0000-7000-8000-000000000001';
    const [email] = await db
      .insert(schema.emailQueue)
      .values({
        toEmail: 'teacher@example.kz',
        template: EMAIL_TEMPLATES.passwordReset,
        payload: { locale: 'kk', userId },
      })
      .returning();
    await sendEmail(job(email!.id), {
      db,
      transport: okTransport,
      mailFrom: 'noreply@syntara-edu.me',
      logger,
      ...extra(),
    });
    const link = /http:\/\/localhost:3000\/kk\/auth\/login\?resetToken=([A-Za-z0-9_-]+)/.exec(sent[0]!.text);
    expect(link).not.toBeNull();
    const token = link![1]!;
    const key = `pwreset:${createHash('sha256').update(token).digest('hex')}`;
    expect(await connection.get(key)).toBe(userId);
    const ttl = await connection.ttl(key);
    expect(ttl).toBeGreaterThan(23 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    expect(await connection.keys(`*${token}*`)).toEqual([]);
    const [row] = await db.select().from(schema.emailQueue).where(eq(schema.emailQueue.id, email!.id));
    expect(JSON.stringify(row!.payload)).not.toContain(token);
  });

  it('AC-PRF-06 BR-PRF-07 email change: a 24-hour link to the new address; «Ваш email изменён» with «Это не я»; password notice', async () => {
    const userId = '0190a1b2-0000-7000-8000-0000000000cc';
    const send = async (template: string, toEmail: string, payload: object) => {
      const [email] = await db.insert(schema.emailQueue).values({ toEmail, template, payload }).returning();
      await sendEmail(job(email!.id), {
        db,
        transport: okTransport,
        mailFrom: 'noreply@syntara-edu.me',
        logger,
        ...extra(),
      });
      return sent.at(-1)!;
    };

    const change = await send(EMAIL_TEMPLATES.emailChange, 'new@example.kz', {
      locale: 'ru',
      userId,
      email: 'new@example.kz',
    });
    expect(change.to).toBe('new@example.kz');
    expect(change.subject).toBe('Подтвердите новый email');
    const token = /\/ru\/auth\/login\?verifyToken=([A-Za-z0-9_-]+)/.exec(change.text)![1]!;
    const key = `emailchange:${createHash('sha256').update(token).digest('hex')}`;
    expect(JSON.parse((await connection.get(key))!)).toEqual({ userId, email: 'new@example.kz' });
    const ttl = await connection.ttl(key);
    expect(ttl).toBeGreaterThan(23 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);

    const changed = await send(EMAIL_TEMPLATES.emailChanged, 'old@example.kz', { locale: 'ru' });
    expect(changed.subject).toBe('Ваш email изменён');
    expect(changed.text).toContain('Это не я: http://localhost:3000/ru/support');

    const password = await send(EMAIL_TEMPLATES.passwordChanged, 'old@example.kz', { locale: 'kk' });
    expect(password.subject).toBe('Құпиясөз өзгертілді');
    expect(password.text).toContain('http://localhost:3000/kk/support');
  });

  it('REQ-NFR-SEC-07 worker logs contain neither email addresses nor message text', () => {
    const log = lines.join('');
    expect(log).not.toContain('user@example.kz');
    expect(log).not.toContain('Ответ сотрудника');
  });
});
