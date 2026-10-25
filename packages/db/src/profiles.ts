import { AVATAR_COLORS, type AvatarColor, randomAvatarColor, splitDisplayName } from '@syntara/shared';
import { type userProfiles } from './schema/profiles';

/**
 * Строка профиля нового пользователя (5.11): имя и фамилия из display_name, аватар — инициалы (BR-PRF-02).
 * Цвет — случайный; для seed — постоянный по id (стабильные визуальные тесты).
 */
export function profileFor(
  userId: string,
  displayName: string,
  color: AvatarColor = randomAvatarColor(),
): typeof userProfiles.$inferInsert {
  const { firstName, lastName } = splitDisplayName(displayName);
  return {
    userId,
    firstName: firstName.slice(0, 40),
    lastName: lastName?.slice(0, 40) ?? null,
    avatarKind: 'initials',
    avatarColor: color,
  };
}

/** Постоянный цвет по id — seed и пользователи без строки профиля. */
export function stableAvatarColor(id: string): AvatarColor {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
