import { DEFAULT_LOCALE, LOCALES, type Locale } from '@syntara/shared';

/** Локаль запроса из заголовка Accept-Language (API-GEN-03): первый поддерживаемый язык, иначе ru. */
export function resolveLocale(acceptLanguage: string | undefined): Locale {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase().slice(0, 2);
    if (tag && (LOCALES as readonly string[]).includes(tag)) return tag as Locale;
  }
  return DEFAULT_LOCALE;
}

/** Порядок выбора перевода: запрошенный язык, затем ru, en, kk (контент без перевода — на доступном языке, REQ-GEN-PREF-02). */
export function pickTranslation<T extends { locale: Locale | null }>(
  rows: T[],
  wanted: Locale,
): (T & { locale: Locale }) | undefined {
  const order: Locale[] = [wanted, 'ru', 'en', 'kk'];
  for (const locale of order) {
    const row = rows.find((r) => r.locale === locale);
    if (row) return row as T & { locale: Locale };
  }
  return undefined;
}
