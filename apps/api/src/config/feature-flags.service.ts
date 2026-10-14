import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type Database, schema } from '@syntara/db';
import { DB } from '../infra/tokens';

/** Флаги функций (таблица feature_flags, AG-02). Ключа нет в таблице — функция выключена. */
export const FEATURE_FLAGS = {
  /** API-SUP-08: приём входящих писем. Выключен до выбора почтового провайдера (Q-10, решение владельца 2026-10-14). */
  inboundEmail: 'support.inbound_email',
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

@Injectable()
export class FeatureFlagsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async isEnabled(key: FeatureFlag): Promise<boolean> {
    const [row] = await this.db
      .select({ enabled: schema.featureFlags.enabled })
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.key, key));
    return row?.enabled ?? false;
  }
}
