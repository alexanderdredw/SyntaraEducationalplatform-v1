import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, citext, id, timestamps, tstz } from './_common';
import { localeEnum, membershipStatusEnum, userRoleEnum } from './enums';

/** 5.3 Пользователи, доступ, классы. */

export const schools = pgTable(
  'schools',
  {
    id: id(),
    name: text('name').notNull(),
    region: text('region'),
    city: text('city'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [check('schools_name_len', sql`length(${t.name}) <= 200`)],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: citext('email').unique(),
    displayName: text('display_name').notNull(),
    /** PH-44: логин ученика, зарегистрированного по коду класса. */
    login: citext('login').unique(),
    passwordHash: text('password_hash'),
    isChildSafe: boolean('is_child_safe').notNull().default(false),
    status: text('status').notNull().default('active'),
    lastLoginAt: tstz('last_login_at'),
    ...timestamps,
  },
  (t) => [check('users_email_or_child_safe', sql`${t.email} IS NOT NULL OR ${t.isChildSafe}`)],
);

/** Решение владельца по Q-15: суррогатный id + UNIQUE NULLS NOT DISTINCT (user_id, role, school_id). */
export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: userRoleEnum('role').notNull(),
    schoolId: uuid('school_id').references(() => schools.id),
    ...timestamps,
  },
  (t) => [unique('ux_user_roles').on(t.userId, t.role, t.schoolId).nullsNotDistinct()],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  locale: localeEnum('locale').notNull().default('ru'),
  theme: text('theme').notNull().default('system'),
  dataSaver: boolean('data_saver').notNull().default(false),
  ...timestamps,
});

export const authSessions = pgTable('auth_sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: bytea('token_hash').notNull().unique(),
  expiresAt: tstz('expires_at').notNull(),
  revokedAt: tstz('revoked_at'),
  userAgent: text('user_agent'),
  ...timestamps,
});

export const consents = pgTable('consents', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  consentType: text('consent_type').notNull(),
  granted: boolean('granted').notNull(),
  grantedBy: uuid('granted_by').references(() => users.id),
  grantedAt: tstz('granted_at').notNull(),
  revokedAt: tstz('revoked_at'),
  ...timestamps,
});

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    status: text('status').notNull().default('new'),
    completedAt: tstz('completed_at'),
    ...timestamps,
  },
  (t) => [check('dsr_type', sql`${t.type} IN ('export','rectify','delete','revoke_consent')`)],
);

export const classes = pgTable(
  'classes',
  {
    id: id(),
    schoolId: uuid('school_id').references(() => schools.id),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    archivedAt: tstz('archived_at'),
    ...timestamps,
  },
  (t) => [check('classes_name_len', sql`length(${t.name}) <= 50`)],
);

export const classMemberships = pgTable(
  'class_memberships',
  {
    id: id(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id),
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id),
    status: membershipStatusEnum('status').notNull().default('active'),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
    leftAt: tstz('left_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_membership_active')
      .on(t.classId, t.studentId)
      .where(sql`status = 'active'`),
    index('ix_membership_student')
      .on(t.studentId)
      .where(sql`status = 'active'`),
  ],
);

export const classInviteCodes = pgTable('class_invite_codes', {
  id: id(),
  classId: uuid('class_id')
    .notNull()
    .references(() => classes.id),
  codeHash: bytea('code_hash').notNull().unique(),
  expiresAt: tstz('expires_at').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  ...timestamps,
});
