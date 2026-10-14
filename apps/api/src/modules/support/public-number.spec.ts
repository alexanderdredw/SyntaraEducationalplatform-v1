import { generatePublicNumber, platformDate, PUBLIC_NUMBER_PATTERN } from './public-number';

describe('public_number (BR-FRM-02)', () => {
  it('BR-FRM-02 school requests: SR-YYMMDD-NNNN', () => {
    const n = generatePublicNumber('SR', new Date('2026-10-14T05:00:00Z'), 'Asia/Almaty', () => 42);
    expect(n).toBe('SR-261014-0042');
    expect(n).toMatch(PUBLIC_NUMBER_PATTERN.SR);
  });

  it('BR-FRM-02 tickets: T-YYMMDD-NNNN', () => {
    const n = generatePublicNumber('T', new Date('2026-10-14T05:00:00Z'), 'Asia/Almaty', () => 9999);
    expect(n).toBe('T-261014-9999');
    expect(n).toMatch(PUBLIC_NUMBER_PATTERN.T);
  });

  it('BR-FRM-02 the date is taken in PLATFORM_TZ, not UTC', () => {
    // 2026-10-14 20:30 UTC — уже 15 октября в Алматы (UTC+5).
    expect(platformDate(new Date('2026-10-14T20:30:00Z'), 'Asia/Almaty')).toBe('261015');
    expect(platformDate(new Date('2026-10-14T20:30:00Z'), 'UTC')).toBe('261014');
  });

  it('BR-FRM-02 random part is always four digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePublicNumber('T', new Date(), 'Asia/Almaty')).toMatch(PUBLIC_NUMBER_PATTERN.T);
    }
  });
});
