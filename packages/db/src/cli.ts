// CLI БД: `pnpm db:migrate`, `pnpm db:rollback [--steps=N|--all]`, `pnpm db:reset`, `pnpm db:seed --set=config|demo|visual|e2e`,
// `pnpm content:check`, `pnpm content:import [--dry-run] [--dir=<папка>] [--extra-dir=<папка>]` (BR-CNT-01..07;
// --extra-dir — тестовый предмет e2e/fixtures/content вместе с основной папкой),
// `pnpm battle:anonymize --student=<id>` (BR-BTL-11).
import { resolve } from 'node:path';
import {
  checkContent,
  formatError,
  hasChanges,
  type ImportSummary,
  importContent,
  s3MediaStoreFromEnv,
} from './content';
import { anonymizeStudentBattles } from './battle/anonymize';
import { createDb } from './index';
import { appliedMigrations, migrateUp, rollback } from './migrator';
import { runSeed, SEED_SETS, type SeedSet } from './seed';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a === `--${name}` || a.startsWith(prefix));
  if (!found) return undefined;
  return found === `--${name}` ? 'true' : found.slice(prefix.length);
}

function printSummary(s: ImportSummary, dryRun: boolean): void {
  const line = (name: string, counts: Record<string, number>) =>
    `  ${name}: ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`;
  console.warn(
    dryRun ? '[content] план изменений (--dry-run, БД не изменена):' : '[content] импорт выполнен:',
  );
  console.warn(line('разделы', s.sections));
  console.warn(line('предметы', s.subjects));
  console.warn(line('главы', s.chapters));
  console.warn(line('глоссарий', s.glossary));
  console.warn(line('темы', s.topics));
  console.warn(line('вопросы', s.questions));
  console.warn(line('картинки', s.media));
  if (!hasChanges(s)) console.warn('  изменений нет');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const dir = arg('dir') ? resolve(arg('dir')!) : undefined;
  const extraDirs = arg('extra-dir') ? [resolve(arg('extra-dir')!)] : [];
  if (command === 'content:check') {
    const { catalog, errors } = checkContent(dir, extraDirs);
    if (errors.length) {
      for (const e of errors) console.error(formatError(e));
      throw new Error(`content/: ошибок — ${errors.length}`);
    }
    console.warn(
      `[content] проверено: разделов ${catalog.sections.length}, предметов ${catalog.subjects.length}, тем ${catalog.topics.length}, вопросов ${catalog.topics.reduce((n, t) => n + t.questions.length, 0)}`,
    );
    return;
  }
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
        await runSeed(db, set, { media: s3MediaStoreFromEnv() });
        console.warn(`[db] seed "${set}" done`);
        break;
      }
      case 'content:import': {
        const dryRun = Boolean(arg('dry-run'));
        const media = s3MediaStoreFromEnv();
        if (!media) throw new Error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY are not set');
        const { summary, errors } = await importContent(db, { dir, extraDirs, media, dryRun });
        if (errors.length) {
          for (const e of errors) console.error(formatError(e));
          throw new Error(`content/: ошибок — ${errors.length}; БД не изменена`);
        }
        printSummary(summary!, dryRun);
        break;
      }
      // BR-BTL-11: обезличивание Battle по запросу ученика на удаление данных (PH-08).
      case 'battle:anonymize': {
        const student = arg('student');
        if (!student || !/^[0-9a-f-]{36}$/i.test(student))
          throw new Error('Usage: battle:anonymize --student=<uuid>');
        const result = await anonymizeStudentBattles(db, student);
        console.warn(
          `[battle] обезличено: участий ${result.participants}, ответов удалено ${result.answers}`,
        );
        break;
      }
      default:
        throw new Error(
          'Usage: cli.ts migrate | rollback [--steps=N|--all] | reset | seed --set=<set> | content:check | content:import [--dry-run] | battle:anonymize --student=<id>',
        );
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
