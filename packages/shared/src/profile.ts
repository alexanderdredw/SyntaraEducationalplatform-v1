import { z } from 'zod';

/**
 * Профиль пользователя (SPEC 5.11, 7.15, 8.7; docs/PROFILE_TZ.md).
 * Имя и фамилия — BR-PRF-01, аватар — BR-PRF-02/03, «Должность» и «О себе» — BR-PRF-04.
 */

/** BR-PRF-02: 8 цветов инициалов — токены `--avatar-{color}` в packages/ui. */
export const AVATAR_COLORS = ['blue', 'violet', 'teal', 'green', 'amber', 'orange', 'pink', 'slate'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** BR-PRF-02: 24 собственных аватара набора — животные, предметы, абстрактные персонажи (без людей и брендов). */
export const AVATAR_PRESETS = [
  'fox',
  'owl',
  'cat',
  'bear',
  'rabbit',
  'penguin',
  'whale',
  'turtle',
  'rocket',
  'book',
  'planet',
  'atom',
  'compass',
  'leaf',
  'bulb',
  'palette',
  'robot',
  'ghost',
  'blob',
  'star',
  'cube',
  'wave',
  'sun',
  'gem',
] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export const AvatarKind = z.enum(['initials', 'preset', 'photo']);
export type AvatarKind = z.infer<typeof AvatarKind>;

export const PROFILE_LIMITS = {
  nameMax: 40,
  positionMax: 80,
  aboutMax: 300,
  /** BR-PRF-01: изменений имени за окно. */
  nameChanges: 3,
  nameChangeWindowDays: 30,
  /** BR-PRF-03: картинка-аватар учителя. */
  photoMaxBytes: 2 * 1_048_576,
  photoUploads: 5,
  photoUploadWindowHours: 24,
  /** Размеры перекодированной картинки (WEBP, без метаданных). */
  photoSizes: [256, 64] as const,
} as const;

export const AVATAR_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const isAvatarPhotoMime = (mime: string): mime is (typeof AVATAR_PHOTO_MIME)[number] =>
  (AVATAR_PHOTO_MIME as readonly string[]).includes(mime);

/** Ключ объекта уменьшенной копии (64 px) рядом с основной (256 px). */
export const avatarSmallKey = (storageKey: string) => `${storageKey}-64`;

/** BR-PRF-01: буквы любых алфавитов (кириллица, латиница, казахские), пробел, дефис, апостроф. */
const NAME_RE = /^\p{L}[\p{L}\p{M} '’-]*$/u;
const personName = z
  .string()
  .trim()
  .max(PROFILE_LIMITS.nameMax, 'tooLong')
  .refine((s) => s === '' || NAME_RE.test(s), 'nameChars');

/** «О себе» без ссылок (BR-PRF-04). */
const LINK_RE = /(https?:\/\/|www\.|\b[\p{L}\d-]+\.(kz|ru|com|org|net|io|me|info|рф|қаз)\b)/iu;
export const hasLink = (s: string) => LINK_RE.test(s);

/** API-ME-07 */
export const ProfilePatchDto = z
  .object({
    firstName: personName.refine((s) => s.length >= 1, 'required').optional(),
    lastName: personName.optional(),
    position: z.string().trim().max(PROFILE_LIMITS.positionMax, 'tooLong').optional(),
    about: z
      .string()
      .trim()
      .max(PROFILE_LIMITS.aboutMax, 'tooLong')
      .refine((s) => !hasLink(s), 'noLinks')
      .optional(),
  })
  .strict();
export type ProfilePatchDto = z.infer<typeof ProfilePatchDto>;

/** API-ME-09 */
export const AvatarPutDto = z
  .object({
    kind: AvatarKind,
    preset: z.enum(AVATAR_PRESETS, 'invalidPreset').optional(),
    mediaId: z.uuid('invalidFile').optional(),
    color: z.enum(AVATAR_COLORS, 'invalidColor').optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'preset' && !d.preset)
      ctx.addIssue({ code: 'custom', path: ['preset'], message: 'required' });
    if (d.kind === 'photo' && !d.mediaId)
      ctx.addIssue({ code: 'custom', path: ['mediaId'], message: 'required' });
  });
export type AvatarPutDto = z.infer<typeof AvatarPutDto>;

/** API-ME-08 */
export const AvatarUploadUrlDto = z.object({
  fileName: z.string().trim().min(1, 'required').max(255, 'tooLong'),
  mime: z.string().trim().max(100),
  size: z.number().int().positive(),
});
export type AvatarUploadUrlDto = z.infer<typeof AvatarUploadUrlDto>;

/** Имя и фамилия из display_name: до первого пробела / остаток (миграция 0010, SPEC 5.11). */
export function splitDisplayName(displayName: string): { firstName: string; lastName: string | null } {
  const trimmed = displayName.trim().replace(/\s+/g, ' ');
  const space = trimmed.indexOf(' ');
  if (space < 0) return { firstName: trimmed, lastName: null };
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) || null };
}

/** users.display_name из профиля (BR-PRF-01): «Имя Фамилия», без фамилии — только имя. */
export function joinDisplayName(firstName: string, lastName: string | null | undefined): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

/** Инициалы аватара: первые буквы первых двух слов имени. */
export function initialsOf(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/** Цвет инициалов нового пользователя — случайный (BR-PRF-02). */
export function randomAvatarColor(random: () => number = Math.random): AvatarColor {
  return AVATAR_COLORS[Math.floor(random() * AVATAR_COLORS.length)]!;
}

/** Аватар в ответах API (6.7): картинка — только чистая и только подписанной ссылкой, иначе инициалы. */
export interface AvatarView {
  kind: AvatarKind;
  preset: AvatarPreset | null;
  color: AvatarColor;
  initials: string;
  photoUrl: string | null;
  photoUrlSmall: string | null;
}

/** API-ME-10 (BR-PRF-07): новый email и текущий пароль. */
export const EmailChangeDto = z.object({
  email: z.string().trim().toLowerCase().email('email').max(254, 'tooLong'),
  currentPassword: z.string().min(1, 'required').max(200, 'tooLong'),
});
export type EmailChangeDto = z.infer<typeof EmailChangeDto>;

/** API-ME-10 DELETE: удалить email (только ученик с логином) — текущий пароль. */
export const EmailRemoveDto = z.object({
  currentPassword: z.string().min(1, 'required').max(200, 'tooLong'),
});
export type EmailRemoveDto = z.infer<typeof EmailRemoveDto>;

/** BR-PRF-07/08: попыток смены email или пароля — 5 за 15 минут на пользователя. */
export const ACCOUNT_LIMITS = { attempts: 5, windowMs: 15 * 60_000 } as const;

/**
 * REQ-PRF-31 (BR-PRF-08): надёжность пароля без библиотек — 4 уровня: 1 слабый, 2 средний, 3 хороший, 4 надёжный;
 * 0 — пароль не введён. Учитываются длина и классы символов; короче минимума или содержит логин, email или имя
 * (части от 3 символов) — слабый.
 */
export function passwordStrength(
  password: string,
  personal: ReadonlyArray<string | null | undefined> = [],
  minLength = 8,
): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  const lower = password.toLocaleLowerCase();
  const parts = personal
    .flatMap((p) => (p ?? '').toLocaleLowerCase().split(/[\s@._-]+/))
    .filter((part) => part.length >= 3);
  if (password.length < minLength || parts.some((part) => lower.includes(part))) return 1;
  const kinds = [/[a-zа-яәғқңөұүһі]/u, /[A-ZА-ЯӘҒҚҢӨҰҮҺІ]/u, /\d/, /[^\p{L}\d]/u].filter((re) =>
    re.test(password),
  ).length;
  const score = kinds + (password.length >= 12 ? 1 : 0) + (password.length >= 16 ? 1 : 0);
  return score >= 5 ? 4 : score >= 4 ? 3 : score >= 2 ? 2 : 1;
}

/**
 * REQ-PRF-32: устройство сессии в понятном виде («Chrome · Windows», «Safari · iPhone») — разбор User-Agent без
 * библиотек. Неизвестное — null (интерфейс пишет «Неизвестное устройство»).
 */
export function parseUserAgent(ua: string | null | undefined): { browser: string | null; os: string | null } {
  const s = ua ?? '';
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /YaBrowser\//.test(s)
        ? 'Yandex'
        : /SamsungBrowser\//.test(s)
          ? 'Samsung Internet'
          : /Firefox\/|FxiOS\//.test(s)
            ? 'Firefox'
            : /Chrome\/|CriOS\//.test(s)
              ? 'Chrome'
              : /Safari\//.test(s)
                ? 'Safari'
                : null;
  const os = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? 'Android'
        : /Windows/.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(s)
            ? 'macOS'
            : /CrOS/.test(s)
              ? 'ChromeOS'
              : /Linux/.test(s)
                ? 'Linux'
                : null;
  return { browser, os };
}

/** API-ME-15 (REQ-PRF-21): недель в календаре активности. */
export const ActivityQuery = z.object({ weeks: z.coerce.number().int().min(1).max(26).default(12) });
export type ActivityQuery = z.infer<typeof ActivityQuery>;
