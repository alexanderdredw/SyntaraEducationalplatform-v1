// CLI БД: `pnpm db:migrate`, `pnpm db:rollback [--steps=N|--all]`, `pnpm db:reset`, `pnpm db:seed --set=config|demo|visual`.
import { createDb } from './index';
import { appliedMigrations, migrateUp, rollback } from './migrator';
import { runSeed, SEED_SETS, type SeedSet } from './seed';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a === `--${name}` || a.startsWith(prefix));
  if (!found) return undefined;
  return found === `--${name}` ? 'true' : found.slice(prefix.length);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url, { max: 1 });
  try {
    switch (command) {
      case 'migrate':
        await migrateUp(db);
        console.warn(`[db] applied: ${(await appliedMigrations(db)).join(', ') || '—'}`);
        break;
      case 'rollback': {
        const steps = arg('all') ? Number.MAX_SAFE_INTEGER : Number(arg('steps') ?? 1);
        console.warn(`[db] rolled back: ${(await rollback(db, steps)).join(', ') || '—'}`);
        break;
      }
      case 'reset':
        await rollback(db, Number.MAX_SAFE_INTEGER);
        await migrateUp(db);
        console.warn('[db] reset done');
        break;
      case 'seed': {
        const set = (arg('set') ?? 'demo') as SeedSet;
        if (!SEED_SETS.includes(set))
          throw new Error(`Unknown seed set "${set}". Use: ${SEED_SETS.join(', ')}`);
        await runSeed(db, set);
        console.warn(`[db] seed "${set}" done`);
        break;
      }
      default:
        throw new Error('Usage: cli.ts migrate | rollback [--steps=N|--all] | reset | seed --set=<set>');
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((err: unknown) => {
  const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
  const message = err instanceof Error ? (err.message.split('\n')[0] ?? '') : String(err);
  console.error('[db] failed:', message + cause);
  process.exit(1);
});
