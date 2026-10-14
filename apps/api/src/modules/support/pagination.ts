import { HttpStatus } from '@nestjs/common';
import { desc, sql, type SQL } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';
import { ApiException } from '../../common/api-exception';

/**
 * API-GEN-07: курсорная пагинация по (created_at DESC, id DESC).
 * Курсор — непрозрачная строка base64url из «время|id» последнего элемента страницы. Время сравнивается
 * с точностью до миллисекунд (как в JS Date), иначе строки с микросекундами терялись бы на границе страниц.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function cursorCondition(
  cursor: string | undefined,
  createdAt: PgColumn,
  id: PgColumn,
): SQL | undefined {
  if (!cursor) return undefined;
  const [time, cursorId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(time ?? '');
  if (!cursorId || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(cursorId)) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Invalid cursor', {
      cursor: 'invalid',
    });
  }
  return sql`(date_trunc('milliseconds', ${createdAt}), ${id}) < (${date.toISOString()}::timestamptz, ${cursorId}::uuid)`;
}

export function newestFirst(createdAt: PgColumn, id: PgColumn): SQL[] {
  return [desc(sql`date_trunc('milliseconds', ${createdAt})`), desc(id)];
}

/** Запрашивается limit + 1 строка: лишняя означает, что есть следующая страница. */
export function page<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { rows: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return { rows: pageRows, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** Экранирование % и _ для ILIKE. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
