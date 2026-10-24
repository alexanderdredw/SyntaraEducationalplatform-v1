import { type UserRole } from '@syntara/shared';

export type NavIcon =
  | 'home'
  | 'subjects'
  | 'courses'
  | 'classes'
  | 'assignments'
  | 'assistant'
  | 'battle'
  | 'progress'
  | 'achievements'
  | 'catalog'
  | 'about'
  | 'schools'
  | 'help';

export interface NavItem {
  href: string;
  /** Ключ подписи в `cabinet.nav`. */
  key: string;
  icon: NavIcon;
  /** Вложенные разделы, при которых пункт активен (тема — внутри «Предметы», сессия Battle — внутри «Battle»). */
  also?: string[];
}

export type NavGroupKey = 'cabinet' | 'platform';

export interface RoleNav {
  /** «Главная» — над группами. */
  home: NavItem;
  /** Группы с подписями `cabinet.navGroups.*`, разделённые линией. */
  groups: { key: NavGroupKey; items: NavItem[] }[];
  /** «Помощь» — внизу панели. */
  help: NavItem;
}

const HOME: NavItem = { href: '/', key: 'home', icon: 'home' };
const HELP: NavItem = { href: '/support', key: 'help', icon: 'help' };
const ABOUT: NavItem = { href: '/about', key: 'about', icon: 'about' };
const SCHOOLS: NavItem = { href: '/schools', key: 'schools', icon: 'schools' };

/**
 * Единственный источник пунктов панели навигации (REQ-NAV-01, REQ-NAV-02): панель рендерится один раз в оболочке
 * кабинета, страницы своих пунктов не добавляют. Иконки в пределах роли не повторяются (REQ-NAV-03, п. 4).
 * Служебные роли — без панели (вне объёма NAV_TZ).
 */
export const CABINET_NAV: Partial<Record<UserRole, RoleNav>> = {
  student: {
    home: HOME,
    groups: [
      {
        key: 'cabinet',
        items: [
          {
            href: '/learn/subjects',
            key: 'subjects',
            icon: 'subjects',
            also: ['/learn/sections', '/learn/topics'],
          },
          { href: '/learn/assignments', key: 'myAssignments', icon: 'assignments' },
          { href: '/learn/assistant', key: 'assistant', icon: 'assistant' },
          { href: '/learn/battles', key: 'battle', icon: 'battle' },
          { href: '/learn/progress', key: 'progress', icon: 'progress' },
          { href: '/learn/achievements', key: 'achievements', icon: 'achievements' },
        ],
      },
      { key: 'platform', items: [ABOUT, SCHOOLS] },
    ],
    help: HELP,
  },
  teacher: {
    home: HOME,
    groups: [
      {
        key: 'cabinet',
        items: [
          {
            href: '/teacher/courses',
            key: 'courses',
            icon: 'courses',
            also: ['/teacher/subjects', '/teacher/topics'],
          },
          { href: '/teacher/classes', key: 'classes', icon: 'classes' },
          { href: '/teacher/assignments', key: 'assignments', icon: 'assignments' },
          { href: '/teacher/battles', key: 'battle', icon: 'battle', also: ['/teacher/battle-sessions'] },
        ],
      },
      {
        key: 'platform',
        items: [
          // Базовые уроки (/learn/...) учитель открывает из «Предметов платформы».
          { href: '/subjects', key: 'catalog', icon: 'catalog', also: ['/learn'] },
          { href: '/ai', key: 'ai', icon: 'assistant' },
          ABOUT,
          SCHOOLS,
        ],
      },
    ],
    help: HELP,
  },
};

/** Все пункты роли в порядке панели: «Главная», группы, «Помощь». */
export function navItems(nav: RoleNav): NavItem[] {
  return [nav.home, ...nav.groups.flatMap((g) => g.items), nav.help];
}

/** Активный пункт (REQ-NAV-03, п. 5): «Главная» — точное совпадение, остальные — раздел и вложенные страницы. */
export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.href === '/') return pathname === '/';
  return [item.href, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
