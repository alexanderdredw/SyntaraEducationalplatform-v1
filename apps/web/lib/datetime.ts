/**
 * PH-31 `datetime.format` = «DD.MM.YYYY HH:mm» в часовом поясе платформы (PH-42, REQ-NFR-I18N-01).
 */
export function formatDateTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Смещение часового пояса в формате ISO (+05:00) на указанную дату. */
export function tzOffset(date: Date, timeZone: string): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = name.replace('GMT', '');
  return offset === '' ? '+00:00' : offset;
}

/** Конец дня YYYY-MM-DD в часовом поясе платформы — граница фильтра «Срок ответа до». */
export function endOfDayIso(day: string, timeZone: string): string {
  const offset = tzOffset(new Date(`${day}T12:00:00Z`), timeZone);
  return `${day}T23:59:59.999${offset}`;
}
