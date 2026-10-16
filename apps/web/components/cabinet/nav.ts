import { type UserRole } from '@syntara/shared';

export type CabinetIcon = 'courses' | 'classes' | 'assignments' | 'assistant' | 'progress' | 'achievements';

export interface CabinetNavItem {
  href: string;
  key: string;
  icon: CabinetIcon;
  /** Вложенные разделы, при которых пункт активен (предмет и тема — внутри «Мои курсы»). */
  also?: string[];
}

/**
 * Боковая панель кабинетов (REQ-GEN-SHELL-03): только маршруты раздела 4; страницы следующих итераций
 * открывают заглушку PH-24 «Раздел в разработке».
 */
export const CABINET_NAV: Partial<Record<UserRole, CabinetNavItem[]>> = {
  teacher: [
    {
      href: '/teacher/courses',
      key: 'courses',
      icon: 'courses',
      also: ['/teacher/subjects', '/teacher/topics'],
    },
    { href: '/teacher/classes', key: 'classes', icon: 'classes' },
    { href: '/teacher/assignments', key: 'assignments', icon: 'assignments' },
  ],
  student: [
    { href: '/learn/subjects', key: 'subjects', icon: 'courses' },
    { href: '/learn/assignments', key: 'myAssignments', icon: 'assignments' },
    { href: '/learn/assistant', key: 'assistant', icon: 'assistant' },
    { href: '/learn/progress', key: 'progress', icon: 'progress' },
    { href: '/learn/achievements', key: 'achievements', icon: 'achievements' },
  ],
};
