import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  canTransitionRequest,
  REQUEST_TRANSITIONS,
  type RequestListQuery,
  type RequestStatus,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { cursorCondition, likeEscape, newestFirst, page } from './pagination';
import { type RequestDetail, type RequestListResponse } from './support.dto';
import { hasRole, invalidTransition, notFound } from './tickets.service';

const { schoolRequests: r, users } = schema;
const assignee = alias(users, 'assignee');
const ENTITY = 'school_request';

/**
 * Очередь школьных заявок (API-SUP-07, роль onboarding_agent). Статусы — SM-REQUEST.
 * Смены статуса и ответственного пишутся в audit_log (REQ-NFR-SEC-05). Читать audit_log роли app_user нельзя (5.8),
 * поэтому отдельной истории у карточки заявки нет — в SPEC она требуется только для обращений (REQ-SUP-02).
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(query: RequestListQuery): Promise<RequestListResponse> {
    const conditions: Array<SQL | undefined> = [
      query.status ? eq(r.status, query.status) : undefined,
      query.assigneeId === 'none'
        ? isNull(r.assigneeId)
        : query.assigneeId
          ? eq(r.assigneeId, query.assigneeId)
          : undefined,
      query.q
        ? or(ilike(r.publicNumber, `${likeEscape(query.q)}%`), ilike(r.email, `%${likeEscape(query.q)}%`))
        : undefined,
      cursorCondition(query.cursor, r.createdAt, r.id),
    ];
    const rows = await this.db
      .select({
        id: r.id,
        publicNumber: r.publicNumber,
        schoolName: r.schoolName,
        contactPerson: r.contactPerson,
        email: r.email,
        status: r.status,
        createdAt: r.createdAt,
        assigneeId: assignee.id,
        assigneeName: assignee.displayName,
      })
      .from(r)
      .leftJoin(assignee, eq(assignee.id, r.assigneeId))
      .where(and(...conditions))
      .orderBy(...newestFirst(r.createdAt, r.id))
      .limit(query.limit + 1);
    const { rows: items, nextCursor } = page(rows, query.limit);
    return {
      items: items.map(({ assigneeId, assigneeName, createdAt, ...rest }) => ({
        ...rest,
        assignee: assigneeId ? { id: assigneeId, displayName: assigneeName! } : null,
        createdAt: createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async get(id: string): Promise<RequestDetail> {
    const [row] = await this.db
      .select({ request: r, assigneeName: assignee.displayName })
      .from(r)
      .leftJoin(assignee, eq(assignee.id, r.assigneeId))
      .where(eq(r.id, id));
    if (!row) throw notFound();
    const { request } = row;
    return {
      id: request.id,
      publicNumber: request.publicNumber,
      schoolName: request.schoolName,
      contactPerson: request.contactPerson,
      email: request.email,
      status: request.status,
      assignee: request.assigneeId ? { id: request.assigneeId, displayName: row.assigneeName! } : null,
      createdAt: request.createdAt.toISOString(),
      region: request.region,
      city: request.city,
      phone: request.phone,
      message: request.message,
      allowedStatuses: [...REQUEST_TRANSITIONS[request.status]],
    };
  }

  async assign(id: string, assigneeId: string, actorId: string): Promise<RequestDetail> {
    await this.db.transaction(async (tx) => {
      const request = await this.lock(tx, id);
      if (!(await hasRole(tx, assigneeId, 'onboarding_agent'))) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'Assignee must be an onboarding agent',
          {
            assigneeId: 'invalidAssignee',
          },
        );
      }
      if (request.assigneeId === assigneeId) return;
      await tx.update(r).set({ assigneeId }).where(eq(r.id, id));
      await this.audit.record(
        {
          actorId,
          entityType: ENTITY,
          entityId: id,
          action: 'assign',
          before: { assigneeId: request.assigneeId },
          after: { assigneeId },
        },
        tx,
      );
    });
    return this.get(id);
  }

  async setStatus(id: string, to: RequestStatus, actorId: string): Promise<RequestDetail> {
    await this.db.transaction(async (tx) => {
      const request = await this.lock(tx, id);
      if (!canTransitionRequest(request.status, to)) throw invalidTransition(request.status, to);
      await tx.update(r).set({ status: to }).where(eq(r.id, id));
      await this.audit.record(
        {
          actorId,
          entityType: ENTITY,
          entityId: id,
          action: 'status_change',
          before: { status: request.status },
          after: { status: to },
        },
        tx,
      );
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    const [request] = await tx.select().from(r).where(eq(r.id, id)).for('update');
    if (!request) throw notFound();
    return request;
  }
}
