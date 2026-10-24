'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * Кто смотрит страницы обучения: ученик или гость (BR-VIS-04). Гость читает базовые уроки через публичные
 * операции API-PUB-10..13; ученик — через API-S-*. Права проверяет api (AG-04).
 * `cabinetHref` — «гостевой» просмотр вошедшего без роли ученика (учитель, REQ-NAV-04): вместо приглашения
 * войти — «Перейти в кабинет →» (REQ-NAV-05).
 */
const ViewerContext = createContext<{ guest: boolean; cabinetHref?: string }>({ guest: false });

export function LearnViewerProvider({
  guest,
  cabinetHref,
  children,
}: {
  guest: boolean;
  cabinetHref?: string;
  children: ReactNode;
}) {
  return <ViewerContext.Provider value={{ guest, cabinetHref }}>{children}</ViewerContext.Provider>;
}

export function useLearnViewer(): {
  guest: boolean;
  cabinetHref?: string;
  api: '/api/public' | '/api/student';
} {
  const { guest, cabinetHref } = useContext(ViewerContext);
  return { guest, cabinetHref, api: guest ? '/api/public' : '/api/student' };
}
