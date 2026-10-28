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

/** Тестовый предмет e2e (решение владельца 2026-10-28): импортируется только вместе с content/ (seed `e2e`). */
export const e2eFixturesDir = () => join(repoRoot(), 'e2e', 'fixtures', 'content');

function readDir(dir: string): { catalog: ContentCatalog; errors: ContentError[] } {
  // Пути в ошибках — от корня репозитория; для папки вне репозитория — от её родителя.
  let root: string;
  try {
    root = repoRoot(dir);
  } catch {
    root = dirname(dir);
  }
  return readContent(dir, root);
}

/**
 * `pnpm content:check`: проверка всех файлов без БД (BR-CNT-03, BR-CNT-06). `extraDirs` дополняют основную папку
 * (тестовый предмет e2e): коды разделов, предметов и тем и порядковые номера разделов не должны совпадать.
 */
export function checkContent(
  dir = defaultContentDir(),
  extraDirs: string[] = [],
): { catalog: ContentCatalog; errors: ContentError[] } {
  const result = readDir(dir);
  const main = result.catalog;
  for (const extra of extraDirs) {
    const { catalog, errors } = readDir(extra);
    result.errors.push(...errors);
    for (const s of catalog.sections) {
      if (main.sections.some((x) => x.code === s.code || x.position === s.position))
        result.errors.push({ file: s.file, message: 'код или порядковый номер раздела уже есть в content/' });
    }
    for (const s of catalog.subjects) {
      if (main.subjects.some((x) => x.code === s.code))
        result.errors.push({ file: s.file, field: 'code', message: 'код предмета уже есть в content/' });
    }
    for (const t of catalog.topics) {
      if (main.topics.some((x) => x.code === t.code))
        result.errors.push({
          file: `${t.dir}/ru.md`,
          field: 'code',
          message: 'код темы уже есть в content/',
        });
    }
    main.sections.push(...catalog.sections);
    main.subjects.push(...catalog.subjects);
    main.topics.push(...catalog.topics);
  }
  return result;
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
  opts: { dir?: string; extraDirs?: string[]; media: MediaStore | null; dryRun?: boolean },
): Promise<{ summary: ImportSummary | null; errors: ContentError[] }> {
  const { catalog, errors } = checkContent(opts.dir, opts.extraDirs);
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
