import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES } from '@syntara/shared';

/**
 * Локаль в URL-префиксе `/{ru|kk|en}/...`, выбор хранится в cookie `locale` (REQ-GEN-PREF-01).
 * Все три языка включены (PH-04, решение владельца по Q-07).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeCookie: { name: 'locale', maxAge: 60 * 60 * 24 * 365 },
});
