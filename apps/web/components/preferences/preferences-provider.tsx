'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { COOKIE, type Consent, type Theme, writeCookie } from '@/lib/preferences';

interface PreferencesValue {
  theme: Theme | undefined;
  setTheme: (theme: Theme) => void;
  dataSaver: boolean;
  setDataSaver: (on: boolean) => void;
  consent: Consent | undefined;
  setConsent: (consent: Consent) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

/**
 * Тема и экономия трафика меняются без перезагрузки: атрибуты на <html> + cookie (REQ-GEN-PREF-03, -04).
 * Начальные значения приходят с сервера из cookie, поэтому SSR и клиент совпадают.
 */
export function PreferencesProvider({
  initialTheme,
  initialDataSaver,
  initialConsent,
  children,
}: {
  initialTheme: Theme | undefined;
  initialDataSaver: boolean;
  initialConsent: Consent | undefined;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState(initialTheme);
  const [dataSaver, setDataSaverState] = useState(initialDataSaver);
  const [consent, setConsentState] = useState(initialConsent);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute('data-theme', next);
    writeCookie(COOKIE.theme, next);
    setThemeState(next);
  }, []);

  const setDataSaver = useCallback((on: boolean) => {
    document.documentElement.setAttribute('data-data-saver', String(on));
    writeCookie(COOKIE.dataSaver, on ? '1' : '0');
    setDataSaverState(on);
  }, []);

  // REQ-PUB-LEGAL-02: решение хранится в cookie `consent` 12 месяцев.
  const setConsent = useCallback((next: Consent) => {
    writeCookie(COOKIE.consent, next, 365 * 24 * 60 * 60);
    setConsentState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, dataSaver, setDataSaver, consent, setConsent }),
    [theme, setTheme, dataSaver, setDataSaver, consent, setConsent],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
