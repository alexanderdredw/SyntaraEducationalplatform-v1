import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type ConfirmationEmailPayload,
  EMAIL_TEMPLATES,
  type Locale,
  OUTBOX_EVENT_TYPES,
  type OutboxEmailPayload,
  type SchoolRequestDto,
  type SupportTicketDto,
} from '@syntara/shared';
import { schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { IdempotencyService, type StoredResponse, type Tx } from '../../common/idempotency';
import { ENV, type Env } from '../../config/env';
import { generatePublicNumber, PUBLIC_NUMBER_ATTEMPTS, type PublicNumberPrefix } from './public-number';

export interface FormCreated {
  publicNumber: string;
  email: string;
}

const emptyToNull = (v: string | undefined) => (v ? v : null);

/**
 * API-PUB-04/05. В одной транзакции (BR-FRM-01): запись, ключ идемпотентности с ответом,
 * строка email_queue и событие outbox_events('email.confirmation'). Ошибка отправки письма
 * возникает позже, в worker, и запись не отменяет (BR-FRM-04).
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly idempotency: IdempotencyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  createSchoolRequest(
    dto: SchoolRequestDto,
    rawBody: unknown,
    key: string,
    locale: Locale,
  ): Promise<StoredResponse<FormCreated>> {
    return this.idempotency.execute('public.school-requests', key, rawBody, async (tx) => {
      const publicNumber = await this.insertWithNumber('SR', (n) =>
        tx
          .insert(schema.schoolRequests)
          .values({
            publicNumber: n,
            schoolName: dto.schoolName,
            region: emptyToNull(dto.region),
            city: emptyToNull(dto.city),
            contactPerson: dto.contactPerson,
            phone: emptyToNull(dto.phone),
            email: dto.email,
            message: emptyToNull(dto.message),
          })
          .onConflictDoNothing({ target: schema.schoolRequests.publicNumber })
          .returning({ id: schema.schoolRequests.id }),
      );
      await this.enqueueConfirmation(tx, EMAIL_TEMPLATES.schoolRequestConfirmation, dto.email, {
        locale,
        publicNumber,
        replyEmail: dto.email,
      });
      return { status: HttpStatus.CREATED, body: { publicNumber, email: dto.email } };
    });
  }

  createSupportTicket(
    dto: SupportTicketDto,
    rawBody: unknown,
    key: string,
    locale: Locale,
    userId: string | null,
  ): Promise<StoredResponse<FormCreated>> {
    return this.idempotency.execute('public.support-tickets', key, rawBody, async (tx) => {
      const publicNumber = await this.insertWithNumber('T', (n) =>
        tx
          .insert(schema.supportTickets)
          .values({
            publicNumber: n,
            category: dto.category,
            subject: dto.subject,
            name: emptyToNull(dto.name),
            email: dto.email,
            phone: emptyToNull(dto.phone),
            description: dto.description,
            userId,
            techContext: dto.techContext ?? null,
          })
          .onConflictDoNothing({ target: schema.supportTickets.publicNumber })
          .returning({ id: schema.supportTickets.id }),
      );
      await this.enqueueConfirmation(tx, EMAIL_TEMPLATES.supportTicketConfirmation, dto.email, {
        locale,
        publicNumber,
        replyEmail: dto.email,
        category: dto.category,
      });
      return { status: HttpStatus.CREATED, body: { publicNumber, email: dto.email } };
    });
  }

  /** BR-FRM-02: при коллизии номера (ON CONFLICT DO NOTHING вернул пусто) — новая попытка. */
  private async insertWithNumber(
    prefix: PublicNumberPrefix,
    insert: (publicNumber: string) => Promise<Array<{ id: string }>>,
  ): Promise<string> {
    for (let attempt = 0; attempt < PUBLIC_NUMBER_ATTEMPTS; attempt++) {
      const publicNumber = generatePublicNumber(prefix, new Date(), this.env.PLATFORM_TZ);
      const rows = await insert(publicNumber);
      if (rows.length === 1) return publicNumber;
    }
    throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 'No free public number');
  }

  private async enqueueConfirmation(
    tx: Tx,
    template: string,
    to: string,
    payload: ConfirmationEmailPayload,
  ): Promise<void> {
    const [email] = await tx
      .insert(schema.emailQueue)
      .values({ toEmail: to, template, payload })
      .returning({ id: schema.emailQueue.id });
    await tx.insert(schema.outboxEvents).values({
      type: OUTBOX_EVENT_TYPES.emailConfirmation,
      payload: { emailQueueId: email!.id } satisfies OutboxEmailPayload,
    });
  }
}
