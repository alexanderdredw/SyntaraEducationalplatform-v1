import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, tstz } from './_common';
import { users } from './users';
import { topics } from './content';
import { aiContextEnum, aiMsgStatusEnum, aiRoleEnum } from './enums';

/** 5.7 ИИ. */

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    context: aiContextEnum('context').notNull(),
    topicId: uuid('topic_id').references(() => topics.id),
    explainLevel: text('explain_level').notNull().default('beginner'),
    archivedAt: tstz('archived_at'),
    ...timestamps,
  },
  (t) => [check('ai_conv_topic_tutor', sql`${t.context} <> 'topic_tutor' OR ${t.topicId} IS NOT NULL`)],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id),
    role: aiRoleEnum('role').notNull(),
    content: text('content').notNull(),
    status: aiMsgStatusEnum('status').notNull().default('complete'),
    quickAction: text('quick_action'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    ...timestamps,
  },
  (t) => [
    check('ai_msg_quick_action', sql`${t.quickAction} IN ('simpler','more_detail','check_me')`),
    index('ix_ai_messages_conv').on(t.conversationId, t.createdAt),
  ],
);
