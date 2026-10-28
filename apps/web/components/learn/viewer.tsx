'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * Кто смотрит страницы обучения: ученик или гость (BR-VIS-04). Гость читает базовые уроки через публичные
 * операции API-PUB-10..13; ученик — через API-S-*. Права проверяет api (AG-04).
 * `cabinetHref` — «гостевой» просмотр вошедшего без роли ученика (учитель, REQ-NAV-04): вместо приглашения
 * войти — «Перейти в кабинет →» (REQ-NAV-05). `teacher` — вошедший учитель: тесты тем он проходит в режиме
 * предпросмотра (API-T-34, решение владельца 2026-10-28).
 */
const ViewerContext = createContext<{ guest: boolean; cabinetHref?: string; teacher?: boolean }>({
  guest: false,
});

export function LearnViewerProvider({
  guest,
  cabinetHref,
  teacher = false,
  children,
}: {
  guest: boolean;
  cabinetHref?: string;
  teacher?: boolean;
  children: ReactNode;
}) {
  return <ViewerContext.Provider value={{ guest, cabinetHref, teacher }}>{children}</ViewerContext.Provider>;
}

export function useLearnViewer(): {
  guest: boolean;
  cabinetHref?: string;
  teacher: boolean;
  api: '/api/public' | '/api/student';
} {
  const { guest, cabinetHref, teacher = false } = useContext(ViewerContext);
  return { guest, cabinetHref, teacher, api: guest ? '/api/public' : '/api/student' };
}
