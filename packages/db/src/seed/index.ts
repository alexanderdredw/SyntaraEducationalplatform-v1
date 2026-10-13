import { type Database } from '../index';
import { seedConfig } from './config';
import { seedDemo } from './demo';
import { seedVisual } from './visual';

/** Наборы seed: каждый следующий включает предыдущие (visual ⊃ demo ⊃ config). Все наборы идемпотентны. */
export const SEED_SETS = ['config', 'demo', 'visual'] as const;
export type SeedSet = (typeof SEED_SETS)[number];

export async function runSeed(db: Database, set: SeedSet): Promise<void> {
  await seedConfig(db);
  if (set === 'config') return;
  await seedDemo(db);
  if (set === 'demo') return;
  await seedVisual(db);
}

export { seedId } from './ids';
export { DEMO_IDS } from './demo';
export { VISUAL_IDS, VISUAL_NOW } from './visual';
export { loadConfigSeed } from './config';
