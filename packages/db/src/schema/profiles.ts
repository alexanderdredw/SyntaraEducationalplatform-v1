import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_common';
import { mediaFiles } from './content';
import { users } from './users';

/**
 * 5.11 (docs/PROFILE_TZ.md): профиль пользователя — имя и фамилия, «Должность» и «О себе» учителя, аватар.
 * users.display_name остаётся и обновляется вместе с профилем (BR-PRF-01). RLS — миграция 0010.
 */
export const userProfiles = pgTable(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    /** BR-PRF-04: только учитель. */
    about: text('about'),
    position: text('position'),
    avatarKind: text('avatar_kind').notNull().default('initials'),
    /** BR-PRF-02: код аватара набора. */
    avatarPreset: text('avatar_preset'),
    /** BR-PRF-03: картинка учителя (media_files.kind = 'avatar'). */
    avatarMediaId: uuid('avatar_media_id').references(() => mediaFiles.id),
    /** BR-PRF-02: токен цвета инициалов. */
    avatarColor: text('avatar_color').notNull(),
    ...timestamps,
  },
  (t) => [
    check('user_profiles_first_name_len', sql`length(${t.firstName}) BETWEEN 1 AND 40`),
    check('user_profiles_last_name_len', sql`${t.lastName} IS NULL OR length(${t.lastName}) <= 40`),
    check('user_profiles_about_len', sql`${t.about} IS NULL OR length(${t.about}) <= 300`),
    check('user_profiles_position_len', sql`${t.position} IS NULL OR length(${t.position}) <= 80`),
    check('user_profiles_avatar_kind', sql`${t.avatarKind} IN ('initials','preset','photo')`),
    check('user_profiles_preset_set', sql`${t.avatarKind} <> 'preset' OR ${t.avatarPreset} IS NOT NULL`),
    check('user_profiles_photo_set', sql`${t.avatarKind} <> 'photo' OR ${t.avatarMediaId} IS NOT NULL`),
  ],
);
