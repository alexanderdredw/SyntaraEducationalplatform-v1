import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { type Locale } from '@syntara/shared';
import { type Database, schema } from '@syntara/db';
import { AppConfigService } from '../../config/app-config.service';
import { pickTranslation } from '../../common/locale';
import { likeEscape } from '../support/pagination';
import { DB } from '../../infra/tokens';
import { type PublicConfigDto, type PublicSubjectDto, type SchoolDto } from './public.dto';

/**
 * Иконки карточек публичных предметов (Lucide). В SPEC не заданы; набор подтверждён владельцем (2026-10-14).
 * TODO(OWNER): иконки остальных базовых предметов PH-01 — пока общая «книга».
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
   * API-PUB-01. Список — коды PH-01 `catalog.public_subjects`: код раздела каталога или базового предмета
   * (решение владельца 2026-10-16: все базовые предметы каталога). Гость читает каталог и «Обзор» базовых уроков
   * (BR-VIS-04), поэтому есть опубликованные базовые темы → 'open' со ссылкой на раздел или предмет, иначе — 'soon'
   * без ссылки (BR-CNT-08). Сортировка: доступные — первыми, «Скоро» — отдельной группой (REQ-PUB-SUBJ-02); внутри
   * группы — порядок content/ (позиция раздела, затем предмета в разделе; решение владельца 2026-10-17).
   */
  async subjects(locale: Locale): Promise<PublicSubjectDto[]> {
    const codes = await this.config.get<string[]>('catalog.public_subjects');
    if (codes.length === 0) return [];
    const { catalogSections, catalogSectionTranslations, subjects, subjectTranslations, topics } = schema;
    const base = and(
      eq(subjects.isOfficial, true),
      eq(subjects.inPublicCatalog, true),
      isNull(subjects.archivedAt),
    );

    const [sections, baseSubjects, withContent] = await Promise.all([
      this.db
        .select({ id: catalogSections.id, code: catalogSections.code, position: catalogSections.position })
        .from(catalogSections),
      this.db
        .select({
          id: subjects.id,
          code: subjects.code,
          sectionId: subjects.sectionId,
          position: subjects.position,
        })
        .from(subjects)
        .where(and(base, inArray(subjects.code, codes))),
      this.db
        .selectDistinct({ subjectId: subjects.id, sectionId: subjects.sectionId })
        .from(subjects)
        .innerJoin(topics, eq(topics.subjectId, subjects.id))
        .where(and(base, eq(topics.status, 'published'), isNull(topics.archivedAt))),
    ]);
    const [sectionTr, subjectTr] = await Promise.all([
      sections.length
        ? this.db
            .select()
            .from(catalogSectionTranslations)
            .where(
              inArray(
                catalogSectionTranslations.sectionId,
                sections.map((s) => s.id),
              ),
            )
        : [],
      baseSubjects.length
        ? this.db
            .select()
            .from(subjectTranslations)
            .where(
              inArray(
                subjectTranslations.subjectId,
                baseSubjects.map((s) => s.id),
              ),
            )
        : [],
    ]);
    const openSections = new Set(withContent.map((r) => r.sectionId));
    const openSubjects = new Set(withContent.map((r) => r.subjectId));

    const sectionPosition = new Map(sections.map((s) => [s.id, s.position]));
    const order = (code: string): [number, number] => {
      const section = sections.find((s) => s.code === code);
      if (section) return [section.position, 0];
      const subject = baseSubjects.find((s) => s.code === code);
      return [
        subject?.sectionId ? (sectionPosition.get(subject.sectionId) ?? 0) : 0,
        subject?.position ?? Number.MAX_SAFE_INTEGER,
      ];
    };
    const ordered = [...codes].sort((a, b) => {
      const [sa, pa] = order(a);
      const [sb, pb] = order(b);
      return sa - sb || pa - pb;
    });

    const items = ordered.flatMap((code): PublicSubjectDto[] => {
      const section = sections.find((s) => s.code === code);
      const subject = section ? undefined : baseSubjects.find((s) => s.code === code);
      const id = section?.id ?? subject?.id;
      if (!id) return [];
      const tr = section
        ? pickTranslation(
            sectionTr.filter((t) => t.sectionId === id),
            locale,
          )
        : pickTranslation(
            subjectTr.filter((t) => t.subjectId === id),
            locale,
          );
      if (!tr) return [];
      const open = section ? openSections.has(id) : openSubjects.has(id);
      return [
        {
          id,
          code,
          title: tr.title,
          description: tr.description,
          icon: SUBJECT_ICONS[code] ?? DEFAULT_ICON,
          status: open ? 'open' : 'soon',
          href: open ? (section ? `/learn/sections/${id}` : `/learn/subjects/${id}`) : null,
          locale: tr.locale,
        },
      ];
    });
    return [...items.filter((i) => i.status !== 'soon'), ...items.filter((i) => i.status === 'soon')];
  }

  /**
   * API-PUB-09: автодополнение школы — только подтверждённые школы справочника (status = 'active');
   * введённые учениками вручную ('unverified') в подсказки не попадают.
   */
  async schools(q: string): Promise<SchoolDto[]> {
    const { schools } = schema;
    const pattern = `%${likeEscape(q)}%`;
    return this.db
      .select({ id: schools.id, name: schools.name, city: schools.city, region: schools.region })
      .from(schools)
      .where(
        and(eq(schools.status, 'active'), or(ilike(schools.name, pattern), ilike(schools.city, pattern))),
      )
      .orderBy(asc(schools.name), asc(schools.id))
      .limit(10);
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
