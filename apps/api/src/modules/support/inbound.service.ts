import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { type InboundEmailDto } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { DB } from '../../infra/tokens';
import { notFound, TicketsService } from './tickets.service';

/** Хеш токена ответа: в ticket_reply_tokens хранится только он (тот же расчёт — в worker). */
export function replyTokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * API-SUP-08: ответ пользователя на письмо. Связь с обращением — по токену из адреса Reply-To.
 * resolved/closed → reopened (BR-SUP-01, AC-SUP-02); waiting_user → in_progress (SM-TICKET user_reply).
 * TODO(OWNER): проверка подписи вебхука и сверка отправителя с email обращения зависят от провайдера (Q-10).
 */
@Injectable()
export class InboundService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tickets: TicketsService,
  ) {}

  async receive(dto: InboundEmailDto): Promise<void> {
    const { ticketReplyTokens: tokens, ticketMessages } = schema;
    await this.db.transaction(async (tx) => {
      const [token] = await tx
        .select({ ticketId: tokens.ticketId })
        .from(tokens)
        .where(and(eq(tokens.tokenHash, replyTokenHash(dto.token)), gt(tokens.expiresAt, sql`now()`)));
      if (!token?.ticketId) throw notFound();
      const ticket = await this.tickets.lock(tx, token.ticketId);
      await tx.insert(ticketMessages).values({
        ticketId: ticket.id,
        direction: 'in',
        authorId: ticket.userId,
        body: dto.text,
        isInternal: false,
        sentAt: new Date(),
      });
      await this.tickets.applyEvent(tx, ticket, 'user_reply', ticket.userId);
    });
  }
}
