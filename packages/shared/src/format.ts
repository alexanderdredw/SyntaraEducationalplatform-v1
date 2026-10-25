import { IntlMessageFormat } from 'intl-messageformat';
import { type Locale } from './enums';

/**
 * Числа и даты в текстах (SPEC BR-PRF-21, FIX-01/02, docs/PROFILE_TZ_2.md): шаблоны i18n — ICU MessageFormat
 * (plural по правилам языка: RU one/few/many, KK и EN — свои), даты — через Intl с часовым поясом платформы.
 * Web форматирует сообщения через next-intl (тот же ICU); эта функция — для api, worker и тестов.
 */
export function formatMessage(
  template: string,
  locale: Locale,
  values: Record<string, string | number> = {},
): string {
  return String(new IntlMessageFormat(template, locale).format(values));
}

/** KK: «с октября 2026 года» — «2026 жылдың қазанынан» (притяжательная форма + исходный падеж). */
const KK_MONTH_SINCE = [
  'қаңтарынан',
  'ақпанынан',
  'наурызынан',
  'сәуірінен',
  'мамырынан',
  'маусымынан',
  'шілдесінен',
  'тамызынан',
  'қыркүйегінен',
  'қазанынан',
  'қарашасынан',
  'желтоқсанынан',
] as const;

function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * FIX-01: месяц и год для «На платформе с …»: RU — родительный падеж («октября 2026 г.»), KK — «2026 жылдың
 * қазанынан» (текст «Платформада {date} бастап»), EN — «October 2026».
 */
export function formatSinceMonth(iso: string | Date, locale: Locale, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (locale === 'kk') {
    const { year, month } = zonedParts(date, timeZone);
    return `${year} жылдың ${KK_MONTH_SINCE[month - 1]}`;
  }
  if (locale === 'ru') {
    // С днём Intl даёт месяц в родительном падеже («25 октября 2026 г.») — день отбрасывается.
    const parts = new Intl.DateTimeFormat('ru', { timeZone, day: 'numeric', month: 'long', year: 'numeric' })
      .formatToParts(date)
      .filter((p) => p.type !== 'day');
    return parts
      .map((p) => p.value)
      .join('')
      .trim();
  }
  return new Intl.DateTimeFormat('en', { timeZone, month: 'long', year: 'numeric' }).format(date);
}

/** «12 октября» / «12 қазан» / «October 12» — подсказки календаря активности (REQ-PRF-21). */
export function formatDayMonth(iso: string | Date, locale: Locale, timeZone: string): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric', month: 'long' }).format(date);
}
