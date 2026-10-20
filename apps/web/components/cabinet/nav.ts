import { type UserRole } from '@syntara/shared';

export type CabinetIcon =
  'courses' | 'classes' | 'assignments' | 'assistant' | 'progress' | 'achievements' | 'battle';

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
    // Итерация 10.5: Battle (REQ-BTL-T01); игра ведущего — внутри раздела.
    { href: '/teacher/battles', key: 'battle', icon: 'battle', also: ['/teacher/battle-sessions'] },
  ],
  student: [
    { href: '/learn/subjects', key: 'subjects', icon: 'courses', also: ['/learn/sections', '/learn/topics'] },
    { href: '/learn/assignments', key: 'myAssignments', icon: 'assignments' },
    { href: '/learn/assistant', key: 'assistant', icon: 'assistant' },
    { href: '/learn/progress', key: 'progress', icon: 'progress' },
    { href: '/learn/achievements', key: 'achievements', icon: 'achievements' },
    // Итерация 10.5: Battle (REQ-BTL-S01).
    { href: '/learn/battles', key: 'battle', icon: 'battle' },
  ],
};
