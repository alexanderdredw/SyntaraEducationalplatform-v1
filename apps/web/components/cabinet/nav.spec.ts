import { describe, expect, it } from 'vitest';
import ru from '@syntara/shared/i18n/ru.json';
import { ROLE_HOME, workspaceRole } from '../../lib/auth';
import { badgeCount } from '@syntara/shared';
import { activeNavHref, CABINET_NAV, isNavActive, navItems, type RoleNav } from './nav';

const nav = (role: 'student' | 'teacher') => CABINET_NAV[role] as RoleNav;
const label = (key: string) => (ru.cabinet.nav as Record<string, string>)[key];
const shape = (n: RoleNav) => ({
  home: label(n.home.key),
  groups: n.groups.map((g) => [
    ru.cabinet.navGroups[g.key],
    ...g.items.map((i) => `${label(i.key)} ${i.href}`),
  ]),
  help: `${label(n.help.key)} ${n.help.href}`,
});

describe('панель навигации (docs/NAV_TZ.md, docs/NAV_TZ_2.md)', () => {
  it('REQ-NAV-10, AC-NAV-10 student: «Учёба», «Мой прогресс», «Платформа» in order', () => {
    expect(shape(nav('student'))).toEqual({
      home: 'Главная',
      groups: [
        [
          'Учёба',
          'Каталог /learn/subjects',
          'Мой класс /learn/class',
          'Мои задания /learn/assignments',
          'Syntara AI /learn/assistant',
          'Battle /learn/battles',
        ],
        ['Мой прогресс', 'Показатели /learn/progress', 'Достижения /learn/achievements'],
        ['Платформа', 'О проекте /about', 'Школам /schools'],
      ],
      help: 'Помощь /support',
    });
    const items = navItems(nav('student'));
    expect(items.find((i) => i.key === 'myClass')?.icon).toBe('classes');
    expect(items.find((i) => i.key === 'studentCatalog')?.icon).toBe('subjects');
    expect(items.filter((i) => i.badge).map((i) => [i.key, i.badge])).toEqual([
      ['myClass', 'class'],
      ['myAssignments', 'assignments'],
      ['achievements', 'achievements'],
    ]);
  });

  it('REQ-NAV-13, AC-NAV-14/15 exactly one active item; a teacher subject → «Мой класс», a base one → «Каталог»', () => {
    const s = nav('student');
    expect(activeNavHref(s, '/')).toBe('/');
    expect(activeNavHref(s, '/learn/subjects')).toBe('/learn/subjects');
    expect(activeNavHref(s, '/learn/sections/1')).toBe('/learn/subjects');
    expect(activeNavHref(s, '/learn/topics/1')).toBe('/learn/subjects');
    expect(activeNavHref(s, '/learn/topics/1', true)).toBe('/learn/class');
    expect(activeNavHref(s, '/learn/subjects/1', true)).toBe('/learn/class');
    expect(activeNavHref(s, '/learn/class')).toBe('/learn/class');
    expect(activeNavHref(s, '/learn/battles/s1/results')).toBe('/learn/battles');
    expect(activeNavHref(s, '/account/privacy')).toBeNull();
    // У учителя «Мой класс» нет — флаг не действует.
    expect(activeNavHref(nav('teacher'), '/learn/topics/1', true)).toBe('/subjects');
  });

  it('REQ-NAV-14 counter: 0 — nothing, 1–9 — the number, more — «9+»', () => {
    expect([0, 1, 9, 10, 42].map(badgeCount)).toEqual([null, '1', '9', '9+', '9+']);
  });

  it('REQ-NAV-02 teacher: groups and items in order', () => {
    expect(shape(nav('teacher'))).toEqual({
      home: 'Главная',
      groups: [
        [
          'Мой кабинет',
          'Мои курсы /teacher/courses',
          'Классы /teacher/classes',
          'Задания /teacher/assignments',
          'Battle /teacher/battles',
        ],
        [
          'Платформа',
          'Предметы платформы /subjects',
          'Syntara AI /ai',
          'О проекте /about',
          'Школам /schools',
        ],
      ],
      help: 'Помощь /support',
    });
  });

  it('AC-NAV-02, REQ-NAV-03 no repeated items or icons within a role', () => {
    for (const role of ['student', 'teacher'] as const) {
      const items = navItems(nav(role));
      expect(new Set(items.map((i) => i.href)).size, role).toBe(items.length);
      expect(new Set(items.map((i) => i.icon)).size, role).toBe(items.length);
      expect(new Set(items.map((i) => label(i.key))).size, role).toBe(items.length);
    }
  });

  it('REQ-NAV-03 parent item is active inside its section; «Главная» only on /', () => {
    const find = (role: 'student' | 'teacher', href: string) =>
      navItems(nav(role)).find((i) => i.href === href)!;
    expect(isNavActive('/learn/topics/1', find('student', '/learn/subjects'))).toBe(true);
    expect(isNavActive('/learn/class', find('student', '/learn/class'))).toBe(true);
    expect(isNavActive('/learn/sections/1', find('student', '/learn/subjects'))).toBe(true);
    expect(isNavActive('/learn/battles/s1/results', find('student', '/learn/battles'))).toBe(true);
    expect(isNavActive('/teacher/battle-sessions/s1', find('teacher', '/teacher/battles'))).toBe(true);
    expect(isNavActive('/learn/topics/1', find('teacher', '/subjects'))).toBe(true);
    expect(isNavActive('/schools/request', find('teacher', '/schools'))).toBe(true);
    expect(isNavActive('/about', find('student', '/'))).toBe(false);
    expect(isNavActive('/', find('student', '/'))).toBe(true);
  });

  it('REQ-NAV-06 logo leads to the role home; REQ-NAV-04 workspace only for student and teacher', () => {
    expect(ROLE_HOME.student).toBe('/');
    expect(ROLE_HOME.teacher).toBe('/teacher/courses');
    expect(workspaceRole(null)).toBeNull();
    expect(workspaceRole({ activeRole: 'student' })).toBe('student');
    expect(workspaceRole({ activeRole: 'teacher' })).toBe('teacher');
    expect(workspaceRole({ activeRole: 'support_agent' })).toBeNull();
    expect(workspaceRole({ activeRole: 'student', mustChangePassword: true })).toBeNull();
  });
});
