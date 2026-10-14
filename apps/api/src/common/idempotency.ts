import { createParamDecorator, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { type Request } from 'express';
import { z } from 'zod';
import { type Database, schema } from '@syntara/db';
import { DB } from '../infra/tokens';
import { ApiException } from './api-exception';

/** API-GEN-05: срок хранения ключа — 24 ч (очистка — задача cleanup в worker). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface StoredResponse<T> {
  status: number;
  body: T;
}

/** Заголовок Idempotency-Key (UUID) обязателен для POST публичных форм. */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const value = ctx.switchToHttp().getRequest<Request>().headers[IDEMPOTENCY_HEADER];
  const parsed = z.uuid().safeParse(typeof value === 'string' ? value.trim() : undefined);
  if (!parsed.success) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'Idempotency-Key header (UUID) is required',
      {
        'Idempotency-Key': 'required',
      },
    );
  }
  return parsed.data.toLowerCase();
});

/** JSON с отсортированными ключами — одинаковое тело даёт одинаковый хеш независимо от порядка полей. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestHash(body: unknown): Buffer {
  return createHash('sha256').update(stableStringify(body)).digest();
}

class KeyTakenError extends Error {}

/**
 * API-GEN-05: тот же ключ и то же тело → прежний ответ; тот же ключ и другое тело → 409 IDEMPOTENCY_MISMATCH.
 * Запись ключа и сохранённого ответа выполняется в одной транзакции с бизнес-записью (BR-FRM-01),
 * поэтому повтор после таймаута никогда не создаёт вторую запись.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async execute<T>(
    scope: string,
    key: string,
    body: unknown,
    handler: (tx: Tx) => Promise<StoredResponse<T>>,
  ): Promise<StoredResponse<T>> {
    const hash = requestHash(body);
    const previous = await this.find<T>(scope, key, hash);
    if (previous) return previous;

    try {
      return await this.db.transaction(async (tx) => {
        const result = await handler(tx);
        const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
        const { idempotencyKeys: k } = schema;
        // Просроченный, но ещё не удалённый ключ можно занять заново; действующий — нет.
        const saved = await tx
          .insert(k)
          .values({ scope, key, requestHash: hash, response: result, expiresAt })
          .onConflictDoUpdate({
            target: [k.scope, k.key],
            set: { requestHash: hash, response: result, expiresAt },
            setWhere: lt(k.expiresAt, sql`now()`),
          })
          .returning({ key: k.key });
        if (saved.length === 0) throw new KeyTakenError();
        return result;
      });
    } catch (err) {
      // Параллельный запрос с тем же ключом успел зафиксироваться первым.
      if (err instanceof KeyTakenError || isUniqueViolation(err)) {
        const winner = await this.find<T>(scope, key, hash);
        if (winner) return winner;
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Request with this Idempotency-Key is in progress',
        );
      }
      throw err;
    }
  }

  private async find<T>(scope: string, key: string, hash: Buffer): Promise<StoredResponse<T> | null> {
    const { idempotencyKeys: k } = schema;
    const [row] = await this.db
      .select({ requestHash: k.requestHash, response: k.response })
      .from(k)
      .where(and(eq(k.scope, scope), eq(k.key, key), gt(k.expiresAt, sql`now()`)));
    if (!row) return null;
    if (!row.requestHash.equals(hash)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_MISMATCH',
        'Idempotency-Key was already used with a different request body',
      );
    }
    return row.response as StoredResponse<T>;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.cause?.code ?? e.code) === '23505';
}
