import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { type Database } from '../index';
import { appConfig, featureFlags } from '../schema';

export interface ConfigSeedEntry {
  key: string;
  note: string;
  value: unknown;
}

export function loadConfigSeed(): ConfigSeedEntry[] {
  const file = join(__dirname, '..', '..', 'seed', 'config.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { entries: ConfigSeedEntry[] }).entries;
}

/**
 * Раздел 11: все заглушки в app_config с needs_confirmation = true, PH-ID — в note.
 * Уже подтверждённые владельцем значения (needs_confirmation = false) seed не перезаписывает.
 */
export async function seedConfig(db: Database): Promise<void> {
  const entries = loadConfigSeed();
  await db
    .insert(appConfig)
    .values(entries.map((e) => ({ key: e.key, value: e.value, note: e.note, needsConfirmation: true })))
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: sql`excluded.value`, note: sql`excluded.note` },
      setWhere: sql`${appConfig.needsConfirmation} = true`,
    });
}

/**
 * Флаги функций (AG-02): функции, выключенные до решения владельца. Seed не меняет уже выставленные значения.
 */
export const FEATURE_FLAG_SEED = [
  {
    key: 'support.inbound_email',
    enabled: false,
    note: 'API-SUP-08: входящие письма — выключены до подключения почтового провайдера (Q-10, решение 2026-10-14)',
  },
];

export async function seedFeatureFlags(db: Database): Promise<void> {
  await db.insert(featureFlags).values(FEATURE_FLAG_SEED).onConflictDoNothing();
}
