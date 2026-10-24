import { createHash } from 'node:crypto';
import { type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { type Logger } from 'pino';
import {
  extensionOf,
  OFFICE_EXTENSIONS,
  type OutboxFileDeletePayload,
  type OutboxFileScanPayload,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { type Scanners } from './scanners';

/** Чтение и удаление объектов хранилища (S3, раздел 2.1). */
export interface ObjectStorage {
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

/** BullMQ: сканер может быть ещё не готов (загрузка сигнатур ClamAV) — повторы с растущей задержкой. */
export const FILE_SCAN_JOB_OPTIONS = {
  attempts: 10,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Имена записей ZIP из центрального каталога (без распаковки); не ZIP — пустой список. */
export function zipEntryNames(data: Buffer): string[] {
  // Конец центрального каталога (EOCD): сигнатура 0x06054b50, комментарий архива — до 65 535 байт.
  const min = Math.max(0, data.length - 22 - 65_535);
  let eocd = -1;
  for (let i = data.length - 22; i >= min; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count && p + 46 <= data.length && data.readUInt32LE(p) === 0x02014b50; n++) {
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    names.push(data.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * Макросы в OOXML (`vbaProject.bin`, `vbaData.xml`) и ODF (каталог `Basic/`) — по записям ZIP. Документ с
 * проектом макросов отклоняется, даже если olevba не смог его разобрать.
 */
export function hasMacroParts(data: Buffer): boolean {
  return zipEntryNames(data).some((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith('vbaproject.bin') || lower.endsWith('vbadata.xml') || lower.startsWith('basic/');
  });
}

export interface FileScanDeps {
  db: Database;
  storage: ObjectStorage;
  scanners: Scanners;
  logger: Logger;
}

/**
 * SM-FILE (BR-FILE-03): pending --scan ok--> clean; pending --virus|macro--> rejected (объект удаляется).
 * Офисные документы проверяются olevba и по структуре; все файлы — ClamAV. Повторная обработка того же
 * файла ничего не меняет. Имя и содержимое файла в журнал не пишутся (REQ-NFR-SEC-07).
 */
export async function scanFile(
  job: Pick<Job<OutboxFileScanPayload>, 'data'>,
  deps: FileScanDeps,
): Promise<'clean' | 'rejected' | 'skipped'> {
  const { mediaFiles } = schema;
  const [media] = await deps.db.select().from(mediaFiles).where(eq(mediaFiles.id, job.data.mediaId));
  if (!media || media.scanStatus !== 'pending') return 'skipped';

  const data = await deps.storage.read(media.storageKey);
  const office = (OFFICE_EXTENSIONS as readonly string[]).includes(extensionOf(media.originalName));
  let reason: 'macro' | 'virus' | null = null;
  if (office && (hasMacroParts(data) || (await deps.scanners.macros(data)).macros)) reason = 'macro';
  if (!reason && (await deps.scanners.antivirus(data)).infected) reason = 'virus';

  const status = reason ? 'rejected' : 'clean';
  const updated = await deps.db
    .update(mediaFiles)
    .set({ scanStatus: status, sha256: createHash('sha256').update(data).digest() })
    .where(and(eq(mediaFiles.id, media.id), eq(mediaFiles.scanStatus, 'pending')))
    .returning({ id: mediaFiles.id });
  if (updated.length === 0) return 'skipped';
  if (reason) await deps.storage.remove(media.storageKey);
  deps.logger.info({ mediaId: media.id, status, reason }, 'file scanned');
  return status;
}

/**
 * BR-DEL-02, BR-DEL-05: объекты удалённых записей (черновик темы, картинка галереи, материал). Запись уже удалена
 * в транзакции api; отсутствующий объект — не ошибка (DeleteObject идемпотентен), поэтому повтор безопасен.
 */
export async function deleteObjects(
  job: Pick<Job<OutboxFileDeletePayload>, 'data'>,
  deps: Pick<FileScanDeps, 'storage' | 'logger'>,
): Promise<number> {
  for (const key of job.data.storageKeys) await deps.storage.remove(key);
  deps.logger.info({ count: job.data.storageKeys.length }, 'files removed from storage');
  return job.data.storageKeys.length;
}
