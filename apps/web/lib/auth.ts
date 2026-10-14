import { LOCALES, type UserRole } from '@syntara/shared';

/**
 * Разрешённые цели `returnTo` (раздел 4): только относительный внутренний путь из белого списка префиксов,
 * иначе `/`. Префикс локали в returnTo не пишется — его добавляет навигация.
 */
const RETURN_TO_PREFIXES = ['/staff/', '/teacher/', '/learn/', '/join', '/account/'];

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  let path = value;
  const first = path.split('/')[1];
  if (first && (LOCALES as readonly string[]).includes(first)) path = path.slice(first.length + 1) || '/';
  try {
    // Защита от обходов вида /staff/../.. и закодированных символов.
    const url = new URL(path, 'http://internal.invalid');
    if (url.origin !== 'http://internal.invalid') return '/';
    path = url.pathname + url.search;
  } catch {
    return '/';
  }
  return RETURN_TO_PREFIXES.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p)) ? path : '/';
}

/** REQ-GEN-AUTH-01: после входа — по роли; служебные роли — в свою очередь (раздел 4, 8.5). */
export const HOME_BY_ROLE: Record<UserRole, string> = {
  teacher: '/teacher/courses',
  student: '/learn/subjects',
  support_agent: '/staff/tickets',
  onboarding_agent: '/staff/requests',
};

export const STAFF_ROLES: readonly UserRole[] = ['support_agent', 'onboarding_agent'];
