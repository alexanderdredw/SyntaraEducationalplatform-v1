import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { bytea, citext, id, timestamps, tstz } from './_common';
import { users } from './users';
import { localeEnum, requestStatusEnum, supportCategoryEnum, ticketStatusEnum } from './enums';

/** 5.7 Поддержка и школьные заявки. */

export const schoolRequests = pgTable(
  'school_requests',
  {
    id: id(),
    publicNumber: text('public_number').notNull().unique(),
    schoolName: text('school_name').notNull(),
    region: text('region'),
    city: text('city'),
    contactPerson: text('contact_person').notNull(),
    phone: text('phone'),
    email: citext('email').notNull(),
    message: text('message'),
    status: requestStatusEnum('status').notNull().default('new'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check('sr_school_name_len', sql`length(${t.schoolName}) <= 200`),
    check('sr_region_len', sql`length(${t.region}) <= 120`),
    check('sr_city_len', sql`length(${t.city}) <= 120`),
    check('sr_contact_person_len', sql`length(${t.contactPerson}) <= 200`),
    check('sr_message_len', sql`length(${t.message}) <= 5000`),
  ],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    publicNumber: text('public_number').notNull().unique(),
    category: supportCategoryEnum('category').notNull(),
    subject: text('subject').notNull(),
    name: text('name'),
    email: citext('email').notNull(),
    phone: text('phone'),
    description: text('description').notNull(),
    userId: uuid('user_id').references(() => users.id),
    status: ticketStatusEnum('status').notNull().default('new'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    techContext: jsonb('tech_context'),
    resolvedAt: tstz('resolved_at'),
    closedAt: tstz('closed_at'),
    ...timestamps,
  },
  (t) => [
    check('st_subject_len', sql`length(${t.subject}) <= 200`),
    check('st_name_len', sql`length(${t.name}) <= 200`),
    check('st_description_len', sql`length(${t.description}) <= 10000`),
    index('ix_tickets_queue').on(t.status, t.assigneeId),
    index('ix_tickets_email').on(t.email),
  ],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id),
    direction: text('direction').notNull(),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    isInternal: boolean('is_internal').notNull().default(false),
    sentAt: tstz('sent_at'),
    ...timestamps,
  },
  (t) => [check('tm_direction', sql`${t.direction} IN ('in','out','note')`)],
);

export const ticketStatusHistory = pgTable('ticket_status_history', {
  id: id(),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id),
  fromStatus: ticketStatusEnum('from_status'),
  toStatus: ticketStatusEnum('to_status').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  changedAt: tstz('changed_at').notNull().defaultNow(),
  ...timestamps,
});

export const ticketReplyTokens = pgTable('ticket_reply_tokens', {
  ticketId: uuid('ticket_id').references(() => supportTickets.id),
  tokenHash: bytea('token_hash').primaryKey(),
  expiresAt: tstz('expires_at').notNull(),
});

export const responseTemplates = pgTable(
  'response_templates',
  {
    code: text('code'),
    locale: localeEnum('locale'),
    body: text('body').notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.locale] })],
);
