import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, max, ne } from 'drizzle-orm';
import {
  FILE_LIMITS,
  filledTranslations,
  type Locale,
  type PublishDto,
  type TopicContentDto,
} from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { AppConfigService } from '../../config/app-config.service';
import { DB } from '../../infra/tokens';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { StorageService } from '../files/storage.service';
import {
  type LessonDto,
  type MaterialDto,
  type PublishResultDto,
  type TopicDetailDto,
  type TopicLangDto,
  type TopicVersionDto,
  type Translations,
} from './content.dto';
import { LessonService } from './lesson.service';

const { topics, topicTranslations: tt, topicVersions, topicMaterials, mediaFiles, quizzes, users } = schema;

const invalid = (fieldErrors: Record<string, string>) =>
  new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Validation failed', fieldErrors);
const unprocessable = (fieldErrors: Record<string, string>) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'UNPROCESSABLE', 'File limits exceeded', fieldErrors);
const invalidTransition = () =>
  new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', 'Transition not allowed');

/**
 * Темы (8.3.3–8.3.4, SM-TOPIC). Владение проверяет OwnershipGuard (BR-ACL-01).
 * Сохранение меняет только черновое содержимое (REQ-TCH-TOP-06); ученик видит снимок published_version_id,
 * пока тема не опубликована повторно (REQ-TCH-PUB-05). Публикация и снятие пишутся в audit_log (REQ-NFR-SEC-05).
 */
@Injectable()
export class TopicsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly lessons: LessonService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    private readonly config: AppConfigService,
  ) {}

  /** API-T-10 GET */
  async get(id: string): Promise<TopicDetailDto> {
    const [row] = await this.db
      .select({
        topic: topics,
        versionNo: topicVersions.versionNo,
        quizId: quizzes.id,
      })
      .from(topics)
      .leftJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
      .leftJoin(quizzes, eq(quizzes.topicId, topics.id))
      .where(eq(topics.id, id));
    const topic = row!.topic;
    const translations = await this.db.select().from(tt).where(eq(tt.topicId, id));
    const tr: Translations<TopicLangDto> = {};
    for (const t of translations) {
      tr[t.locale!] = { title: t.title, description: t.description, funFact: t.funFact, bodyMd: t.bodyMd };
    }
    return {
      id,
      subjectId: topic.subjectId,
      number: topic.position,
      status: topic.status,
      publishedAt: topic.status === 'published' ? (topic.publishedAt?.toISOString() ?? null) : null,
      versionNo: topic.status === 'published' ? (row!.versionNo ?? null) : null,
      translations: tr,
      coverMediaId: topic.coverMediaId,
      coverUrl: topic.coverUrl,
      coverPreviewUrl: await this.lessons.coverUrl(topic),
      materials: await this.materials(id),
      quizId: row!.quizId ?? (await this.ensureQuiz(id)),
    };
  }

  /**
   * API-T-10 PUT: переводы, обложка (файл из своей галереи или https-ссылка, PH-26) и материалы темы.
   * Статус не меняется. Материалы — только свои файлы kind=material; лимиты BR-FILE-02 проверяются повторно.
   */
  async save(teacherId: string, id: string, dto: TopicContentDto): Promise<void> {
    // BR-FILE-06: ссылка на обложку — картинка скачивается в наше хранилище (до транзакции: сетевой запрос).
    // Та же ссылка, что уже сохранена, повторно не скачивается.
    let coverMediaId = dto.coverMediaId ?? null;
    if (dto.coverUrl) {
      const [current] = await this.db
        .select({ coverUrl: topics.coverUrl, coverMediaId: topics.coverMediaId })
        .from(topics)
        .where(eq(topics.id, id));
      coverMediaId =
        current?.coverUrl === dto.coverUrl && current.coverMediaId
          ? current.coverMediaId
          : await this.files.ingestCover(teacherId, dto.coverUrl);
    }
    await this.db.transaction(async (tx) => {
      if (dto.coverMediaId) {
        const [cover] = await tx
          .select({ id: mediaFiles.id })
          .from(mediaFiles)
          .where(
            and(
              eq(mediaFiles.id, dto.coverMediaId),
              eq(mediaFiles.ownerId, teacherId),
              eq(mediaFiles.kind, 'cover'),
              ne(mediaFiles.scanStatus, 'rejected'),
            ),
          );
        if (!cover) throw invalid({ coverMediaId: 'invalidFile' });
      }
      const files = dto.materialIds.length
        ? await tx
            .select({ id: mediaFiles.id, size: mediaFiles.sizeBytes, status: mediaFiles.scanStatus })
            .from(mediaFiles)
            .where(
              and(
                inArray(mediaFiles.id, dto.materialIds),
                eq(mediaFiles.ownerId, teacherId),
                eq(mediaFiles.kind, 'material'),
              ),
            )
        : [];
      if (files.length !== dto.materialIds.length) throw invalid({ materialIds: 'invalidFile' });
      const counted = files.filter((f) => f.status !== 'rejected');
      if (counted.length > FILE_LIMITS.materialsPerTopic)
        throw unprocessable({ materialIds: 'tooManyFiles' });
      if (counted.reduce((s, f) => s + f.size, 0) > FILE_LIMITS.materialsBytesPerTopic)
        throw unprocessable({ materialIds: 'topicTooLarge' });

      await tx
        .update(topics)
        .set({
          coverMediaId,
          // Ссылка хранится как источник для формы учителя; ученику отдаётся только файл из хранилища.
          coverUrl: dto.coverUrl ?? null,
        })
        .where(eq(topics.id, id));
      await tx.delete(tt).where(eq(tt.topicId, id));
      const rows = filledTranslations(dto.translations).map(([locale, t]) => ({
        topicId: id,
        locale,
        title: t.title!,
        description: t.description ?? null,
        funFact: t.funFact ?? null,
        bodyMd: t.bodyMd ?? null,
      }));
      if (rows.length) await tx.insert(tt).values(rows);
      await tx.delete(topicMaterials).where(eq(topicMaterials.topicId, id));
      if (dto.materialIds.length) {
        await tx
          .insert(topicMaterials)
          .values(dto.materialIds.map((mediaId, i) => ({ topicId: id, mediaId, position: i + 1 })));
      }
    });
  }

  /**
   * API-T-12 (SM-TOPIC: draft|published --publish--> published): снимок черновика в topic_versions,
   * version_no + 1, published_version_id. Тему без названия опубликовать нельзя.
   */
  async publish(teacherId: string, id: string, dto: PublishDto): Promise<PublishResultDto> {
    return this.db.transaction(async (tx) => {
      // Блокировка темы: параллельные публикации не получат одинаковый version_no.
      await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, id)).for('update');
      const snapshot = await this.lessons.draftSnapshot(id, tx);
      if (Object.keys(snapshot.translations).length === 0)
        throw invalid({ translations: 'atLeastOneLanguage' });
      const [last] = await tx
        .select({ n: max(topicVersions.versionNo) })
        .from(topicVersions)
        .where(eq(topicVersions.topicId, id));
      const versionNo = (last?.n ?? 0) + 1;
      const [version] = await tx
        .insert(topicVersions)
        .values({
          topicId: id,
          versionNo,
          snapshot,
          changeNote: dto.changeNote ?? null,
          createdBy: teacherId,
        })
        .returning({ id: topicVersions.id });
      const publishedAt = new Date();
      await tx
        .update(topics)
        .set({ status: 'published', publishedVersionId: version!.id, publishedAt })
        .where(eq(topics.id, id));
      await this.audit.record(
        { actorId: teacherId, entityType: 'topic', entityId: id, action: 'publish', after: { versionNo } },
        tx,
      );
      return { status: 'published', versionNo, publishedAt: publishedAt.toISOString() };
    });
  }

  /** API-T-13 (PH-27): published --unpublish--> draft; из черновика — 409 INVALID_TRANSITION. */
  async unpublish(teacherId: string, id: string): Promise<PublishResultDto> {
    if (!(await this.config.get<boolean>('topic.unpublish_enabled'))) throw invalidTransition();
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(topics)
        .set({ status: 'draft' })
        .where(and(eq(topics.id, id), eq(topics.status, 'published')))
        .returning({ id: topics.id });
      if (updated.length === 0) throw invalidTransition();
      await this.audit.record(
        { actorId: teacherId, entityType: 'topic', entityId: id, action: 'unpublish' },
        tx,
      );
      return { status: 'draft', versionNo: null, publishedAt: null };
    });
  }

  /** API-T-14 (PH-25: только просмотр, без восстановления). */
  async versions(id: string): Promise<TopicVersionDto[]> {
    const rows = await this.db
      .select({
        id: topicVersions.id,
        versionNo: topicVersions.versionNo,
        changeNote: topicVersions.changeNote,
        createdAt: topicVersions.createdAt,
        authorName: users.displayName,
      })
      .from(topicVersions)
      .innerJoin(users, eq(users.id, topicVersions.createdBy))
      .where(eq(topicVersions.topicId, id))
      .orderBy(desc(topicVersions.versionNo));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** API-T-15: черновик в представлении ученика, без публикации (BR-VIS-02 — только владельцу). */
  async preview(id: string, locale: Locale): Promise<LessonDto> {
    return this.lessons.render(id, await this.lessons.draftSnapshot(id), locale);
  }

  async materials(topicId: string): Promise<MaterialDto[]> {
    const rows = await this.db
      .select({
        id: mediaFiles.id,
        name: mediaFiles.originalName,
        mime: mediaFiles.mime,
        size: mediaFiles.sizeBytes,
        scanStatus: mediaFiles.scanStatus,
        key: mediaFiles.storageKey,
      })
      .from(topicMaterials)
      .innerJoin(mediaFiles, eq(mediaFiles.id, topicMaterials.mediaId))
      .where(eq(topicMaterials.topicId, topicId))
      .orderBy(asc(topicMaterials.position));
    return Promise.all(
      rows.map(async ({ key, ...r }) => ({
        ...r,
        url: r.scanStatus === 'clean' ? await this.storage.downloadUrl(key, r.name) : null,
      })),
    );
  }

  /** Темы seed и старых данных могут не иметь квиза — создаётся при первом обращении. */
  private async ensureQuiz(topicId: string): Promise<string> {
    await this.db.insert(quizzes).values({ topicId }).onConflictDoNothing({ target: quizzes.topicId });
    const [quiz] = await this.db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.topicId, topicId));
    return quiz!.id;
  }
}
