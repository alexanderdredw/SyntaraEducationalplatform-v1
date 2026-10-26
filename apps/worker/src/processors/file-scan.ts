import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { type Logger } from 'pino';
import {
  extensionOf,
  isSpreadsheetContent,
  isSpreadsheetFile,
  OFFICE_EXTENSIONS,
  type OutboxFileDeletePayload,
  type OutboxFileScanPayload,
  avatarSmallKey,
  PROFILE_LIMITS,
  zipEntryNames,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { type Scanners } from './scanners';

/** Чтение и удаление объектов хранилища (S3, раздел 2.1). */
export interface ObjectStorage {
  read(key: string): Promise<Buffer>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** BullMQ: сканер может быть ещё не готов (загрузка сигнатур ClamAV) — повторы с растущей задержкой. */
export const FILE_SCAN_JOB_OPTIONS = {
  attempts: 10,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

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

/**
 * BR-PRF-03: картинка-аватар учителя перекодируется в WEBP 256×256 и 64×64 (обрезка по центру в квадрат). Поворот по
 * EXIF применяется к пикселям, затем все метаданные отбрасываются (sharp не переносит EXIF, XMP, ICC и GPS без
 * withMetadata). Не картинка или битый файл — исключение (файл отклоняется).
 */
export async function reencodeAvatar(data: Buffer): Promise<{ large: Buffer; small: Buffer }> {
  const [big, little] = PROFILE_LIMITS.photoSizes;
  const source = sharp(data, { failOn: 'error', limitInputPixels: 40_000_000, pages: 1 }).rotate();
  const encode = (size: number) =>
    source.clone().resize(size, size, { fit: 'cover', position: 'centre' }).webp({ quality: 85 }).toBuffer();
  const [large, small] = await Promise.all([encode(big), encode(little)]);
  return { large, small };
}

export interface FileScanDeps {
  db: Database;
  storage: ObjectStorage;
  scanners: Scanners;
  logger: Logger;
}

/**
 * SM-FILE (BR-FILE-03): pending --scan ok--> clean; pending --virus|macro|spreadsheet--> rejected (объект удаляется).
 * Таблица по имени, MIME или содержимому отклоняется до проверок (BR-FILE-09); офисные документы проверяются
 * olevba и по структуре; все файлы — ClamAV. Повторная обработка того же
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
  let reason: 'spreadsheet' | 'macro' | 'virus' | 'image' | null = null;
  if (isSpreadsheetFile(media.originalName, media.mime) || isSpreadsheetContent(data)) reason = 'spreadsheet';
  if (!reason && office && (hasMacroParts(data) || (await deps.scanners.macros(data)).macros))
    reason = 'macro';
  if (!reason && (await deps.scanners.antivirus(data)).infected) reason = 'virus';

  // BR-PRF-03: хранится только перекодированная картинка — исходный объект перезаписывается версией 256 px.
  let stored = data;
  if (!reason && media.kind === 'avatar') {
    try {
      const { large, small } = await reencodeAvatar(data);
      await deps.storage.put(avatarSmallKey(media.storageKey), small, 'image/webp');
      await deps.storage.put(media.storageKey, large, 'image/webp');
      stored = large;
    } catch {
      reason = 'image';
    }
  }

  const status = reason ? 'rejected' : 'clean';
  const updated = await deps.db
    .update(mediaFiles)
    .set({
      scanStatus: status,
      sha256: createHash('sha256').update(stored).digest(),
      ...(media.kind === 'avatar' && !reason ? { mime: 'image/webp', sizeBytes: stored.length } : {}),
    })
    .where(and(eq(mediaFiles.id, media.id), eq(mediaFiles.scanStatus, 'pending')))
    .returning({ id: mediaFiles.id });
  if (updated.length === 0) return 'skipped';
  if (reason) {
    await deps.storage.remove(media.storageKey);
    if (media.kind === 'avatar') await deps.storage.remove(avatarSmallKey(media.storageKey));
  }
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
