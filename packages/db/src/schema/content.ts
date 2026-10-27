import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, id, timestamps, tstz } from './_common';
import { localeEnum, mediaKindEnum, scanStatusEnum, topicStatusEnum } from './enums';
import { classes, users } from './users';

/** 5.4 Учебный контент. Переводы — таблицы *_translations с PK (entity_id, locale). */

export const catalogSections = pgTable('catalog_sections', {
  id: id(),
  code: text('code').notNull().unique(),
  position: integer('position').notNull(),
  ...timestamps,
});

export const catalogSectionTranslations = pgTable(
  'catalog_section_translations',
  {
    sectionId: uuid('section_id').references(() => catalogSections.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    description: text('description'),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.locale] })],
);

export const subjects = pgTable(
  'subjects',
  {
    id: id(),
    ownerId: uuid('owner_id').references(() => users.id),
    sectionId: uuid('section_id').references(() => catalogSections.id),
    isOfficial: boolean('is_official').notNull().default(false),
    inPublicCatalog: boolean('in_public_catalog').notNull().default(false),
    archivedAt: tstz('archived_at'),
    /** Постоянный код базового предмета из content/ (BR-CNT-04); у предметов учителей — NULL. */
    code: text('code').unique(),
    /** Порядок базового предмета в каталоге — из subject.yaml (решение владельца 2026-10-17); у предметов учителей — NULL. */
    position: integer('position'),
    /** Блоки страницы базового предмета из subject.yaml (REQ-PTBL-01): пока только 'periodic-table'. */
    blocks: text('blocks')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Модуль базового предмета со своим интерфейсом из subject.yaml (REQ-ATL-01): пока только 'atlas-chemistry'
     * («Mendeleev Atlas», docs/CHEM_TZ_2.md); NULL — стандартная страница предмета.
     */
    module: text('module'),
    ...timestamps,
  },
  (t) => [
    check('subjects_blocks', sql`${t.blocks} <@ ARRAY['periodic-table']::text[]`),
    check(
      'subjects_module',
      sql`${t.module} IS NULL OR (${t.isOfficial} AND ${t.module} IN ('atlas-chemistry'))`,
    ),
    check('subjects_official_or_owner', sql`${t.isOfficial} OR ${t.ownerId} IS NOT NULL`),
    check('subjects_code_official', sql`${t.code} IS NULL OR ${t.isOfficial}`),
    check(
      'subjects_position_official',
      sql`${t.position} IS NULL OR (${t.isOfficial} AND ${t.position} >= 1)`,
    ),
  ],
);

export const subjectTranslations = pgTable(
  'subject_translations',
  {
    subjectId: uuid('subject_id').references(() => subjects.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    description: text('description'),
  },
  (t) => [
    primaryKey({ columns: [t.subjectId, t.locale] }),
    check('subject_tr_title_len', sql`length(${t.title}) <= 150`),
    check('subject_tr_description_len', sql`length(${t.description}) <= 1000`),
  ],
);

export const classSubjectAccess = pgTable(
  'class_subject_access',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id),
    grantedAt: tstz('granted_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_csa_active')
      .on(t.classId, t.subjectId)
      .where(sql`revoked_at IS NULL`),
  ],
);

export const mediaFiles = pgTable('media_files', {
  id: id(),
  ownerId: uuid('owner_id').references(() => users.id),
  kind: mediaKindEnum('kind').notNull(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: bytea('sha256'),
  storageKey: text('storage_key').notNull().unique(),
  scanStatus: scanStatusEnum('scan_status').notNull().default('pending'),
  ...timestamps,
});

/**
 * Главы базового предмета (BR-CHAP-01…05, docs/CHEM_TZ.md 6.1): необязательный список в subject.yaml. Глава —
 * отдельная таблица (а не текст у темы): названия на трёх языках и порядок глав. У предметов учителя глав нет.
 */
export const subjectChapters = pgTable(
  'subject_chapters',
  {
    id: id(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    code: text('code').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('subject_chapters_subject_code').on(t.subjectId, t.code),
    check('subject_chapters_position', sql`${t.position} >= 1`),
  ],
);

export const subjectChapterTranslations = pgTable(
  'subject_chapter_translations',
  {
    chapterId: uuid('chapter_id').references(() => subjectChapters.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    /** Перевод подготовлен ИИ и ждёт вычитки человеком (BR-CNT-05). */
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.chapterId, t.locale] }),
    check('subject_chapter_tr_title_len', sql`length(${t.title}) <= 150`),
  ],
);

/**
 * UNIQUE (subject_id, position) DEFERRABLE INITIALLY DEFERRED и FK published_version_id
 * создаются в миграции 0002 (drizzle-kit не выражает DEFERRABLE).
 */
export const topics = pgTable(
  'topics',
  {
    id: id(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    position: integer('position').notNull(),
    status: topicStatusEnum('status').notNull().default('draft'),
    coverMediaId: uuid('cover_media_id').references(() => mediaFiles.id),
    coverUrl: text('cover_url'),
    publishedAt: tstz('published_at'),
    publishedVersionId: uuid('published_version_id').references((): AnyPgColumn => topicVersions.id),
    archivedAt: tstz('archived_at'),
    /** Постоянный код базовой темы (BR-CNT-04); у тем учителей — NULL. */
    code: text('code').unique(),
    /** Глава базового предмета (BR-CHAP-01); NULL — предмет без глав и все темы учителей. */
    chapterId: uuid('chapter_id').references((): AnyPgColumn => subjectChapters.id),
    /** Номер химического элемента урока (REQ-PTBL-04): ячейка таблицы Менделеева ведёт на урок. */
    elementNumber: smallint('element_number'),
    ...timestamps,
  },
  (t) => [
    index('ix_topics_subject').on(t.subjectId, t.position),
    check('topics_element_number', sql`${t.elementNumber} BETWEEN 1 AND 118`),
    uniqueIndex('ux_topics_subject_element')
      .on(t.subjectId, t.elementNumber)
      .where(sql`element_number IS NOT NULL`),
  ],
);

export const topicTranslations = pgTable(
  'topic_translations',
  {
    topicId: uuid('topic_id').references(() => topics.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    description: text('description'),
    funFact: text('fun_fact'),
    bodyMd: text('body_md'),
    summary: text('summary'),
    /** Перевод подготовлен ИИ и ждёт вычитки человеком (BR-CNT-05). */
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.locale] }),
    check('topic_tr_title_len', sql`length(${t.title}) <= 150`),
    check('topic_tr_description_len', sql`length(${t.description}) <= 1000`),
    check('topic_tr_fun_fact_len', sql`length(${t.funFact}) <= 500`),
    check('topic_tr_body_md_len', sql`length(${t.bodyMd}) <= 50000`),
  ],
);

export const topicSections = pgTable(
  'topic_sections',
  {
    id: id(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id),
    position: integer('position').notNull(),
    illustrationMediaId: uuid('illustration_media_id').references(() => mediaFiles.id),
    /** Постоянный код раздела базовой темы (BR-CNT-04). */
    code: text('code').unique(),
    ...timestamps,
  },
  (t) => [
    // OPT-05 (О4-6): разделы урока по теме (урок, редактор темы).
    index('ix_topic_sections_topic').on(t.topicId, t.position),
  ],
);

export const topicSectionTranslations = pgTable(
  'topic_section_translations',
  {
    sectionId: uuid('section_id').references(() => topicSections.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    body: text('body'),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.locale] })],
);

export const topicVersions = pgTable(
  'topic_versions',
  {
    id: id(),
    topicId: uuid('topic_id')
      .notNull()
      .references((): AnyPgColumn => topics.id),
    versionNo: integer('version_no').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changeNote: text('change_note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('topic_versions_topic_version_no').on(t.topicId, t.versionNo),
    check('topic_versions_change_note_len', sql`length(${t.changeNote}) <= 500`),
  ],
);

export const topicMaterials = pgTable(
  'topic_materials',
  {
    topicId: uuid('topic_id').references(() => topics.id),
    mediaId: uuid('media_id').references(() => mediaFiles.id),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.mediaId] })],
);

/**
 * Глоссарий базового предмета (REQ-GLOS-01…06, docs/CHEM_TZ.md 6.2): разделы с терминами из glossary.yaml
 * в папке предмета. Сопоставление при импорте — по кодам (раздел — в предмете, термин — в разделе).
 */
export const glossarySections = pgTable(
  'glossary_sections',
  {
    id: id(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id),
    code: text('code').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('glossary_sections_subject_code').on(t.subjectId, t.code),
    check('glossary_sections_position', sql`${t.position} >= 1`),
  ],
);

export const glossarySectionTranslations = pgTable(
  'glossary_section_translations',
  {
    sectionId: uuid('section_id').references(() => glossarySections.id),
    locale: localeEnum('locale'),
    title: text('title').notNull(),
    /** Перевод подготовлен ИИ и ждёт вычитки человеком (BR-CNT-05). */
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.sectionId, t.locale] }),
    check('glossary_section_tr_title_len', sql`length(${t.title}) <= 150`),
  ],
);

export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: id(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => glossarySections.id),
    code: text('code').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('glossary_terms_section_code').on(t.sectionId, t.code),
    index('ix_glossary_terms_section').on(t.sectionId, t.position),
  ],
);

export const glossaryTermTranslations = pgTable(
  'glossary_term_translations',
  {
    termId: uuid('term_id').references(() => glossaryTerms.id),
    locale: localeEnum('locale'),
    term: text('term').notNull(),
    definition: text('definition').notNull(),
    /** Перевод подготовлен ИИ и ждёт вычитки человеком (BR-CNT-05). */
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.termId, t.locale] }),
    check('glossary_term_tr_term_len', sql`length(${t.term}) <= 150`),
    check('glossary_term_tr_definition_len', sql`length(${t.definition}) <= 1000`),
  ],
);
