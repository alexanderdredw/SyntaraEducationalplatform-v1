/**
 * Ключи запросов TanStack Query, общие для браузера и предзагрузки на сервере (OPT-05, О4-2): данные,
 * полученные сервером под этим ключом, браузер берёт из HTML и не запрашивает повторно.
 * Модуль без 'use client' — его константы доступны и серверным компонентам.
 */
export const lessonQueryKey = (topicId: string, guest: boolean, locale: string) =>
  ['student', 'lesson', topicId, guest, locale] as const;

/** API-S-19: «Мой класс» — страница раздела, панель (активный пункт) и плашка на каталоге. */
export const CLASS_OVERVIEW_KEY = ['student', 'class-overview'];
/**
 * API-S-20. Ключ — под ['me', 'stats']: после урока и квиза его обновляют вместе с серией и XP (REQ-NAV-14, п. 3).
 */
export const NAV_BADGES_KEY = ['me', 'stats', 'nav-badges'];

/** Каталог базовых предметов (API-PUB-10): и у гостя, и у ученика — публичный запрос (REQ-NAV-12). */
export const catalogQueryKey = (locale: string) => ['student', 'catalog', true, locale] as const;
/** «Мои показатели» (API-S-*): период по умолчанию — 30 дней. */
export const progressQueryKey = (period: string, locale: string) =>
  ['student', 'progress', period, locale] as const;
export const achievementsQueryKey = (locale: string) => ['student', 'achievements', locale] as const;

export const PROFILE_KEY = ['me', 'profile'];
export const DASHBOARD_KEY = ['me', 'dashboard'];
export const ACTIVITY_KEY = ['me', 'activity'];

export const teacherTopicQueryKey = (id: string) => ['teacher', 'topic', id] as const;
export const TEACHER_CLASSES_KEY = ['teacher', 'classes'];
export const analyticsQueryKey = (classId: string, locale: string) =>
  ['teacher', 'analytics', classId, locale] as const;
/** «Карта освоения» (API-T-29): `subjectId` = null — предмет по умолчанию (выбирает api). */
export const masteryQueryKey = (classId: string, subjectId: string | null, locale: string) =>
  ['teacher', 'mastery', classId, subjectId, locale] as const;
