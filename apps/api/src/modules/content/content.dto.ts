import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** OpenAPI-описание тел и ответов модуля content (6.4, 6.5). Валидация — Zod-схемами packages/shared. */

const translationsSchema = (props: Record<string, { type: 'string'; maxLength: number }>) => ({
  type: 'object' as const,
  description: 'Переводы по языкам ru / kk / en; хотя бы один язык с названием',
  properties: Object.fromEntries(
    ['ru', 'kk', 'en'].map((l) => [l, { type: 'object' as const, properties: props }]),
  ),
});

const subjectLang = {
  title: { type: 'string' as const, maxLength: 150 },
  description: { type: 'string' as const, maxLength: 1000 },
};
const topicLang = {
  ...subjectLang,
  funFact: { type: 'string' as const, maxLength: 500 },
  bodyMd: { type: 'string' as const, maxLength: 50000 },
};

export type Translations<T> = Partial<Record<'ru' | 'kk' | 'en', T>>;
export interface SubjectLangDto {
  title: string;
  description?: string | null;
}
export interface TopicLangDto extends SubjectLangDto {
  funFact?: string | null;
  bodyMd?: string | null;
}

/** API-T-02 / API-T-03 PATCH */
export class SubjectBody {
  @ApiProperty(translationsSchema(subjectLang)) translations: Translations<SubjectLangDto>;
  @ApiProperty({ default: false }) inPublicCatalog: boolean;
}

/** API-T-01: «Мои курсы» (минимальная версия, PH-24). */
export class SubjectSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: ['ru', 'kk', 'en'], description: 'Язык, на котором отдано название' }) locale: string;
  @ApiProperty() inPublicCatalog: boolean;
  @ApiProperty() topicsCount: number;
}

/** REQ-TCH-ACC-02: номер, название, статус. */
export class TopicListItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Номер темы (позиция в предмете)' }) number: number;
  @ApiProperty({ type: String, nullable: true, description: 'null — тема ещё без названия' })
  title: string | null;
  @ApiProperty({ enum: ['draft', 'published'] }) status: 'draft' | 'published';
  @ApiProperty({ description: 'Черновик можно удалить (BR-DEL-01): ни разу не публиковался и без заданий' })
  deletable: boolean;
}

/** API-T-03 GET */
export class SubjectDetailDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty(translationsSchema(subjectLang)) translations: Translations<SubjectLangDto>;
  @ApiProperty() inPublicCatalog: boolean;
  @ApiProperty({ type: String, format: 'uuid', isArray: true, description: 'Классы с действующей выдачей' })
  grantedClassIds: string[];
  @ApiProperty({ type: TopicListItemDto, isArray: true }) topics: TopicListItemDto[];
}

/** API-T-07 */
export class GrantAccessBody {
  @ApiProperty({ format: 'uuid' }) classId: string;
}

export class CreatedIdDto {
  @ApiProperty({ format: 'uuid' }) id: string;
}

/** Материал темы со статусом проверки (REQ-TCH-TOP-05). */
export class MaterialDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() mime: string;
  @ApiProperty() size: number;
  @ApiProperty({ enum: ['pending', 'clean', 'rejected'] }) scanStatus: 'pending' | 'clean' | 'rejected';
  @ApiProperty({ type: String, nullable: true, description: 'Подписанная ссылка на 10 минут, только clean' })
  url: string | null;
  @ApiProperty({ description: 'BR-FILE-09: таблица, загруженная до запрета; ученикам не выдаётся' })
  formatNotSupported: boolean;
}

/** API-T-10 PUT */
export class TopicBody {
  @ApiProperty(translationsSchema(topicLang)) translations: Translations<TopicLangDto>;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) coverMediaId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'https-ссылка на изображение' })
  coverUrl?: string | null;
  @ApiProperty({ type: String, format: 'uuid', isArray: true, maxItems: 20 }) materialIds: string[];
}

/** API-T-10 GET */
export class TopicDetailDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) subjectId: string;
  @ApiProperty() number: number;
  @ApiProperty({ enum: ['draft', 'published'] }) status: 'draft' | 'published';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Номер опубликованной версии' })
  versionNo: number | null;
  @ApiProperty(translationsSchema(topicLang)) translations: Translations<TopicLangDto>;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) coverMediaId: string | null;
  @ApiProperty({ type: String, nullable: true }) coverUrl: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Миниатюра выбранной обложки' })
  coverPreviewUrl: string | null;
  @ApiProperty({ type: MaterialDto, isArray: true }) materials: MaterialDto[];
  @ApiProperty({ format: 'uuid' }) quizId: string;
  @ApiProperty({ description: 'Черновик можно удалить (BR-DEL-01): ни разу не публиковался и без заданий' })
  deletable: boolean;
}

/** API-T-11 */
export class AiDraftBody {
  @ApiPropertyOptional({ maxLength: 150, description: 'Название из формы (может быть не сохранено)' })
  title?: string;
}

class AiDraftLangDto {
  @ApiProperty({ maxLength: 150 }) title: string;
  @ApiProperty() description: string;
  @ApiProperty() funFact: string;
  @ApiProperty() bodyMd: string;
}

export class AiDraftResponse {
  @ApiProperty({ type: AiDraftLangDto }) ru: AiDraftLangDto;
  @ApiProperty({ type: AiDraftLangDto }) kk: AiDraftLangDto;
}

/** API-T-12 */
export class PublishBody {
  @ApiPropertyOptional({ maxLength: 500 }) changeNote?: string;
}

export class PublishResultDto {
  @ApiProperty({ enum: ['draft', 'published'] }) status: 'draft' | 'published';
  @ApiProperty({ type: Number, nullable: true }) versionNo: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt: string | null;
}

/** API-T-14 (PH-25: без восстановления) */
export class TopicVersionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() versionNo: number;
  @ApiProperty({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty() authorName: string;
}

class LessonSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
}

class LessonSectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() number: number;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) body: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Иллюстрация раздела базового урока — подписанная ссылка на 10 минут (BR-FILE-04)',
  })
  illustrationUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Подпись иллюстрации раздела' })
  illustrationAlt?: string | null;
}

class TimelineLivedDto {
  @ApiProperty() from: number;
  @ApiProperty() to: number;
}

/** REQ-TL-01: событие ленты времени — год, раздел урока, подпись; годы жизни — в подписи точки. */
class TimelineEventDto {
  @ApiProperty() year: number;
  @ApiProperty({ format: 'uuid', description: 'Раздел урока, к которому ведёт точка (REQ-TL-04)' })
  sectionId: string;
  @ApiProperty({ description: 'Название раздела на языке урока' }) name: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: TimelineLivedDto, nullable: true }) lived: TimelineLivedDto | null;
}

class LessonNextDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
}

class LessonMaterialDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Подписанная ссылка на 10 минут (BR-FILE-04)' }) url: string;
}

/** API-S-06 и API-T-15 (предпросмотр глазами ученика). */
export class LessonDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Квиз темы — для API-S-07' })
  quizId: string | null;
  @ApiProperty({ type: LessonSubjectDto }) subject: LessonSubjectDto;
  @ApiProperty() title: string;
  @ApiProperty() number: number;
  @ApiProperty() questionsCount: number;
  @ApiProperty({ type: String, nullable: true }) summary: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '«Интересный факт» — карточка после описания (решение владельца 2026-10-16)',
  })
  funFact: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) bodyMd?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) illustrationUrl?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Подпись иллюстрации темы' })
  illustrationAlt?: string | null;
  @ApiProperty({
    description: 'Перевод подготовлен ИИ и ждёт вычитки — пометка «На проверке» (BR-CNT-05)',
  })
  needsReview: boolean;
  @ApiProperty({ type: LessonSectionDto, isArray: true }) sections: LessonSectionDto[];
  @ApiPropertyOptional({
    type: TimelineEventDto,
    isArray: true,
    description: 'Лента времени над разделами (REQ-TL-01…05): только у темы с timeline.yaml, по году',
  })
  timeline?: TimelineEventDto[];
  @ApiProperty({
    type: LessonMaterialDto,
    isArray: true,
    description: 'Материалы урока — только прошедшие проверку (BR-FILE-04)',
  })
  materials: LessonMaterialDto[];
  @ApiProperty({ type: LessonNextDto, nullable: true }) next: LessonNextDto | null;
  @ApiProperty({
    enum: ['ru', 'kk', 'en'],
    description: 'Фактический язык урока; нет перевода — RU с пометкой (REQ-ST-LES-07)',
  })
  locale: string;
}

class CatalogSectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ enum: ['section'] }) status: 'section';
}

class CatalogSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({
    enum: ['available', 'soon'],
    description: '«Скоро» — у предмета нет опубликованных тем, карточка не кликабельна (BR-CNT-08)',
  })
  status: 'available' | 'soon';
}

/** API-S-05 */
export class SectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: CatalogSubjectDto, isArray: true }) subjects: CatalogSubjectDto[];
}

class StudentTopicItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() number: number;
  @ApiProperty() title: string;
  @ApiProperty({
    enum: ['mastered', 'started', 'not_started'],
    description:
      '«Освоена» (лучший результат ≥ порога PH-38), «Начата» (тема открыта или есть попытка), «Не начата»',
  })
  status: 'mastered' | 'started' | 'not_started';
}

/** Глава базового предмета (BR-CHAP-03): темы главы — по порядку из topics. */
class SubjectChapterDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, format: 'uuid', isArray: true }) topicIds: string[];
}

const chaptersProperty = {
  type: SubjectChapterDto,
  isArray: true,
  description:
    'Главы предмета (BR-CHAP-01…05): есть только у базовых предметов с главами; без глав поля нет — темы списком',
};

class PeriodicTableElementDto {
  @ApiProperty({ minimum: 1, maximum: 118 }) number: number;
  @ApiProperty({ format: 'uuid', description: 'Опубликованный урок элемента' }) topicId: string;
}

/** REQ-PTBL-01, REQ-PTBL-04: блок «Периодическая таблица» — элементы с уроками; остальные ячейки — «Скоро». */
class PeriodicTableDto {
  @ApiProperty({ type: PeriodicTableElementDto, isArray: true }) elements: PeriodicTableElementDto[];
}

const periodicTableProperty = {
  type: PeriodicTableDto,
  description: 'Блок «Периодическая таблица» (REQ-PTBL-01): только если включён в subject.yaml',
};

const hasGlossaryProperty = {
  type: Boolean,
  description: 'У предмета есть глоссарий — кнопка «Глоссарий» (REQ-GLOS-02); нет глоссария — поля нет',
};

/** Страница предмета ученика (решение владельца 2026-10-14): опубликованные темы по position. */
export class StudentSubjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: StudentTopicItemDto, isArray: true }) topics: StudentTopicItemDto[];
  @ApiPropertyOptional(chaptersProperty) chapters?: SubjectChapterDto[];
  @ApiPropertyOptional(hasGlossaryProperty) hasGlossary?: boolean;
  @ApiPropertyOptional(periodicTableProperty) periodicTable?: PeriodicTableDto;
}

class PublicTopicItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() number: number;
  @ApiProperty() title: string;
}

/** API-PUB-12: базовый предмет для гостя — без статусов тем (BR-VIS-04). */
export class PublicSubjectPageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: PublicTopicItemDto, isArray: true }) topics: PublicTopicItemDto[];
  @ApiPropertyOptional(chaptersProperty) chapters?: SubjectChapterDto[];
  @ApiPropertyOptional(hasGlossaryProperty) hasGlossary?: boolean;
  @ApiPropertyOptional(periodicTableProperty) periodicTable?: PeriodicTableDto;
}

class GlossaryTermDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() term: string;
  @ApiProperty() definition: string;
}

class GlossarySectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({
    type: GlossaryTermDto,
    isArray: true,
    description: 'По алфавиту языка ответа (REQ-GLOS-04)',
  })
  terms: GlossaryTermDto[];
}

/** API-S-22, API-PUB-14: глоссарий предмета (REQ-GLOS-01…04). */
export class GlossaryDto {
  @ApiProperty({ type: LessonSubjectDto }) subject: LessonSubjectDto;
  @ApiProperty({ type: GlossarySectionDto, isArray: true }) sections: GlossarySectionDto[];
  @ApiProperty({
    description: 'Показанный перевод подготовлен ИИ и ждёт вычитки — пометка «На проверке» (BR-CNT-05)',
  })
  needsReview: boolean;
}

/** API-S-17 */
export class LessonEventBody {
  @ApiProperty({ enum: ['lesson_opened'] }) type: 'lesson_opened';
  @ApiProperty({ format: 'uuid' }) topicId: string;
  @ApiProperty({ example: 'lesson:{topicId}:2026-10-16' }) idempotencyKey: string;
}

/** API-S-04 */
export class CatalogDto {
  @ApiProperty({ type: CatalogSectionDto, isArray: true }) sections: CatalogSectionDto[];
  @ApiProperty({ type: CatalogSubjectDto, isArray: true }) subjects: CatalogSubjectDto[];
}
