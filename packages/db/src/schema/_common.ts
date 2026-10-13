import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** citext (расширение PostgreSQL) — email без учёта регистра (5.3). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** bytea — хеши токенов и кодов (REQ-NFR-SEC-02). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** PK uuid; значение — UUIDv7, генерируется в приложении (5.1). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * created_at / updated_at (5.1) — у каждой таблицы, кроме связующих (с составным PK).
 * updated_at поддерживается триггером set_updated_at() (миграция 0002).
 */
export const timestamps = {
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
};
