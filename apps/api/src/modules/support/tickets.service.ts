import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, isNull, lte, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  EMAIL_TEMPLATES,
  firstResponseDueAt,
  latestCreatedForDue,
  type Locale,
  OUTBOX_EVENT_TYPES,
  type OutboxEmailPayload,
  staffStatusTargets,
  type SupportHours,
  type TicketEvent,
  type TicketListQuery,
  type TicketReplyEmailPayload,
  type TicketStatus,
  ticketTransition,
  type UserRole,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { AppConfigService } from '../../config/app-config.service';
import { ENV, type Env } from '../../config/env';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { ProfileService } from '../profiles/profile.service';
import { cursorCondition, likeEscape, newestFirst, page } from './pagination';
import {
  type TicketDetail,
  type TicketListItem,
  type TicketListResponse,
  type TicketMessageDto,
} from './support.dto';

const { supportTickets: t, ticketMessages: m, ticketStatusHistory: h, users } = schema;
const assignee = alias(users, 'assignee');

type TicketRow = typeof t.$inferSelect;

/** Ответ по шаблону меняет статус по SM-TICKET (раздел 9). */
export const TEMPLATE_EVENTS: Readonly<Record<string, TicketEvent>> = {
  clarification: 'ask_user',
  resolution: 'resolve',
};

export const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
export const invalidTransition = (from: string, to: string) =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `Transition ${from} → ${to} is not allowed`);

/**
 * Служебная очередь обращений (API-SUP-01..06, REQ-SUP-01..04). ИИ не используется.
 * Все смены статуса — в ticket_status_history и audit_log, смены ответственного — в audit_log (BR-SUP-03),
 * в одной транзакции с изменением.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly profiles: ProfileService,
  ) {}

  /** API-SUP-09 (BR-PRF-06): сбросить картинку-аватар пользователя обращения на инициалы. */
  async resetUserAvatar(id: string, actorId: string): Promise<TicketDetail> {
    const [ticket] = await this.db.select({ userId: t.userId }).from(t).where(eq(t.id, id));
    if (!ticket?.userId) throw notFound();
    await this.profiles.resetPhoto(ticket.userId, actorId, { ticketId: id });
    return this.get(id);
  }

  /** API-SUP-01: фильтры status, assigneeId, category, dueBefore, q (номер или email); новые — первыми. */
  async list(query: TicketListQuery): Promise<TicketListResponse> {
    const hours = await this.config.get<SupportHours>('support.hours');
    const conditions: Array<SQL | undefined> = [
      query.status ? eq(t.status, query.status) : undefined,
      query.category ? eq(t.category, query.category) : undefined,
      query.assigneeId === 'none'
        ? isNull(t.assigneeId)
        : query.assigneeId
          ? eq(t.assigneeId, query.assigneeId)
          : undefined,
      // Срок монотонен по времени создания — фильтр по сроку точно сводится к границе created_at.
      query.dueBefore
        ? lte(t.createdAt, latestCreatedForDue(new Date(query.dueBefore), hours, this.env.PLATFORM_TZ))
        : undefined,
      query.q
        ? or(ilike(t.publicNumber, `${likeEscape(query.q)}%`), ilike(t.email, `%${likeEscape(query.q)}%`))
        : undefined,
      cursorCondition(query.cursor, t.createdAt, t.id),
    ];
    const rows = await this.db
      .select({
        id: t.id,
        publicNumber: t.publicNumber,
        category: t.category,
        subject: t.subject,
        email: t.email,
        status: t.status,
        createdAt: t.createdAt,
        assigneeId: assignee.id,
        assigneeName: assignee.displayName,
      })
      .from(t)
      .leftJoin(assignee, eq(assignee.id, t.assigneeId))
      .where(and(...conditions))
      .orderBy(...newestFirst(t.createdAt, t.id))
      .limit(query.limit + 1);

    const { rows: items, nextCursor } = page(rows, query.limit);
    return {
      items: items.map((r) => ({
        id: r.id,
        publicNumber: r.publicNumber,
        category: r.category,
        subject: r.subject,
        email: r.email,
        status: r.status,
        assignee: r.assigneeId ? { id: r.assigneeId, displayName: r.assigneeName! } : null,
        createdAt: r.createdAt.toISOString(),
        dueAt: firstResponseDueAt(r.createdAt, hours, this.env.PLATFORM_TZ).toISOString(),
      })),
      nextCursor,
    };
  }

  /** API-SUP-02: обращение, tech_context, переписка, внутренние заметки, история статусов, шаблоны ответа. */
  async get(id: string): Promise<TicketDetail> {
    const [row] = await this.db
      .select({ ticket: t, assigneeName: assignee.displayName })
      .from(t)
      .leftJoin(assignee, eq(assignee.id, t.assigneeId))
      .where(eq(t.id, id));
    if (!row) throw notFound();
    const { ticket } = row;
    const hours = await this.config.get<SupportHours>('support.hours');
    const locale = ticketLocale(ticket);

    const author = alias(users, 'author');
    const messages = await this.db
      .select({ message: m, authorName: author.displayName })
      .from(m)
      .leftJoin(author, eq(author.id, m.authorId))
      .where(eq(m.ticketId, id))
      .orderBy(asc(m.createdAt), asc(m.id));

    const changer = alias(users, 'changer');
    const history = await this.db
      .select({ entry: h, changerName: changer.displayName })
      .from(h)
      .leftJoin(changer, eq(changer.id, h.changedBy))
      .where(eq(h.ticketId, id))
      .orderBy(asc(h.changedAt), asc(h.id));

    const templates = await this.db
      .select({ code: schema.responseTemplates.code, body: schema.responseTemplates.body })
      .from(schema.responseTemplates)
      .where(eq(schema.responseTemplates.locale, locale))
      .orderBy(asc(schema.responseTemplates.code));

    return {
      ...toListItem(ticket, row.assigneeName, hours, this.env.PLATFORM_TZ),
      user: ticket.userId
        ? { id: ticket.userId, hasPhotoAvatar: await this.profiles.hasPhoto(ticket.userId) }
        : null,
      name: ticket.name,
      phone: ticket.phone,
      description: ticket.description,
      techContext: (ticket.techContext as TicketDetail['techContext']) ?? null,
      locale,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      messages: messages.map(({ message, authorName }) => toMessage(message, authorName)),
      history: history.map(({ entry, changerName }) => ({
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        changedBy: entry.changedBy ? { id: entry.changedBy, displayName: changerName! } : null,
        changedAt: entry.changedAt.toISOString(),
      })),
      templates: templates.map((tpl) => ({
        code: tpl.code!,
        body: tpl.body.replaceAll('{number}', ticket.publicNumber),
      })),
      allowedStatuses: staffStatusTargets(ticket.status),
    };
  }

  /** API-SUP-03: ответственный — сотрудник поддержки; new/reopened → in_progress (SM-TICKET assign). */
  async assign(id: string, assigneeId: string, actorId: string): Promise<TicketDetail> {
    await this.db.transaction(async (tx) => {
      const ticket = await this.lock(tx, id);
      if (!(await hasRole(tx, assigneeId, 'support_agent'))) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'Assignee must be a support agent',
          {
            assigneeId: 'invalidAssignee',
          },
        );
      }
      if (ticket.assigneeId !== assigneeId) {
        await tx.update(t).set({ assigneeId }).where(eq(t.id, id));
        await this.audit.record(
          {
            actorId,
            entityType: 'support_ticket',
            entityId: id,
            action: 'assign',
            before: { assigneeId: ticket.assigneeId },
            after: { assigneeId },
          },
          tx,
        );
      }
      const to = ticketTransition(ticket.status, 'assign');
      if (to) await this.changeStatus(tx, ticket, to, actorId);
    });
    return this.get(id);
  }

  /**
   * API-SUP-04: ответ клиенту — сообщение 'out', строка email_queue и событие outbox в одной транзакции.
   * Шаблон задаёт переход SM-TICKET (решение владельца 2026-10-14): «Уточнение» → waiting_user (ask_user),
   * «Решение» → resolved (resolve). Если из текущего статуса переход недопустим, ответ отправляется без смены статуса.
   */
  async reply(
    id: string,
    body: string,
    templateCode: string | undefined,
    actorId: string,
  ): Promise<TicketDetail> {
    await this.db.transaction(async (tx) => {
      const ticket = await this.lock(tx, id);
      const locale = ticketLocale(ticket);
      if (templateCode) {
        const [template] = await tx
          .select({ code: schema.responseTemplates.code })
          .from(schema.responseTemplates)
          .where(
            and(eq(schema.responseTemplates.code, templateCode), eq(schema.responseTemplates.locale, locale)),
          );
        if (!template) {
          throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown template', {
            templateCode: 'invalidTemplate',
          });
        }
      }
      const [message] = await tx
        .insert(m)
        .values({ ticketId: id, direction: 'out', authorId: actorId, body, isInternal: false })
        .returning({ id: m.id });
      const payload: TicketReplyEmailPayload = {
        locale,
        publicNumber: ticket.publicNumber,
        body,
        ticketId: id,
        ticketMessageId: message!.id,
      };
      const [email] = await tx
        .insert(schema.emailQueue)
        .values({ toEmail: ticket.email, template: EMAIL_TEMPLATES.ticketReply, payload })
        .returning({ id: schema.emailQueue.id });
      await tx.insert(schema.outboxEvents).values({
        type: OUTBOX_EVENT_TYPES.emailTicketReply,
        payload: { emailQueueId: email!.id } satisfies OutboxEmailPayload,
      });
      await this.audit.record(
        {
          actorId,
          entityType: 'support_ticket',
          entityId: id,
          action: 'reply',
          after: { messageId: message!.id, templateCode: templateCode ?? null },
        },
        tx,
      );
      const event = templateCode ? TEMPLATE_EVENTS[templateCode] : undefined;
      if (event) await this.applyEvent(tx, ticket, event, actorId);
    });
    return this.get(id);
  }

  /** API-SUP-05: внутренняя заметка — не отправляется клиенту (REQ-SUP-02). */
  async note(id: string, body: string, actorId: string): Promise<TicketDetail> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx, id);
      await tx
        .insert(m)
        .values({ ticketId: id, direction: 'note', authorId: actorId, body, isInternal: true });
    });
    return this.get(id);
  }

  /** API-SUP-06: только разрешённые сотруднику переходы SM-TICKET, иначе 409 INVALID_TRANSITION. */
  async setStatus(id: string, to: TicketStatus, actorId: string): Promise<TicketDetail> {
    await this.db.transaction(async (tx) => {
      const ticket = await this.lock(tx, id);
      if (!staffStatusTargets(ticket.status).includes(to)) throw invalidTransition(ticket.status, to);
      await this.changeStatus(tx, ticket, to, actorId);
    });
    return this.get(id);
  }

  /**
   * Переход по событию пользователя или системы (API-SUP-08, BR-SUP-01).
   * Возвращает новый статус или null, если событие из текущего статуса не меняет его.
   */
  async applyEvent(
    tx: Tx,
    ticket: TicketRow,
    event: TicketEvent,
    actorId: string | null,
  ): Promise<TicketStatus | null> {
    const to = ticketTransition(ticket.status, event);
    if (to) await this.changeStatus(tx, ticket, to, actorId);
    return to;
  }

  async lock(tx: Tx, id: string): Promise<TicketRow> {
    const [ticket] = await tx.select().from(t).where(eq(t.id, id)).for('update');
    if (!ticket) throw notFound();
    return ticket;
  }

  private async changeStatus(
    tx: Tx,
    ticket: TicketRow,
    to: TicketStatus,
    actorId: string | null,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(t)
      .set({
        status: to,
        ...(to === 'resolved' ? { resolvedAt: now } : {}),
        ...(to === 'closed' ? { closedAt: now } : {}),
        ...(to === 'reopened' ? { resolvedAt: null, closedAt: null } : {}),
      })
      .where(eq(t.id, ticket.id));
    await tx
      .insert(h)
      .values({ ticketId: ticket.id, fromStatus: ticket.status, toStatus: to, changedBy: actorId });
    await this.audit.record(
      {
        actorId,
        entityType: 'support_ticket',
        entityId: ticket.id,
        action: 'status_change',
        before: { status: ticket.status },
        after: { status: to },
      },
      tx,
    );
    ticket.status = to;
  }
}

/** Язык писем по обращению: язык интерфейса из techContext (REQ-PUB-SUP-03), иначе ru. */
export function ticketLocale(ticket: TicketRow): Locale {
  const locale = (ticket.techContext as { locale?: string } | null)?.locale;
  return locale === 'kk' || locale === 'en' || locale === 'ru' ? locale : 'ru';
}

export async function hasRole(tx: Tx | Database, userId: string, role: UserRole): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.userRoles.id })
    .from(schema.userRoles)
    .innerJoin(users, eq(users.id, schema.userRoles.userId))
    .where(
      and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.role, role), eq(users.status, 'active')),
    );
  return Boolean(row);
}

function toListItem(
  ticket: TicketRow,
  assigneeName: string | null,
  hours: SupportHours,
  tz: string,
): TicketListItem {
  return {
    id: ticket.id,
    publicNumber: ticket.publicNumber,
    category: ticket.category,
    subject: ticket.subject,
    email: ticket.email,
    status: ticket.status,
    assignee: ticket.assigneeId ? { id: ticket.assigneeId, displayName: assigneeName! } : null,
    createdAt: ticket.createdAt.toISOString(),
    dueAt: firstResponseDueAt(ticket.createdAt, hours, tz).toISOString(),
  };
}

function toMessage(message: typeof m.$inferSelect, authorName: string | null): TicketMessageDto {
  return {
    id: message.id,
    direction: message.direction as TicketMessageDto['direction'],
    body: message.body,
    isInternal: message.isInternal,
    author: message.authorId ? { id: message.authorId, displayName: authorName! } : null,
    createdAt: message.createdAt.toISOString(),
    sentAt: message.sentAt?.toISOString() ?? null,
  };
}
