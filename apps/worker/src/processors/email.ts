import { createHash, randomBytes } from 'node:crypto';
import { type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { type Logger } from 'pino';
import {
  EMAIL_CHANGE_TTL_SECONDS,
  type EmailChangePayload,
  emailChangeKey,
  EMAIL_TEMPLATES,
  emailVerifyKey,
  passwordResetKey,
  type PasswordResetPayload,
  type TicketReplyEmailPayload,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { renderEmail } from '../templates';

export interface MailMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

/** Хранилище одноразовых токенов (Redis): ключ → значение с TTL в секундах. */
export interface TokenStore {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export interface EmailDeps {
  db: Database;
  transport: MailTransport;
  mailFrom: string;
  logger: Logger;
  /** API-AUTH-04: токены сброса пароля. */
  tokens: TokenStore;
  /** APP_BASE_URL — для ссылок в письмах. */
  appBaseUrl: string;
}

/**
 * API-AUTH-04: одноразовая ссылка сброса пароля. Токен создаётся при отправке; в Redis — только его хеш
 * со сроком PH-06 `auth.reset_link_ttl_hours`. Страница — /auth/login?resetToken=… (маршруты раздела 4).
 */
async function resetLinkFor(deps: EmailDeps, payload: PasswordResetPayload): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hours = await config<number>(deps.db, 'auth.reset_link_ttl_hours');
  const hash = createHash('sha256').update(token).digest('hex');
  await deps.tokens.set(passwordResetKey(hash), payload.userId, 'EX', hours * 60 * 60);
  const base = deps.appBaseUrl.replace(/\/$/, '');
  return `${base}/${payload.locale}/auth/login?resetToken=${encodeURIComponent(token)}`;
}

/**
 * API-AUTH-06: одноразовая ссылка подтверждения email. Токен создаётся при отправке, в Redis — только хеш;
 * срок — как у ссылок восстановления (PH-06 `auth.reset_link_ttl_hours`).
 * TODO(OWNER): отдельный срок для ссылки подтверждения email.
 */
async function verifyLinkFor(deps: EmailDeps, payload: { locale: string; userId: string }): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hours = await config<number>(deps.db, 'auth.reset_link_ttl_hours');
  const hash = createHash('sha256').update(token).digest('hex');
  await deps.tokens.set(emailVerifyKey(hash), payload.userId, 'EX', hours * 60 * 60);
  const base = deps.appBaseUrl.replace(/\/$/, '');
  return `${base}/${payload.locale}/auth/login?verifyToken=${encodeURIComponent(token)}`;
}

/**
 * BR-PRF-07: ссылка подтверждения нового email — на новый адрес, срок 24 часа. В Redis — хеш токена → { userId, email };
 * страница та же, что у подтверждения email (API-AUTH-06).
 */
async function changeLinkFor(deps: EmailDeps, payload: EmailChangePayload): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await deps.tokens.set(
    emailChangeKey(hash),
    JSON.stringify({ userId: payload.userId, email: payload.email }),
    'EX',
    EMAIL_CHANGE_TTL_SECONDS,
  );
  const base = deps.appBaseUrl.replace(/\/$/, '');
  return `${base}/${payload.locale}/auth/login?verifyToken=${encodeURIComponent(token)}`;
}

export interface EmailJobData {
  emailQueueId: string;
}

/** Значение заглушки раздела 11 (с учётом формы { value, prodBlocked }). */
async function config<T>(db: Database, key: string): Promise<T> {
  const [row] = await db
    .select({ value: schema.appConfig.value })
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, key));
  const value = row?.value;
  if (value !== null && typeof value === 'object' && 'prodBlocked' in value && 'value' in value) {
    return (value as { value: T }).value;
  }
  return value as T;
}

/** Хеш токена ответа — тот же расчёт, что в api (inbound.service). */
export const replyTokenHash = (token: string) => createHash('sha256').update(token).digest();

/**
 * Токен для Reply-To ответа по обращению (API-SUP-08): создаётся при отправке, в БД — только хеш.
 * Адрес — email поддержки (PH-09) с плюс-адресацией; срок жизни — срок хранения обращений (PH-18).
 */
async function replyToFor(db: Database, payload: TicketReplyEmailPayload): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const retention = await config<{ tickets: number }>(db, 'retention_days');
  await db.insert(schema.ticketReplyTokens).values({
    ticketId: payload.ticketId,
    tokenHash: replyTokenHash(token),
    expiresAt: new Date(Date.now() + retention.tickets * 24 * 60 * 60 * 1000),
  });
  const supportEmail = await config<string>(db, 'support.email');
  const [local, domain] = supportEmail.split('@');
  return `${local}+${token}@${domain}`;
}

/**
 * Отправка письма из email_queue. Ошибка SMTP увеличивает attempts и пробрасывается — BullMQ повторит
 * с экспоненциальной задержкой; сохранённая заявка/обращение не затрагивается (BR-FRM-04).
 * После последней попытки строка получает статус failed. Содержимое письма в журнал не пишется (REQ-NFR-SEC-07).
 */
export async function sendEmail(job: Job<EmailJobData>, deps: EmailDeps): Promise<'sent' | 'skipped'> {
  const { db, transport, mailFrom, logger } = deps;
  const { emailQueue: q } = schema;
  const [email] = await db.select().from(q).where(eq(q.id, job.data.emailQueueId));
  if (!email) throw new Error('email_queue row not found');
  if (email.status === 'sent') return 'skipped';

  try {
    const resetUrl =
      email.template === EMAIL_TEMPLATES.passwordReset
        ? await resetLinkFor(deps, email.payload as PasswordResetPayload)
        : undefined;
    const verifyUrl =
      email.template === EMAIL_TEMPLATES.accountRegistered || email.template === EMAIL_TEMPLATES.emailVerify
        ? await verifyLinkFor(deps, email.payload as { locale: string; userId: string })
        : undefined;
    const changeUrl =
      email.template === EMAIL_TEMPLATES.emailChange
        ? await changeLinkFor(deps, email.payload as EmailChangePayload)
        : undefined;
    // BR-PRF-07: «Это не я» — страница поддержки.
    const supportUrl = `${deps.appBaseUrl.replace(/\/$/, '')}/${(email.payload as { locale?: string }).locale ?? 'ru'}/support`;
    // BR-PRF-20: ссылка на «Безопасность» в настройках аккаунта.
    const securityUrl = `${deps.appBaseUrl.replace(/[/]$/, '')}/${(email.payload as { locale?: string }).locale ?? 'ru'}/account/settings#security`;
    const rendered = renderEmail(email.template, email.payload, {
      resetUrl,
      verifyUrl: verifyUrl ?? changeUrl,
      supportUrl,
      securityUrl,
    });
    const replyTo =
      email.template === EMAIL_TEMPLATES.ticketReply
        ? await replyToFor(db, email.payload as TicketReplyEmailPayload)
        : undefined;
    await transport.sendMail({
      from: mailFrom,
      to: email.toEmail,
      ...(replyTo ? { replyTo } : {}),
      ...rendered,
    });
  } catch (err) {
    const maxAttempts = job.opts.attempts ?? 1;
    const final = job.attemptsMade + 1 >= maxAttempts;
    await db
      .update(q)
      .set({ attempts: sql`${q.attempts} + 1`, status: final ? 'failed' : 'pending' })
      .where(eq(q.id, email.id));
    logger.warn(
      { emailQueueId: email.id, attempt: job.attemptsMade + 1, final, err: (err as Error).message },
      'email send failed',
    );
    throw err;
  }

  const sentAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(q)
      .set({ status: 'sent', sentAt, attempts: sql`${q.attempts} + 1` })
      .where(eq(q.id, email.id));
    if (email.template === EMAIL_TEMPLATES.ticketReply) {
      const { ticketMessageId } = email.payload as TicketReplyEmailPayload;
      await tx
        .update(schema.ticketMessages)
        .set({ sentAt })
        .where(eq(schema.ticketMessages.id, ticketMessageId));
    }
  });
  logger.info({ emailQueueId: email.id, template: email.template }, 'email sent');
  return 'sent';
}
