'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * Кто смотрит страницы обучения: ученик или гость (BR-VIS-04). Гость читает базовые уроки через публичные
 * операции API-PUB-10..13; ученик — через API-S-*. Права проверяет api (AG-04).
 */
const GuestContext = createContext(false);

export function LearnViewerProvider({ guest, children }: { guest: boolean; children: ReactNode }) {
  return <GuestContext.Provider value={guest}>{children}</GuestContext.Provider>;
}

export function useLearnViewer(): { guest: boolean; api: '/api/public' | '/api/student' } {
  const guest = useContext(GuestContext);
  return { guest, api: guest ? '/api/public' : '/api/student' };
}
