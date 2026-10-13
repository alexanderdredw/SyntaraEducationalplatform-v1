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
    ...timestamps,
  },
  (t) => [check('subjects_official_or_owner', sql`${t.isOfficial} OR ${t.ownerId} IS NOT NULL`)],
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
    ...timestamps,
  },
  (t) => [index('ix_topics_subject').on(t.subjectId, t.position)],
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
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.locale] }),
    check('topic_tr_title_len', sql`length(${t.title}) <= 150`),
    check('topic_tr_description_len', sql`length(${t.description}) <= 1000`),
    check('topic_tr_fun_fact_len', sql`length(${t.funFact}) <= 500`),
    check('topic_tr_body_md_len', sql`length(${t.bodyMd}) <= 50000`),
  ],
);

export const topicSections = pgTable('topic_sections', {
  id: id(),
  topicId: uuid('topic_id')
    .notNull()
    .references(() => topics.id),
  position: integer('position').notNull(),
  illustrationMediaId: uuid('illustration_media_id').references(() => mediaFiles.id),
  ...timestamps,
});

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
