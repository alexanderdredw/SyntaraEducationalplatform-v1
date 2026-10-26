import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import {
  coverSignatureOk,
  extensionOf,
  FILE_LIMITS,
  isAvatarPhotoMime,
  isCoverMime,
  isMaterialExtension,
  isSpreadsheetContent,
  isSpreadsheetFile,
  MATERIAL_TYPES,
  materialSignatureOk,
  mayHideSpreadsheet,
  OUTBOX_EVENT_TYPES,
  type OutboxFileDeletePayload,
  type OutboxFileScanPayload,
  PROFILE_LIMITS,
  SPREADSHEET_ERROR,
  type UploadUrlDto,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { type GalleryItemDto, type MediaStatusDto, type UploadUrlResponse } from './files.dto';
import { RemoteImageFetcher } from './remote-image';
import { StorageService } from './storage.service';

const { mediaFiles, topicMaterials, topics, subjects, outboxEvents, topicVersions } = schema;

/**
 * Загрузка завершена (API-T-17 вызван — есть событие file.scan) или файл уже проверен. Иначе это оборванная
 * загрузка: ссылка выдана, объекта может не быть, проверки не будет (DELETE_TZ, раздел 5).
 */
export const uploadCompleted = () =>
  sql`(${mediaFiles.scanStatus} <> 'pending' OR EXISTS (SELECT 1 FROM ${outboxEvents} oe
    WHERE oe.type = ${OUTBOX_EVENT_TYPES.fileScan} AND oe.payload->>'mediaId' = ${mediaFiles.id}::text))`;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
const tooLarge = (field: string, key: string) =>
  new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE', 'File limits exceeded', {
    [field]: key,
  });
const unprocessable = (field: string, key: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'File not accepted', { [field]: key });
/** BR-FILE-09: таблицы не загружаются — 422 fileTypeNotAllowed. */
export const spreadsheetNotAllowed = () => unprocessable('file', SPREADSHEET_ERROR);

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
    private readonly audit: AuditService,
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
    if (isSpreadsheetFile(dto.fileName, mime)) throw spreadsheetNotAllowed();
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
   * API-ME-08 (BR-PRF-03): ссылка на загрузку картинки-аватара учителя. Тип и размер — до выдачи ссылки; лимит
   * загрузок за 24 часа проверяет ProfileService. Дальше — тот же API-T-17 и проверка file-scan; worker после
   * ClamAV перекодирует картинку в WEBP 256 и 64 px без метаданных.
   */
  async avatarUploadUrl(
    tx: Tx,
    ownerId: string,
    dto: { fileName: string; mime: string; size: number },
  ): Promise<UploadUrlResponse> {
    const mime = dto.mime.toLowerCase();
    if (isSpreadsheetFile(dto.fileName, mime)) throw spreadsheetNotAllowed();
    if (!isAvatarPhotoMime(mime)) throw unprocessable('mime', 'fileType');
    if (dto.size > PROFILE_LIMITS.photoMaxBytes) throw tooLarge('size', 'fileTooLarge');
    const [media] = await tx
      .insert(mediaFiles)
      .values({
        ownerId,
        kind: 'avatar',
        originalName: dto.fileName,
        mime,
        sizeBytes: dto.size,
        storageKey: `avatar/${crypto.randomUUID()}`,
      })
      .returning();
    return {
      mediaId: media!.id,
      uploadUrl: await this.storage.uploadUrl(media!.storageKey, mime),
      headers: { 'Content-Type': mime },
    };
  }

  /**
   * API-T-17: повторная проверка размера, лимитов темы, сигнатуры и запрета таблиц (BR-FILE-09) по загруженному
   * объекту; не прошёл — rejected и объект удалён (413/422); прошёл — событие file.scan (scan_status — pending).
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

  /**
   * API-T-18, BR-FILE-05: обложки пользователя (без отклонённых), новые первыми. Незавершённые загрузки (ссылка
   * выдана, а API-T-17 не вызван — проверки не будет) не показываются: это не «Проверяется», а оборванная
   * загрузка; её удалит очистка BR-FILE-07 (DELETE_TZ, раздел 5). `usedIn` — где картинка используется
   * (BR-DEL-04): «✕» у неё неактивна.
   */
  async gallery(ownerId: string): Promise<GalleryItemDto[]> {
    const rows = await this.db
      .select()
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.ownerId, ownerId),
          eq(mediaFiles.kind, 'cover'),
          ne(mediaFiles.scanStatus, 'rejected'),
          uploadCompleted(),
        ),
      )
      .orderBy(desc(mediaFiles.createdAt), desc(mediaFiles.id));
    const usage = await this.coverUsage(rows.map((m) => m.id));
    return Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        name: m.originalName,
        scanStatus: m.scanStatus,
        url: m.scanStatus === 'clean' ? await this.storage.downloadUrl(m.storageKey) : null,
        usedIn: usage.get(m.id) ?? null,
      })),
    );
  }

  /**
   * API-T-31, BR-DEL-04/05: удалить свою картинку из галереи в любом статусе, если она не обложка черновика или
   * опубликованной версии темы и не картинка вопроса Battle (409 coverInUse). Запись удаляется, объект хранилища
   * — задачей worker после фиксации; незаконченная проверка такого файла завершится без ошибки (записи нет).
   */
  async removeCover(ownerId: string, mediaId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [media] = await tx
        .select()
        .from(mediaFiles)
        .where(and(eq(mediaFiles.id, mediaId), eq(mediaFiles.ownerId, ownerId), eq(mediaFiles.kind, 'cover')))
        .for('update');
      if (!media) throw notFound();
      const usedIn = (await this.coverUsage([mediaId], tx)).get(mediaId);
      if (usedIn) {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', `Cover is used: ${usedIn.title}`, {
          media: usedIn.kind === 'battle' ? 'coverInUseBattle' : 'coverInUse',
        });
      }
      await tx.delete(mediaFiles).where(eq(mediaFiles.id, mediaId));
      await this.enqueueDelete(tx, [media.storageKey]);
      await this.audit.record(
        {
          actorId: ownerId,
          entityType: 'media_file',
          entityId: mediaId,
          action: 'delete',
          before: { kind: media.kind, name: media.originalName, scanStatus: media.scanStatus },
        },
        tx,
      );
    });
  }

  /**
   * BR-DEL-02, раздел 4 DELETE_TZ: материалы, убранные из темы, удаляются вместе с объектом хранилища — если файл
   * не входит ни в одну версию темы (её видели ученики — опубликованные версии не трогаем) и не прикреплён к
   * другой теме. Возвращает ключи удалённых объектов; удаление объектов — enqueueDelete в той же транзакции.
   */
  async releaseMaterials(tx: Tx, mediaIds: string[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const free = await tx
      .select({ id: mediaFiles.id, key: mediaFiles.storageKey })
      .from(mediaFiles)
      .where(
        and(
          inArray(mediaFiles.id, mediaIds),
          eq(mediaFiles.kind, 'material'),
          sql`NOT EXISTS (SELECT 1 FROM ${topicMaterials} tm WHERE tm.media_id = ${mediaFiles.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${topicVersions} v WHERE v.snapshot->'materialIds' ? ${mediaFiles.id}::text)`,
        ),
      );
    if (free.length === 0) return [];
    await tx.delete(mediaFiles).where(
      inArray(
        mediaFiles.id,
        free.map((m) => m.id),
      ),
    );
    return free.map((m) => m.key);
  }

  /** BR-DEL-02/05: объекты хранилища удаляет worker после фиксации транзакции (outbox file.delete). */
  async enqueueDelete(tx: Tx, storageKeys: string[]): Promise<void> {
    if (storageKeys.length === 0) return;
    await tx.insert(outboxEvents).values({
      type: OUTBOX_EVENT_TYPES.fileDelete,
      payload: { storageKeys } satisfies OutboxFileDeletePayload,
    });
  }

  /**
   * BR-DEL-04: где используется картинка — обложка черновика темы (topics.cover_media_id), обложка опубликованной
   * версии темы или картинка вопроса Battle. Значение — название темы или Battle-теста.
   */
  async coverUsage(
    mediaIds: string[],
    db: Tx | Database = this.db,
  ): Promise<Map<string, { kind: 'topic' | 'battle'; title: string }>> {
    const usage = new Map<string, { kind: 'topic' | 'battle'; title: string }>();
    if (mediaIds.length === 0) return usage;
    const ids = sql.join(
      mediaIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await db.execute<{ media_id: string; kind: 'topic' | 'battle'; title: string | null }>(sql`
      SELECT t.cover_media_id AS media_id, 'topic' AS kind,
             (SELECT tt.title FROM topic_translations tt WHERE tt.topic_id = t.id ORDER BY tt.locale <> 'ru', tt.locale LIMIT 1) AS title
      FROM topics t WHERE t.cover_media_id IN (${ids})
      UNION ALL
      SELECT (v.snapshot->>'coverMediaId')::uuid, 'topic',
             (SELECT tt.title FROM topic_translations tt WHERE tt.topic_id = t.id ORDER BY tt.locale <> 'ru', tt.locale LIMIT 1)
      FROM topics t JOIN topic_versions v ON v.id = t.published_version_id
      WHERE v.snapshot->>'coverMediaId' IN (SELECT x::text FROM unnest(ARRAY[${ids}]) x)
      UNION ALL
      SELECT q.image_media_id, 'battle', b.title
      FROM battle_questions q JOIN battle_quizzes b ON b.id = q.battle_quiz_id
      WHERE q.image_media_id IN (${ids})`);
    for (const r of rows) {
      if (!usage.has(r.media_id)) usage.set(r.media_id, { kind: r.kind, title: r.title ?? '' });
    }
    return usage;
  }

  private async problem(media: Media, size: number): Promise<ApiException | null> {
    if (await this.spreadsheet(media, size)) return spreadsheetNotAllowed();
    if (media.kind === 'avatar') {
      // BR-PRF-03: картинка-аватар учителя — JPG/PNG/WEBP ≤ 2 МБ, сигнатура как у обложек.
      if (size > PROFILE_LIMITS.photoMaxBytes) return tooLarge('size', 'fileTooLarge');
      const head = size > 0 ? await this.storage.head(media.storageKey) : Buffer.alloc(0);
      return isAvatarPhotoMime(media.mime) && coverSignatureOk(media.mime, head)
        ? null
        : unprocessable('file', 'fileSignature');
    }
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

  /**
   * BR-FILE-09: таблица по имени, MIME или содержимому. ZIP- и CFB-контейнер читается целиком (материал ≤ 25 МБ,
   * картинка ≤ 5 МБ): книгу Excel под чужим расширением видно только по каталогу архива.
   */
  private async spreadsheet(media: Media, size: number): Promise<boolean> {
    if (isSpreadsheetFile(media.originalName, media.mime)) return true;
    if (size === 0 || size > FILE_LIMITS.materialMaxBytes) return false;
    const head = await this.storage.head(media.storageKey, 8);
    return mayHideSpreadsheet(head) && isSpreadsheetContent(await this.storage.read(media.storageKey));
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
