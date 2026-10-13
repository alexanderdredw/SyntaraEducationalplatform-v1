import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext, id, timestamps, tstz } from './_common';
import { users } from './users';

/** 5.7 Служебные таблицы. */

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope'),
    key: text('key'),
    requestHash: bytea('request_hash').notNull(),
    response: jsonb('response'),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

export const outboxEvents = pgTable('outbox_events', {
  id: id(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  processedAt: tstz('processed_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  ...timestamps,
});

export const emailQueue = pgTable('email_queue', {
  id: id(),
  toEmail: citext('to_email').notNull(),
  template: text('template').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  sentAt: tstz('sent_at'),
  ...timestamps,
});

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  readAt: tstz('read_at'),
  ...timestamps,
});

/** Журнал аудита (REQ-NFR-SEC-05): app_user — только INSERT (миграция 0002). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id),
    schoolId: uuid('school_id'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ...timestamps,
  },
  (t) => [index('ix_audit_entity').on(t.entityType, t.entityId, t.createdAt)],
);

/** Флаги функций и значения заглушек раздела 11. */
export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  note: text('note'),
  ...timestamps,
});

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  needsConfirmation: boolean('needs_confirmation').notNull().default(true),
  confirmedAt: tstz('confirmed_at'),
  confirmedBy: text('confirmed_by'),
  /** PH-ID заглушки (раздел 11: «PH-ID хранится в поле note»). */
  note: text('note'),
  ...timestamps,
});
