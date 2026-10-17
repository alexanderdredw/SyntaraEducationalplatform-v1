import { describe, expect, it } from 'vitest';
import { localDate } from './gamification';
import { AssignmentCreateDto, periodRanges, progressPercent, topicColor } from './progress';

const config = { school_year: { from: '09-01', to: '05-31' }, quarters: [] };

describe('progress rules (7.4–7.6)', () => {
  it('BR-ST-04 today and the last 7/30/90 days include today; compare is the previous period of the same length', () => {
    expect(periodRanges('today', '2026-09-28', config)).toEqual({
      range: { from: '2026-09-28', to: '2026-09-28' },
      compare: { from: '2026-09-27', to: '2026-09-27' },
    });
    expect(periodRanges('7d', '2026-09-28', config)).toEqual({
      range: { from: '2026-09-22', to: '2026-09-28' },
      compare: { from: '2026-09-15', to: '2026-09-21' },
    });
    // Эталон U08: 30 дней — 30.08.2026 — 28.09.2026, сравнение 31.07.2026 — 29.08.2026.
    expect(periodRanges('30d', '2026-09-28', config)).toEqual({
      range: { from: '2026-08-30', to: '2026-09-28' },
      compare: { from: '2026-07-31', to: '2026-08-29' },
    });
    expect(periodRanges('90d', '2026-03-01', config)!.range).toEqual({
      from: '2025-12-02',
      to: '2026-03-01',
    });
  });

  it('BR-ST-04 school year 01.09–31.05 that started last; compare — the previous school year', () => {
    expect(periodRanges('year', '2026-10-17', config)).toEqual({
      range: { from: '2026-09-01', to: '2027-05-31' },
      compare: { from: '2025-09-01', to: '2026-05-31' },
    });
    expect(periodRanges('year', '2026-07-10', config)!.range).toEqual({
      from: '2025-09-01',
      to: '2026-05-31',
    });
  });

  it('BR-ST-04, Q-23 quarter comes from configuration; no quarters — unavailable', () => {
    expect(periodRanges('quarter', '2026-10-17', config)).toBeNull();
    const quarters = [
      { from: '2026-09-01', to: '2026-10-26' },
      { from: '2026-11-03', to: '2026-12-28' },
    ];
    expect(periodRanges('quarter', '2026-11-10', { ...config, quarters })).toEqual({
      range: { from: '2026-11-03', to: '2026-12-28' },
      compare: { from: '2026-09-08', to: '2026-11-02' },
    });
    // Каникулы между четвертями — четверти нет.
    expect(periodRanges('quarter', '2026-10-30', { ...config, quarters })).toBeNull();
  });

  it('BR-ST-01 day boundaries in UTC+5: 19:30 UTC is already the next day in Almaty', () => {
    expect(localDate(new Date('2026-09-27T18:59:59Z'), 'Asia/Almaty')).toBe('2026-09-27');
    expect(localDate(new Date('2026-09-27T19:00:00Z'), 'Asia/Almaty')).toBe('2026-09-28');
  });

  it('BR-AN-04 colors by PH-30 thresholds; BR-ST-05 percent with one decimal', () => {
    const t = { red_below: 50, green_from: 80 };
    expect([33, 49.99, 50, 79.99, 80, 100].map((p) => topicColor(p, t))).toEqual([
      'red',
      'red',
      'blue',
      'blue',
      'green',
      'green',
    ]);
    expect(progressPercent(1, 41)).toBe(2.4);
    expect(progressPercent(0, 0)).toBe(0);
  });

  it('API-T-22 dueAt is an ISO date-time with a time zone', () => {
    const base = {
      classId: '01a14891-97e4-731c-b02f-a87d355e3fc1',
      subjectId: '01a14891-97e4-731c-b02f-a87d355e3fc2',
      topicId: '01a14891-97e4-731c-b02f-a87d355e3fc3',
    };
    expect(AssignmentCreateDto.safeParse({ ...base, dueAt: '2026-10-05T23:59:00+05:00' }).success).toBe(true);
    expect(AssignmentCreateDto.safeParse({ ...base, dueAt: '05.10.2026' }).success).toBe(false);
  });
});
