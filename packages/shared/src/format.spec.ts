import { describe, expect, it } from 'vitest';
import ru from '../i18n/ru.json';
import kk from '../i18n/kk.json';
import en from '../i18n/en.json';
import { formatDayMonth, formatMessage, formatSinceMonth } from './format';
import { flattenKeys, getMessage, type Messages } from './i18n';

const bundles = { ru, kk, en } as Record<'ru' | 'kk' | 'en', Messages>;
const COUNTS = [0, 1, 2, 5, 11, 21, 22, 25];
const TZ = 'Asia/Almaty';
/** Intl ставит неразрывные пробелы («2026 г.») — для сравнения заменяем их обычными. */
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const msg = (locale: 'ru' | 'kk' | 'en', key: string, values: Record<string, number | string>) =>
  formatMessage(getMessage(bundles[locale], key)!, locale, values);

describe('FIX-01/02 numbers and dates in texts (BR-PRF-21)', () => {
  it('AC-PRF-20 «Освоено X из N тем» declines N in RU and EN for 0, 1, 2, 5, 11, 21, 22, 25', () => {
    expect(COUNTS.map((n) => msg('ru', 'student.myClass.progress', { mastered: 0, total: n }))).toEqual([
      'Освоено 0 из 0 тем',
      'Освоено 0 из 1 темы',
      'Освоено 0 из 2 тем',
      'Освоено 0 из 5 тем',
      'Освоено 0 из 11 тем',
      'Освоено 0 из 21 темы',
      'Освоено 0 из 22 тем',
      'Освоено 0 из 25 тем',
    ]);
    expect(COUNTS.map((n) => msg('en', 'student.progress.progressValue', { mastered: 1, total: n }))).toEqual(
      [
        '1 of 0 topics',
        '1 of 1 topic',
        '1 of 2 topics',
        '1 of 5 topics',
        '1 of 11 topics',
        '1 of 21 topics',
        '1 of 22 topics',
        '1 of 25 topics',
      ],
    );
    // KK: существительное после числительного не меняется.
    expect(msg('kk', 'student.myClass.progress', { mastered: 1, total: 21 })).toBe(
      '21 тақырыптың 1 меңгерілді',
    );
  });

  it('AC-PRF-20 «за последние N дней» and «N занятий» follow RU plural rules (one / few / many)', () => {
    expect(COUNTS.map((n) => msg('ru', 'teacher.analytics.window', { days: n }))).toEqual([
      'за последние 0 дней',
      'за последний 1 день',
      'за последние 2 дня',
      'за последние 5 дней',
      'за последние 11 дней',
      'за последний 21 день',
      'за последние 22 дня',
      'за последние 25 дней',
    ]);
    expect(msg('en', 'teacher.analytics.window', { days: 1 })).toBe('over the last 1 day');
    expect(msg('en', 'teacher.analytics.window', { days: 7 })).toBe('over the last 7 days');
  });

  it('REQ-NFR-I18N-01 every plural text of every locale formats for 0, 1, 2, 5, 11, 21, 22, 25 without leftovers', () => {
    for (const locale of ['ru', 'kk', 'en'] as const) {
      for (const key of flattenKeys(bundles[locale])) {
        const template = getMessage(bundles[locale], key)!;
        if (!template.includes(', plural,')) continue;
        const names = [...template.matchAll(/\{(\w+), plural,/g)].map((m) => m[1]!);
        for (const n of COUNTS) {
          const values: Record<string, number | string> = Object.fromEntries(names.map((name) => [name, n]));
          for (const other of template.matchAll(/\{(\w+)\}/g)) values[other[1]!] ??= 'x';
          const text = formatMessage(template, locale, values);
          expect(text, `${locale}:${key}:${n}`).not.toMatch(/[{}]/);
          expect(text, `${locale}:${key}:${n}`).toContain(String(n));
        }
      }
    }
  });

  it('AC-PRF-20 FIX-01 «На платформе с …»: RU genitive, KK ablative, EN month and year', () => {
    const at = '2026-10-25T10:00:00Z';
    expect(
      norm(formatMessage(ru.account.overview.since, 'ru', { date: formatSinceMonth(at, 'ru', TZ) })),
    ).toBe('На платформе с октября 2026 г.');
    expect(formatMessage(en.account.overview.since, 'en', { date: formatSinceMonth(at, 'en', TZ) })).toBe(
      'On the platform since October 2026',
    );
    expect(formatMessage(kk.account.overview.since, 'kk', { date: formatSinceMonth(at, 'kk', TZ) })).toBe(
      'Платформада 2026 жылдың қазанынан бастап',
    );
    // Граница месяца — в часовом поясе платформы (UTC+5): 31 мая 21:00 UTC — это уже июнь в Алматы.
    expect(norm(formatSinceMonth('2026-05-31T21:00:00Z', 'ru', TZ))).toBe('июня 2026 г.');
    expect(formatSinceMonth('2026-01-15T00:00:00Z', 'kk', TZ)).toBe('2026 жылдың қаңтарынан');
  });

  it('REQ-PRF-21 day and month for the activity calendar in RU, KK and EN', () => {
    expect(formatDayMonth('2026-10-12T06:00:00Z', 'ru', TZ)).toBe('12 октября');
    expect(formatDayMonth('2026-10-12T06:00:00Z', 'en', TZ)).toBe('October 12');
    expect(formatDayMonth('2026-10-12T06:00:00Z', 'kk', TZ)).toBe('12 қазан');
  });
});
