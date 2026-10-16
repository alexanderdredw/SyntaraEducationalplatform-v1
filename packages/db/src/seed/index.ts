import { type Database } from '../index';
import { seedConfig, seedFeatureFlags } from './config';
import { type MediaStore } from '../content';
import { seedDemo } from './demo';
import { seedVisual } from './visual';

/** Наборы seed: каждый следующий включает предыдущие (visual ⊃ demo ⊃ config). Все наборы идемпотентны. */
export const SEED_SETS = ['config', 'demo', 'visual'] as const;
export type SeedSet = (typeof SEED_SETS)[number];

/**
 * `media` — хранилище картинок базовой программы (S3 из окружения в CLI); без него картинки не загружаются
 * (integration-тесты без MinIO).
 */
export async function runSeed(
  db: Database,
  set: SeedSet,
  opts: { media?: MediaStore | null } = {},
): Promise<void> {
  await seedConfig(db);
  await seedFeatureFlags(db);
  if (set === 'config') return;
  await seedDemo(db, opts.media ?? null);
  if (set === 'demo') return;
  await seedVisual(db);
}

export { seedId } from './ids';
export { BASE_CODES, baseIds, type BaseIds, DEMO_IDS, DEMO_SCHOOLS, demoSchoolId } from './demo';
export { VISUAL_IDS, VISUAL_NOW } from './visual';
export { loadConfigSeed } from './config';
