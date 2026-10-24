import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { tstz } from './_common';
import { users } from './users';

/**
 * REQ-NAV-14 (docs/NAV_TZ_2.md): когда ученик последний раз открывал раздел «Мой класс» или «Достижения» —
 * по этой отметке панель показывает точку «новое». RLS «только свои» — миграция 0009.
 */
export const navSeen = pgTable(
  'nav_seen',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    section: text('section').notNull(),
    seenAt: tstz('seen_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.section] }),
    check('nav_seen_section', sql`${t.section} IN ('class','achievements')`),
  ],
);
