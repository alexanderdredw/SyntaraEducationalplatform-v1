import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { type Locale, periodicElement, type TopicSnapshot } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { StudentContentService } from '../content/student-content.service';
import { VisibilityService } from '../content/visibility.service';
import { StorageService } from '../files/storage.service';
import { type AtlasDto } from './atlas.dto';

const { subjects, subjectTranslations, topics, topicVersions, mediaFiles, glossarySections } = schema;

export const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');

/** Код урока «Учёные-химики» в предмете с модулем атласа (content/…/61-chemists, экран «Учёные»). */
const SCIENTISTS_TOPIC = 'chemists';

/** Перевод из снимка: запрошенный язык, затем ru, en, kk (REQ-GEN-PREF-02). */
export function pick<T>(translations: Partial<Record<Locale, T>>, locale: Locale): [Locale, T] | undefined {
  for (const l of [locale, 'ru', 'en', 'kk'] as Locale[]) {
    const t = translations[l];
    if (t) return [l, t];
  }
  return undefined;
}

export interface AtlasTopicRow {
  id: string;
  /** Код темы без кода предмета. */
  code: string;
  elementNumber: number | null;
  coverMediaId: string | null;
  snapshot: TopicSnapshot;
}

/**
 * Данные модуля «Mendeleev Atlas» (REQ-ATL-01, REQ-ATL-03, REQ-ATL-04): темы-элементы для Explore, окна элемента,
 * Поиска и квиза; урок «Учёные-химики» — для экрана «Учёные». Только опубликованные снимки (REQ-TCH-PUB-05).
 * Видимость — VisibilityService (ученик — BR-VIS-01, гость — BR-VIS-04); предмет без модуля → 404.
 */
@Injectable()
export class AtlasService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly visibility: VisibilityService,
    private readonly content: StudentContentService,
    private readonly storage: StorageService,
  ) {}

  /** Предмет виден зрителю (ID ученика или null — гость) и включает модуль атласа; иначе 404. */
  async assertAtlas(viewer: string | null, subjectId: string): Promise<void> {
    const visible =
      viewer === null
        ? await this.visibility.canGuestSeeSubject(subjectId)
        : await this.visibility.canStudentSeeSubject(viewer, subjectId);
    if (!visible) throw notFound();
    const [row] = await this.db
      .select({ module: subjects.module })
      .from(subjects)
      .where(eq(subjects.id, subjectId));
    if (row?.module !== 'atlas-chemistry') throw notFound();
  }

  /** Опубликованные темы предмета по порядку (общие для данных экранов и квиза). */
  async topics(subjectId: string): Promise<AtlasTopicRow[]> {
    const rows = await this.db
      .select({
        id: topics.id,
        code: topics.code,
        elementNumber: topics.elementNumber,
        coverMediaId: topics.coverMediaId,
        snapshot: topicVersions.snapshot,
      })
      .from(topics)
      .innerJoin(topicVersions, eq(topicVersions.id, topics.publishedVersionId))
      .where(and(eq(topics.subjectId, subjectId), eq(topics.status, 'published'), isNull(topics.archivedAt)))
      .orderBy(asc(topics.position));
    return rows.map((r) => ({
      id: r.id,
      code: (r.code ?? '').split('/').pop() ?? '',
      elementNumber: r.elementNumber,
      coverMediaId: r.coverMediaId,
      snapshot: r.snapshot as TopicSnapshot,
    }));
  }

  static elements(rows: AtlasTopicRow[]): Array<AtlasTopicRow & { elementNumber: number }> {
    return rows
      .filter((r): r is AtlasTopicRow & { elementNumber: number } => r.elementNumber !== null)
      .sort((a, b) => a.elementNumber - b.elementNumber);
  }

  static scientists(rows: AtlasTopicRow[]): AtlasTopicRow | undefined {
    return rows.find((r) => r.code === SCIENTISTS_TOPIC);
  }

  /** API-S-23 / API-PUB-15. */
  async data(viewer: string | null, subjectId: string, locale: Locale): Promise<AtlasDto> {
    await this.assertAtlas(viewer, subjectId);
    const rows = await this.topics(subjectId);
    const elements = AtlasService.elements(rows);
    const scientists = AtlasService.scientists(rows);
    const [subjectTr, [glossary], images, statuses] = await Promise.all([
      this.db.select().from(subjectTranslations).where(eq(subjectTranslations.subjectId, subjectId)),
      this.db
        .select({ id: glossarySections.id })
        .from(glossarySections)
        .where(eq(glossarySections.subjectId, subjectId))
        .limit(1),
      this.imageUrls(elements.map((e) => e.coverMediaId)),
      viewer === null
        ? Promise.resolve(null)
        : this.content.topicStatuses(
            viewer,
            rows.map((r) => r.id),
          ),
    ]);
    let needsReview = false;
    const status = (id: string) => (statuses ? { status: statuses.get(id) ?? 'not_started' } : {});
    return {
      subject: { id: subjectId, title: pickTranslation(subjectTr, locale)?.title ?? '' },
      elements: elements.map((e) => {
        const [, tr] = pick(e.snapshot.translations, locale) ?? [locale, undefined];
        if (tr?.needsReview) needsReview = true;
        const known = periodicElement(e.elementNumber);
        return {
          topicId: e.id,
          code: e.code,
          number: e.elementNumber,
          symbol: known?.symbol ?? '',
          group: known?.family ?? 'nonmetal',
          color: e.snapshot.element?.color ?? null,
          title: tr?.title ?? '',
          description: tr?.description ?? null,
          funFact: tr?.funFact ?? null,
          imageUrl: (e.coverMediaId && images.get(e.coverMediaId)) || null,
          imageAlt: tr?.illustrationAlt ?? null,
          ...status(e.id),
        };
      }),
      scientists: scientists
        ? {
            topicId: scientists.id,
            title: pick(scientists.snapshot.translations, locale)?.[1].title ?? '',
            ...status(scientists.id),
          }
        : null,
      hasGlossary: Boolean(glossary),
      needsReview,
    };
  }

  /** Подписанные ссылки на картинки — только clean (BR-FILE-04), одним запросом. */
  private async imageUrls(ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = ids.filter((id): id is string => Boolean(id));
    if (wanted.length === 0) return new Map();
    const rows = await this.db
      .select({ id: mediaFiles.id, key: mediaFiles.storageKey })
      .from(mediaFiles)
      .where(and(inArray(mediaFiles.id, wanted), eq(mediaFiles.scanStatus, 'clean')));
    return new Map(
      await Promise.all(rows.map(async (r) => [r.id, await this.storage.downloadUrl(r.key)] as const)),
    );
  }
}
