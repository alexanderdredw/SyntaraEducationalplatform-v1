import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { AppConfigService } from '../../config/app-config.service';
import { pickTranslation } from '../../common/locale';
import { DB } from '../../infra/tokens';
import { type PublicConfigDto, type PublicSubjectDto } from './public.dto';

/**
 * Иконки карточек публичных предметов (Lucide). В SPEC не заданы; набор подтверждён владельцем (2026-10-14).
 */
const SUBJECT_ICONS: Record<string, string> = {
  biology: 'dna',
  chemistry: 'flask-conical',
  physics: 'atom',
};
const DEFAULT_ICON = 'book-open';

@Injectable()
export class PublicService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: AppConfigService,
  ) {}

  /**
   * API-PUB-01. Список — разделы каталога из PH-01 `catalog.public_subjects`.
   * Статус для гостя (решение по Q-22): есть опубликованные темы в предметах общего каталога → 'login_required'
   * (уроки доступны после входа, матрица 1.2), иначе 'soon'. 'open' выдаётся ученику после входа (итерация 6).
   * Сортировка: доступные — первыми, «Скоро» — отдельной группой после них (REQ-PUB-SUBJ-02).
   */
  async subjects(locale: Locale): Promise<PublicSubjectDto[]> {
    const codes = await this.config.get<string[]>('catalog.public_subjects');
    if (codes.length === 0) return [];
    const { catalogSections, catalogSectionTranslations, subjects, topics } = schema;

    const sections = await this.db
      .select({ id: catalogSections.id, code: catalogSections.code })
      .from(catalogSections)
      .where(inArray(catalogSections.code, codes));
    const ids = sections.map((s) => s.id);
    if (ids.length === 0) return [];

    const translations = await this.db
      .select()
      .from(catalogSectionTranslations)
      .where(inArray(catalogSectionTranslations.sectionId, ids));

    const withContent = await this.db
      .selectDistinct({ sectionId: subjects.sectionId })
      .from(subjects)
      .innerJoin(topics, eq(topics.subjectId, subjects.id))
      .where(
        and(
          inArray(subjects.sectionId, ids),
          eq(subjects.inPublicCatalog, true),
          isNull(subjects.archivedAt),
          eq(topics.status, 'published'),
          isNull(topics.archivedAt),
        ),
      );
    const available = new Set(withContent.map((r) => r.sectionId));

    const items = sections
      .sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code))
      .flatMap((section): PublicSubjectDto[] => {
        const tr = pickTranslation(
          translations.filter((t) => t.sectionId === section.id),
          locale,
        );
        if (!tr) return [];
        const status = available.has(section.id) ? 'login_required' : 'soon';
        return [
          {
            id: section.id,
            code: section.code,
            title: tr.title,
            description: tr.description,
            icon: SUBJECT_ICONS[section.code] ?? DEFAULT_ICON,
            status,
            href:
              status === 'login_required'
                ? `/auth/login?returnTo=${encodeURIComponent(`/learn/sections/${section.id}`)}`
                : null,
            locale: tr.locale,
          },
        ];
      });
    return [...items.filter((i) => i.status !== 'soon'), ...items.filter((i) => i.status === 'soon')];
  }

  /** API-PUB-07: только публичные значения (PH-04, PH-09, PH-10, PH-11, PH-13). */
  async publicConfig(): Promise<PublicConfigDto> {
    const [supportEmail, atlas, offline, pricingVisible, enabledLocales] = await Promise.all([
      this.config.get<string>('support.email'),
      this.config.get<{ mendeleev: string | null; anatomy: string | null }>('atlas.urls'),
      this.config.get<boolean>('features.offline'),
      this.config.get<boolean>('pricing.visible'),
      this.config.get<Locale[]>('i18n.enabled_locales'),
    ]);
    return {
      supportEmail,
      atlasUrls: { mendeleev: atlas.mendeleev ?? null, anatomy: atlas.anatomy ?? null },
      features: { offline, pricingVisible, enabledLocales },
    };
  }
}
