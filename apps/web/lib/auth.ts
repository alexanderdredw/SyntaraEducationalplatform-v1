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

/**
 * BR-VIS-04: страницы `/learn/...`, которые гость открывает без входа — каталог, раздел, предмет и урок базовой
 * программы («Обзор»). Остальные страницы ученика — только после входа.
 */
export function isGuestLearnPath(path: string): boolean {
  const pathname = path.split('?')[0]!;
  return (
    pathname === '/learn/subjects' ||
    ['/learn/sections/', '/learn/subjects/', '/learn/topics/'].some((p) => pathname.startsWith(p))
  );
}

/**
 * REQ-NAV-06, REQ-NAV-04 п. 4: главная роли — куда ведёт логотип и куда переадресуются страницы входа у вошедшего.
 * У ученика — `/` (главная с «Продолжить учёбу», REQ-ST-HOME-01), у учителя — «Мои курсы».
 */
export const ROLE_HOME: Record<UserRole, string> = {
  student: '/',
  teacher: '/teacher/courses',
  support_agent: '/staff/tickets',
  onboarding_agent: '/staff/requests',
};

/** Кабинеты с панели навигации (REQ-NAV-02); служебные роли — без изменений (публичная оболочка). */
export type WorkspaceRole = 'student' | 'teacher';

/**
 * REQ-NAV-04: в какой рабочей среде вошедший видит публичные страницы. Ученик и учитель — в оболочке своего
 * кабинета; без входа, со служебной ролью или до обязательной смены временного пароля (BR-CLS-05) — в публичной.
 */
export function workspaceRole(
  me: { activeRole: string; mustChangePassword?: boolean } | null | undefined,
): WorkspaceRole | null {
  if (!me || me.mustChangePassword) return null;
  return me.activeRole === 'student' || me.activeRole === 'teacher' ? me.activeRole : null;
}
