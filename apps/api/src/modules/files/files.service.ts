import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, max, ne, sql } from 'drizzle-orm';
import {
  coverSignatureOk,
  extensionOf,
  FILE_LIMITS,
  isCoverMime,
  isMaterialExtension,
  MATERIAL_TYPES,
  materialSignatureOk,
  OUTBOX_EVENT_TYPES,
  type OutboxFileScanPayload,
  type UploadUrlDto,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { type GalleryItemDto, type MediaStatusDto, type UploadUrlResponse } from './files.dto';
import { RemoteImageFetcher } from './remote-image';
import { StorageService } from './storage.service';

const { mediaFiles, topicMaterials, topics, subjects, outboxEvents } = schema;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
const tooLarge = (field: string, key: string) =>
  new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', 'File limits exceeded', {
    [field]: key,
  });
const unprocessable = (field: string, key: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'File not accepted', { [field]: key });

type Media = typeof mediaFiles.$inferSelect;

/**
 * Файлы (7.8, SM-FILE): лимиты BR-FILE-01/02 проверяются до выдачи ссылки на загрузку (413/422) и повторно
 * после неё — по фактическому размеру и сигнатуре. Прошедший проверку файл ставится в очередь file-scan через
 * outbox (ClamAV + olevba в worker, BR-FILE-03). Ученикам — только clean (BR-FILE-04).
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly remote: RemoteImageFetcher,
  ) {}

  /**
   * BR-FILE-06: обложка по ссылке учителя — сервер скачивает картинку (защита от SSRF — RemoteImageFetcher),
   * проверяет как загруженную (BR-FILE-01) и кладёт в хранилище; дальше — та же проверка file-scan, что у
   * загруженных файлов (BR-FILE-03). Возвращает id обложки в галерее учителя.
   */
  async ingestCover(ownerId: string, url: string): Promise<string> {
    const image = await this.remote.fetch(url);
    const storageKey = `cover/${crypto.randomUUID()}`;
    await this.storage.put(storageKey, image.data, image.mime);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mediaFiles)
        .values({
          ownerId,
          kind: 'cover',
          originalName: image.fileName,
          mime: image.mime,
          sizeBytes: image.data.length,
          storageKey,
        })
        .returning({ id: mediaFiles.id });
      await tx.insert(outboxEvents).values({
        type: OUTBOX_EVENT_TYPES.fileScan,
        payload: { mediaId: row!.id } satisfies OutboxFileScanPayload,
      });
      return row!.id;
    });
  }

  /** API-T-16 */
  async uploadUrl(ownerId: string, dto: UploadUrlDto): Promise<UploadUrlResponse> {
    const mime = dto.mime.toLowerCase();
    if (dto.kind === 'cover') {
      if (!isCoverMime(mime)) throw unprocessable('mime', 'fileType');
      if (dto.size > FILE_LIMITS.coverMaxBytes) throw tooLarge('size', 'fileTooLarge');
    } else {
      const ext = extensionOf(dto.fileName);
      if (!isMaterialExtension(ext) || !(MATERIAL_TYPES[ext] as readonly string[]).includes(mime))
        throw unprocessable('mime', 'fileType');
      if (dto.size > FILE_LIMITS.materialMaxBytes) throw tooLarge('size', 'fileTooLarge');
    }

    const media = await this.db.transaction(async (tx) => {
      if (dto.kind === 'material') {
        await this.lockOwnTopic(tx, ownerId, dto.topicId!);
        const { files, bytes } = await this.topicUsage(tx, dto.topicId!);
        if (files >= FILE_LIMITS.materialsPerTopic) throw unprocessable('file', 'tooManyFiles');
        if (bytes + dto.size > FILE_LIMITS.materialsBytesPerTopic) throw tooLarge('size', 'topicTooLarge');
      }
      const [row] = await tx
        .insert(mediaFiles)
        .values({
          ownerId,
          kind: dto.kind,
          originalName: dto.fileName,
          mime,
          sizeBytes: dto.size,
          // Ключ без имени файла: имя — только в метаданных (заголовок при скачивании).
          storageKey: `${dto.kind}/${crypto.randomUUID()}`,
        })
        .returning();
      if (dto.kind === 'material') {
        const [last] = await tx
          .select({ position: max(topicMaterials.position) })
          .from(topicMaterials)
          .where(eq(topicMaterials.topicId, dto.topicId!));
        await tx
          .insert(topicMaterials)
          .values({ topicId: dto.topicId!, mediaId: row!.id, position: (last?.position ?? 0) + 1 });
      }
      return row!;
    });
    return {
      mediaId: media.id,
      uploadUrl: await this.storage.uploadUrl(media.storageKey, mime),
      headers: { 'Content-Type': mime },
    };
  }

  /**
   * API-T-17: повторная проверка размера, лимитов темы и сигнатуры по загруженному объекту; не прошёл —
   * rejected и объект удалён (413/422); прошёл — событие file.scan (scan_status остаётся pending).
   */
  async complete(mediaId: string): Promise<MediaStatusDto> {
    const [media] = await this.db.select().from(mediaFiles).where(eq(mediaFiles.id, mediaId));
    if (!media) throw notFound();
    if (media.scanStatus !== 'pending') return this.status(media);
    if (await this.queued(media.id)) return this.status(media);

    const size = await this.storage.size(media.storageKey);
    if (size === null) throw unprocessable('file', 'fileMissing');
    const problem = await this.problem(media, size);
    if (problem) {
      await this.reject(media);
      throw problem;
    }
    await this.db.transaction(async (tx) => {
      await tx.update(mediaFiles).set({ sizeBytes: size }).where(eq(mediaFiles.id, media.id));
      await tx.insert(outboxEvents).values({
        type: OUTBOX_EVENT_TYPES.fileScan,
        payload: { mediaId: media.id } satisfies OutboxFileScanPayload,
      });
    });
    return { id: media.id, scanStatus: 'pending', url: null };
  }

  /** API-T-18, BR-FILE-05: обложки пользователя (без отклонённых), новые первыми. */
  async gallery(ownerId: string): Promise<GalleryItemDto[]> {
    const rows = await this.db
      .select()
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.ownerId, ownerId),
          eq(mediaFiles.kind, 'cover'),
          ne(mediaFiles.scanStatus, 'rejected'),
        ),
      )
      .orderBy(desc(mediaFiles.createdAt), desc(mediaFiles.id));
    return Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        name: m.originalName,
        scanStatus: m.scanStatus,
        url: m.scanStatus === 'clean' ? await this.storage.downloadUrl(m.storageKey) : null,
      })),
    );
  }

  private async problem(media: Media, size: number): Promise<ApiException | null> {
    if (media.kind === 'cover') {
      if (size > FILE_LIMITS.coverMaxBytes) return tooLarge('size', 'fileTooLarge');
    } else {
      if (size > FILE_LIMITS.materialMaxBytes) return tooLarge('size', 'fileTooLarge');
      const [link] = await this.db
        .select({ topicId: topicMaterials.topicId })
        .from(topicMaterials)
        .where(eq(topicMaterials.mediaId, media.id));
      if (link) {
        const { bytes } = await this.topicUsage(this.db, link.topicId!, media.id);
        if (bytes + size > FILE_LIMITS.materialsBytesPerTopic) return tooLarge('size', 'topicTooLarge');
      }
    }
    const head = size > 0 ? await this.storage.head(media.storageKey) : Buffer.alloc(0);
    const ext = extensionOf(media.originalName);
    const ok =
      media.kind === 'cover'
        ? isCoverMime(media.mime) && coverSignatureOk(media.mime, head)
        : isMaterialExtension(ext) && size > 0 && materialSignatureOk(ext, head);
    return ok ? null : unprocessable('file', 'fileSignature');
  }

  /** SM-FILE: pending → rejected, объект удаляется из хранилища (BR-FILE-03). */
  private async reject(media: Media): Promise<void> {
    await this.db.update(mediaFiles).set({ scanStatus: 'rejected' }).where(eq(mediaFiles.id, media.id));
    await this.storage.remove(media.storageKey);
  }

  /** Повторный вызов complete не ставит файл в очередь второй раз. */
  private async queued(mediaId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, OUTBOX_EVENT_TYPES.fileScan),
          sql`${outboxEvents.payload}->>'mediaId' = ${mediaId}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async status(media: Media): Promise<MediaStatusDto> {
    return {
      id: media.id,
      scanStatus: media.scanStatus,
      url:
        media.scanStatus === 'clean'
          ? await this.storage.downloadUrl(media.storageKey, media.originalName)
          : null,
    };
  }

  /** Тема своего предмета; блокировка — параллельные загрузки не обойдут лимит BR-FILE-02. */
  private async lockOwnTopic(tx: Tx, ownerId: string, topicId: string): Promise<void> {
    const [row] = await tx
      .select({ id: topics.id })
      .from(topics)
      .innerJoin(subjects, eq(subjects.id, topics.subjectId))
      .where(
        and(
          eq(topics.id, topicId),
          isNull(topics.archivedAt),
          eq(subjects.ownerId, ownerId),
          isNull(subjects.archivedAt),
        ),
      )
      .for('update', { of: topics });
    if (!row) throw notFound();
  }

  /** Число и суммарный размер материалов темы, кроме отклонённых (и, при необходимости, одного файла). */
  private async topicUsage(
    tx: Tx | Database,
    topicId: string,
    exceptMediaId?: string,
  ): Promise<{ files: number; bytes: number }> {
    const rows = await tx
      .select({ id: mediaFiles.id, size: mediaFiles.sizeBytes })
      .from(topicMaterials)
      .innerJoin(mediaFiles, eq(mediaFiles.id, topicMaterials.mediaId))
      .where(and(eq(topicMaterials.topicId, topicId), ne(mediaFiles.scanStatus, 'rejected')));
    const counted = rows.filter((r) => r.id !== exceptMediaId);
    return { files: counted.length, bytes: counted.reduce((s, r) => s + r.size, 0) };
  }
}
