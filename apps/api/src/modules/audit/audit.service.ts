import { Inject, Injectable } from '@nestjs/common';
import { type Database, schema } from '@syntara/db';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';

export interface AuditEntry {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  schoolId?: string | null;
}

/**
 * Журнал аудита (REQ-NFR-SEC-05, BR-SUP-03): только INSERT (5.8). Пишется в той же транзакции,
 * что и само изменение, — запись без аудита невозможна.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry, tx: Tx | Database = this.db): Promise<void> {
    await tx.insert(schema.auditLog).values({
      actorId: entry.actorId,
      schoolId: entry.schoolId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  }
}
