import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import { type Locale, type TopicSnapshot } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { pickTranslation } from '../../common/locale';
import { type Tx } from '../../common/idempotency';
import { DB } from '../../infra/tokens';
import { StorageService } from '../files/storage.service';
import { type LessonDto } from './content.dto';

const { topics, topicTranslations: tt, topicSections, topicSectionTranslations: tst } = schema;
const { topicVersions, topicMaterials, mediaFiles, subjectTranslations, quizzes, questions } = schema;

/** Перевод из записи снимка: запрошенный язык, затем ru, en, kk (REQ-GEN-PREF-02). */
function pick<T>(translations: Partial<Record<Locale, T>>, locale: Locale): [Locale, T] | undefined {
  for (const l of [locale, 'ru', 'en', 'kk'] as Locale[]) {
    const t = translations[l];
    if (t) return [l, t];
  }
  return undefined;
}

/**
 * Представление урока (API-S-06) — общее для ученика и предпросмотра учителя (API-T-15): ученик видит снимок
 * опубликованной версии (REQ-TCH-PUB-05), учитель — текущий черновик в том же виде. Файлы — только clean,
 * подписанными ссылками на 10 минут (BR-FILE-04).
 */
@Injectable()
export class LessonService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  /** Снимок текущего содержимого темы — для публикации (API-T-12) и предпросмотра (API-T-15). */
  async draftSnapshot(topicId: string, tx: Tx | Database = this.db): Promise<TopicSnapshot> {
    const [topic] = await tx
      .select({ coverMediaId: topics.coverMediaId, coverUrl: topics.coverUrl })
      .from(topics)
      .where(eq(topics.id, topicId));
    const [translations, sections, materials] = await Promise.all([
      tx.select().from(tt).where(eq(tt.topicId, topicId)),
      tx
        .select()
        .from(topicSections)
        .where(eq(topicSections.topicId, topicId))
        .orderBy(asc(topicSections.position)),
      tx
        .select({ mediaId: topicMaterials.mediaId })
        .from(topicMaterials)
        .where(eq(topicMaterials.topicId, topicId))
        .orderBy(asc(topicMaterials.position)),
    ]);
    const sectionTr = sections.length
      ? await tx
          .select()
          .from(tst)
          .where(
            inArray(
              tst.sectionId,
              sections.map((s) => s.id),
            ),
          )
      : [];
    const snapshot: TopicSnapshot = {
      translations: {},
      sections: sections.map((s) => ({
        id: s.id,
        position: s.position,
        illustrationMediaId: s.illustrationMediaId,
        translations: Object.fromEntries(
          sectionTr
            .filter((t) => t.sectionId === s.id)
            .map((t) => [t.locale!, { title: t.title, ...(t.body ? { body: t.body } : {}) }]),
        ),
      })),
      coverMediaId: topic?.coverMediaId ?? null,
      coverUrl: topic?.coverUrl ?? null,
      materialIds: materials.map((m) => m.mediaId!),
    };
    for (const t of translations) {
      snapshot.translations[t.locale!] = {
        title: t.title,
        ...(t.description ? { description: t.description } : {}),
        ...(t.funFact ? { funFact: t.funFact } : {}),
        ...(t.bodyMd ? { bodyMd: t.bodyMd } : {}),
        ...(t.summary ? { summary: t.summary } : {}),
      };
    }
    return snapshot;
  }

  /** Снимок опубликованной версии; null — тема не опубликована. */
  async publishedSnapshot(topicId: string): Promise<TopicSnapshot | null> {
    const [row] = await this.db
      .select({ snapshot: topicVersions.snapshot })
      .from(topics)
      .innerJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
      .where(and(eq(topics.id, topicId), eq(topics.status, 'published')));
    return (row?.snapshot as TopicSnapshot | undefined) ?? null;
  }

  async render(topicId: string, snapshot: TopicSnapshot, locale: Locale): Promise<LessonDto> {
    const [topic] = await this.db
      .select({ subjectId: topics.subjectId, position: topics.position })
      .from(topics)
      .where(eq(topics.id, topicId));
    const { subjectId, position } = topic!;
    const [subjectTr, [questionsRow], next] = await Promise.all([
      this.db.select().from(subjectTranslations).where(eq(subjectTranslations.subjectId, subjectId)),
      this.db
        .select({ n: count(questions.id) })
        .from(questions)
        .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
        .where(and(eq(quizzes.topicId, topicId), isNull(questions.archivedAt))),
      this.nextTopic(subjectId, position, locale),
    ]);
    const [actualLocale, tr] = pick(snapshot.translations, locale) ?? [locale, undefined];
    const [quiz] = await this.db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.topicId, topicId));
    return {
      id: topicId,
      quizId: quiz?.id ?? null,
      subject: { id: subjectId, title: pickTranslation(subjectTr, locale)?.title ?? '' },
      title: tr?.title ?? '',
      number: position,
      questionsCount: Number(questionsRow?.n ?? 0),
      summary: tr?.summary ?? tr?.description ?? null,
      funFact: tr?.funFact ?? null,
      bodyMd: tr?.bodyMd ?? null,
      illustrationUrl: await this.coverUrl(snapshot),
      sections: [...snapshot.sections]
        .sort((a, b) => a.position - b.position)
        .flatMap((s, i) => {
          const st = pick(s.translations, actualLocale)?.[1];
          return st ? [{ id: s.id, number: i + 1, title: st.title, body: st.body ?? null }] : [];
        }),
      materials: await this.cleanMaterials(snapshot.materialIds ?? []),
      next,
      locale: actualLocale,
    };
  }

  /**
   * Обложка — только из нашего хранилища и только clean (BR-FILE-04). Ссылку учителя сервер скачивает при
   * сохранении (BR-FILE-06); внешний адрес ученику не отдаётся.
   */
  async coverUrl(snapshot: Pick<TopicSnapshot, 'coverMediaId' | 'coverUrl'>): Promise<string | null> {
    if (snapshot.coverMediaId) {
      const [media] = await this.db
        .select({ key: mediaFiles.storageKey, status: mediaFiles.scanStatus })
        .from(mediaFiles)
        .where(eq(mediaFiles.id, snapshot.coverMediaId));
      return media?.status === 'clean' ? this.storage.downloadUrl(media.key) : null;
    }
    return null;
  }

  private async cleanMaterials(ids: string[]): Promise<LessonDto['materials']> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: mediaFiles.id, name: mediaFiles.originalName, key: mediaFiles.storageKey })
      .from(mediaFiles)
      .where(and(inArray(mediaFiles.id, ids), eq(mediaFiles.scanStatus, 'clean')));
    const ordered = ids.flatMap((id) => rows.filter((r) => r.id === id));
    return Promise.all(
      ordered.map(async (r) => ({
        id: r.id,
        name: r.name,
        url: await this.storage.downloadUrl(r.key, r.name),
      })),
    );
  }

  /** REQ-ST-LES-03, PH-35: следующая опубликованная тема предмета по position. */
  private async nextTopic(subjectId: string, position: number, locale: Locale): Promise<LessonDto['next']> {
    const [row] = await this.db
      .select({ id: topics.id, snapshot: topicVersions.snapshot })
      .from(topics)
      .innerJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
      .where(
        and(
          eq(topics.subjectId, subjectId),
          gt(topics.position, position),
          eq(topics.status, 'published'),
          isNull(topics.archivedAt),
        ),
      )
      .orderBy(asc(topics.position))
      .limit(1);
    if (!row) return null;
    const title = pick((row.snapshot as TopicSnapshot).translations, locale)?.[1].title ?? '';
    return { id: row.id, title };
  }
}
