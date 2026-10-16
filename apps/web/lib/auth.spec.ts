import { describe, expect, it } from 'vitest';
import { HOME_BY_ROLE, safeReturnTo, isGuestLearnPath } from './auth';
import { endOfDayIso, formatDateTime } from './datetime';

describe('returnTo (раздел 4)', () => {
  it('REQ-GEN-AUTH-01 keeps internal paths from the whitelist', () => {
    expect(safeReturnTo('/staff/tickets')).toBe('/staff/tickets');
    expect(safeReturnTo('/learn/sections/abc?tab=quiz')).toBe('/learn/sections/abc?tab=quiz');
    expect(safeReturnTo('/join')).toBe('/join');
    expect(safeReturnTo('/ru/staff/requests')).toBe('/staff/requests');
  });

  it('REQ-GEN-AUTH-01 rejects external, protocol-relative and unknown targets', () => {
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example/staff/',
      '/\\evil.example',
      '/admin',
      '/staff/../../evil',
      'javascript:alert(1)',
      '/staffing',
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBe('/');
    }
  });

  it('REQ-GEN-AUTH-01 default page per role', () => {
    expect(HOME_BY_ROLE).toEqual({
      teacher: '/teacher/courses',
      student: '/learn/subjects',
      support_agent: '/staff/tickets',
      onboarding_agent: '/staff/requests',
    });
  });
});

describe('PH-31 date format', () => {
  it('REQ-NFR-I18N-01 formats DD.MM.YYYY HH:mm in PLATFORM_TZ', () => {
    expect(formatDateTime('2026-10-14T20:30:00Z', 'Asia/Almaty')).toBe('15.10.2026 01:30');
    expect(formatDateTime('2026-01-05T04:05:00Z', 'UTC')).toBe('05.01.2026 04:05');
  });

  it('REQ-SUP-01 «срок» filter boundary is the end of the day in PLATFORM_TZ', () => {
    expect(endOfDayIso('2026-10-14', 'Asia/Almaty')).toBe('2026-10-14T23:59:59.999+05:00');
    expect(endOfDayIso('2026-10-14', 'UTC')).toBe('2026-10-14T23:59:59.999+00:00');
  });
});

describe('isGuestLearnPath', () => {
  it('BR-VIS-04 a guest opens only the catalog, sections, subjects and lessons of /learn', () => {
    for (const p of ['/learn/subjects', '/learn/sections/x', '/learn/subjects/x', '/learn/topics/x?tab=quiz'])
      expect(isGuestLearnPath(p)).toBe(true);
    for (const p of [
      '/learn/progress',
      '/learn/achievements',
      '/learn/assistant',
      '/learn/assignments',
      '/learn',
    ])
      expect(isGuestLearnPath(p)).toBe(false);
  });
});
