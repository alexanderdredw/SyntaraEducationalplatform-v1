'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { type UserRole } from '@syntara/shared';
import { usePathname } from '@/i18n/navigation';
import { apiRequest } from '@/lib/api/browser';
import type { components } from '@/lib/api/schema';
import { usePreferences } from '../preferences/preferences-provider';
import { activeNavHref, type RoleNav } from './nav';

export type ClassOverview = components['schemas']['ClassOverviewDto'];
export type NavBadges = components['schemas']['NavBadgesDto'];

/** API-S-19: «Мой класс» — страница раздела, панель (активный пункт) и плашка на каталоге. */
export const CLASS_OVERVIEW_KEY = ['student', 'class-overview'];
/**
 * API-S-20. Ключ — под ['me', 'stats']: после урока и квиза его обновляют вместе с серией и XP (REQ-NAV-14, п. 3).
 */
export const NAV_BADGES_KEY = ['me', 'stats', 'nav-badges'];
/** REQ-NAV-14, п. 3: раз в 60 с, пока вкладка активна; в «Экономии трафика» — только при переходах. */
const BADGES_POLL_MS = 60_000;

export function useClassOverview(enabled = true) {
  const locale = useLocale();
  return useQuery({
    queryKey: [...CLASS_OVERVIEW_KEY, locale],
    enabled,
    queryFn: async () => {
      const res = await apiRequest<ClassOverview>('/api/student/class/overview', { locale });
      if (res.kind !== 'ok') throw new Error('class overview');
      return res.data;
    },
  });
}

function useNavBadges(enabled: boolean) {
  const { dataSaver } = usePreferences();
  const pathname = usePathname();
  const query = useQuery({
    queryKey: NAV_BADGES_KEY,
    enabled,
    refetchInterval: dataSaver ? false : BADGES_POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await apiRequest<NavBadges>('/api/student/nav-badges');
      if (res.kind !== 'ok') throw new Error('nav badges');
      return res.data;
    },
  });
  const { refetch } = query;
  // При каждом переходе между страницами; первая загрузка — сам запрос, без повторного.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (!enabled || lastPath.current === pathname) return;
    lastPath.current = pathname;
    void refetch();
  }, [enabled, pathname, refetch]);
  return query.data ?? null;
}

// Предмет, который сейчас открыт (страница предмета или урок): по нему «Мой класс» становится активным для
// предметов учителя (REQ-NAV-13). Страница сообщает предмет, но не добавляет пунктов (REQ-NAV-01).
let currentSubject: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const setCurrentSubject = (id: string | null) => {
  currentSubject = id;
  listeners.forEach((l) => l());
};

/** Урок или страница предмета сообщают свой предмет на время показа. */
export function useReportSubject(subjectId: string | null | undefined) {
  useEffect(() => {
    if (!subjectId) return;
    setCurrentSubject(subjectId);
    return () => setCurrentSubject(null);
  }, [subjectId]);
}

/** Предмет учителя, выданный классу ученика (по API-S-19) — тогда крошки и панель ведут в «Мой класс». */
export function useIsClassSubject(subjectId: string | null | undefined, enabled = true): boolean {
  const overview = useClassOverview(enabled && Boolean(subjectId));
  return Boolean(subjectId && overview.data?.subjects.some((s) => s.id === subjectId));
}

/** Активный пункт (ровно один, REQ-NAV-13) и счётчики (REQ-NAV-14) для панели и меню на телефоне. */
export function useNavState(nav: RoleNav, role: UserRole) {
  const pathname = usePathname();
  const student = role === 'student';
  const subject = useSyncExternalStore(
    subscribe,
    () => currentSubject,
    () => null,
  );
  const inClassSubject = useIsClassSubject(
    pathname.startsWith('/learn/subjects/') || pathname.startsWith('/learn/topics/') ? subject : null,
    student,
  );
  return {
    activeHref: activeNavHref(nav, pathname, inClassSubject),
    badges: useNavBadges(student),
  };
}
