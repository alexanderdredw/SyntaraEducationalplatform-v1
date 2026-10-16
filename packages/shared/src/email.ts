import { type Locale, type SupportCategory } from './enums';

/**
 * Письма через transactional outbox (раздел 2.1, BR-FRM-01): api в одной транзакции пишет запись,
 * строку email_queue и событие outbox_events; worker публикует событие в очередь `email` и отправляет письмо.
 */
export const OUTBOX_EVENT_TYPES = {
  /** BR-FRM-01: подтверждение заявки школы или обращения. */
  emailConfirmation: 'email.confirmation',
  /** API-SUP-04: ответ сотрудника по обращению. */
  emailTicketReply: 'email.ticket_reply',
  /** API-AUTH-03, API-AUTH-04: письма аккаунта. */
  emailAccount: 'email.account',
  /** API-T-17, BR-FILE-03: загруженный файл — в очередь проверки file-scan. */
  fileScan: 'file.scan',
} as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[keyof typeof OUTBOX_EVENT_TYPES];

export interface OutboxEmailPayload {
  emailQueueId: string;
}

/** Событие file.scan и задание очереди file-scan (SM-FILE). */
export interface OutboxFileScanPayload {
  mediaId: string;
}

export const EMAIL_TEMPLATES = {
  schoolRequestConfirmation: 'school_request.confirmation',
  supportTicketConfirmation: 'support_ticket.confirmation',
  ticketReply: 'ticket.reply',
  accountRegistered: 'auth.registered',
  passwordReset: 'auth.password_reset',
  emailVerify: 'auth.email_verify',
} as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[keyof typeof EMAIL_TEMPLATES];

/** BR-FRM-03: номер, тип, способ ответа — без текста заявки или обращения. */
export interface ConfirmationEmailPayload {
  locale: Locale;
  publicNumber: string;
  replyEmail: string;
  category?: SupportCategory;
}

/** API-SUP-04: текст ответа сотрудника; токен для Reply-To создаёт worker при отправке (в БД — только хеш). */
export interface TicketReplyEmailPayload {
  locale: Locale;
  publicNumber: string;
  body: string;
  ticketId: string;
  ticketMessageId: string;
}

/** API-AUTH-03: письмо после регистрации учителя со ссылкой подтверждения email (API-AUTH-06). */
export interface AccountRegisteredPayload {
  locale: Locale;
  displayName: string;
  userId: string;
}

/** API-AUTH-06: повторная отправка ссылки подтверждения. */
export interface EmailVerifyPayload {
  locale: Locale;
  userId: string;
}

/**
 * API-AUTH-04: ссылку сброса создаёт worker при отправке — в БД и очереди нет самого токена;
 * в Redis хранится только хеш токена с TTL PH-06 `auth.reset_link_ttl_hours`.
 */
export interface PasswordResetPayload {
  locale: Locale;
  userId: string;
}

/** Ключ Redis для хеша токена сброса пароля (sha256 hex). */
export const passwordResetKey = (tokenHash: string) => `pwreset:${tokenHash}`;

/** Ключ Redis для хеша токена подтверждения email (sha256 hex). */
export const emailVerifyKey = (tokenHash: string) => `emailverify:${tokenHash}`;
