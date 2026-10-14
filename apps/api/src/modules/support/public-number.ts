import { randomInt } from 'node:crypto';

/**
 * BR-FRM-02: заявки — 'SR-' + YYMMDD + '-' + 4 цифры; обращения — 'T-' + YYMMDD + '-' + 4 цифры.
 * Дата — в часовом поясе платформы (PLATFORM_TZ, PH-42). Уникальность обеспечивает UNIQUE в БД:
 * при коллизии номер генерируется заново.
 */
export type PublicNumberPrefix = 'SR' | 'T';

export function platformDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export function generatePublicNumber(
  prefix: PublicNumberPrefix,
  now: Date,
  timeZone: string,
  random: () => number = () => randomInt(0, 10_000),
): string {
  return `${prefix}-${platformDate(now, timeZone)}-${String(random()).padStart(4, '0')}`;
}

export const PUBLIC_NUMBER_PATTERN = {
  SR: /^SR-\d{6}-\d{4}$/,
  T: /^T-\d{6}-\d{4}$/,
} as const;

/** Попыток подобрать свободный номер; 10 000 номеров в сутки на тип. */
export const PUBLIC_NUMBER_ATTEMPTS = 20;
