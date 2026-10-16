import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Database } from '../index';
import { applyCatalog, changesCount, type ImportSummary } from './apply';
import { type ContentCatalog, type ContentError } from './format';
import { type MediaStore } from './images';
import { readContent } from './parse';

export { changesCount, IMPORT_USER, type ImportSummary } from './apply';
export { formatError, MAX_IMAGE_BYTES, type ContentCatalog, type ContentError } from './format';
export { imageMatches, type MediaStore, s3MediaStoreFromEnv } from './images';

/** Корень репозитория (папка с pnpm-workspace.yaml) — content/ лежит в нём. */
export function repoRoot(from = __dirname): string {
  let dir = from;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('pnpm-workspace.yaml not found');
    dir = parent;
  }
  return dir;
}

export const defaultContentDir = () => join(repoRoot(), 'content');

/** `pnpm content:check`: проверка всех файлов без БД (BR-CNT-03, BR-CNT-06). */
export function checkContent(dir = defaultContentDir()): { catalog: ContentCatalog; errors: ContentError[] } {
  // Пути в ошибках — от корня репозитория; для папки вне репозитория — от её родителя.
  let root: string;
  try {
    root = repoRoot(dir);
  } catch {
    root = dirname(dir);
  }
  return readContent(dir, root);
}

class DryRun extends Error {
  constructor(readonly summary: ImportSummary) {
    super('dry run');
  }
}

/**
 * `pnpm content:import` (BR-CNT-01..07): сначала проверка всех файлов — при любой ошибке БД не трогается;
 * затем запись в одной транзакции. `dryRun` — то же самое с откатом транзакции: сводка того, что изменится.
 * `media: null` — картинки не загружаются (окружение без хранилища, например integration-тесты).
 */
export async function importContent(
  db: Database,
  opts: { dir?: string; media: MediaStore | null; dryRun?: boolean },
): Promise<{ summary: ImportSummary | null; errors: ContentError[] }> {
  const { catalog, errors } = checkContent(opts.dir);
  if (errors.length) return { summary: null, errors };
  try {
    const summary = await db.transaction(async (tx) => {
      const result = await applyCatalog(tx, catalog, { media: opts.media, dryRun: Boolean(opts.dryRun) });
      if (opts.dryRun) throw new DryRun(result);
      return result;
    });
    return { summary, errors: [] };
  } catch (err) {
    if (err instanceof DryRun) return { summary: err.summary, errors: [] };
    throw err;
  }
}

export const hasChanges = (summary: ImportSummary | null) => (summary ? changesCount(summary) > 0 : false);
