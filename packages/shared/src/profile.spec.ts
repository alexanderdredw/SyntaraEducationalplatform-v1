import { describe, expect, it } from 'vitest';
import {
  AVATAR_PRESETS,
  AvatarPutDto,
  EmailChangeDto,
  joinDisplayName,
  parseUserAgent,
  passwordStrength,
  ProfilePatchDto,
  splitDisplayName,
} from './profile';

const errors = (r: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
}) => (r.success ? {} : Object.fromEntries(r.error!.issues.map((i) => [String(i.path[0]), i.message])));

describe('profile (SPEC 7.15)', () => {
  it('AC-PRF-01 display_name splits at the first space and joins back', () => {
    expect(splitDisplayName('Асель')).toEqual({ firstName: 'Асель', lastName: null });
    expect(splitDisplayName('  Ерлан   Сапарович  Нурланов ')).toEqual({
      firstName: 'Ерлан',
      lastName: 'Сапарович Нурланов',
    });
    expect(joinDisplayName('Айгерім', 'Қасымова')).toBe('Айгерім Қасымова');
    expect(joinDisplayName('Айгерім', null)).toBe('Айгерім');
  });

  it('BR-PRF-01 names: Cyrillic, Latin and Kazakh letters, space, hyphen, apostrophe; 1–40', () => {
    expect(ProfilePatchDto.safeParse({ firstName: 'Әлия', lastName: "Қасым-Ұлы O'Neil" }).success).toBe(true);
    expect(errors(ProfilePatchDto.safeParse({ firstName: 'Асель2' }))).toEqual({ firstName: 'nameChars' });
    expect(errors(ProfilePatchDto.safeParse({ firstName: '-Асель' }))).toEqual({ firstName: 'nameChars' });
    expect(errors(ProfilePatchDto.safeParse({ firstName: '' }))).toEqual({ firstName: 'required' });
    expect(errors(ProfilePatchDto.safeParse({ lastName: 'Б'.repeat(41) }))).toEqual({ lastName: 'tooLong' });
    expect(ProfilePatchDto.safeParse({ lastName: '' }).success).toBe(true);
  });

  it('BR-PRF-04 «О себе» ≤ 300 and without links; unknown fields are rejected', () => {
    expect(ProfilePatchDto.safeParse({ about: 'Учу биологии 10 лет. Люблю походы.' }).success).toBe(true);
    for (const about of ['https://x.kz', 'см. www.site.ru', 'пишите на school.kz']) {
      expect(errors(ProfilePatchDto.safeParse({ about }))).toEqual({ about: 'noLinks' });
    }
    expect(errors(ProfilePatchDto.safeParse({ about: 'а'.repeat(301) }))).toEqual({ about: 'tooLong' });
    expect(ProfilePatchDto.safeParse({ firstName: 'А', userId: 'x' }).success).toBe(false);
  });

  it('BR-PRF-02 avatar: 24 presets, preset or picture required for their kind', () => {
    expect(AVATAR_PRESETS).toHaveLength(24);
    expect(new Set(AVATAR_PRESETS).size).toBe(24);
    expect(AvatarPutDto.safeParse({ kind: 'preset', preset: 'owl' }).success).toBe(true);
    expect(errors(AvatarPutDto.safeParse({ kind: 'preset' }))).toEqual({ preset: 'required' });
    expect(errors(AvatarPutDto.safeParse({ kind: 'photo' }))).toEqual({ mediaId: 'required' });
    expect(AvatarPutDto.safeParse({ kind: 'initials', color: 'gold' }).success).toBe(false);
  });

  it('BR-PRF-07 a new email is trimmed and lower-cased', () => {
    expect(EmailChangeDto.parse({ email: '  Asel@Example.COM ', currentPassword: 'x' }).email).toBe(
      'asel@example.com',
    );
  });

  it('AC-PRF-27 REQ-PRF-31 password strength — 4 levels; short or containing the login, email or name is weak', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('abcdefg1')).toBe(2);
    expect(passwordStrength('Abcdefg1!')).toBe(3);
    expect(passwordStrength('Abcdefg1!xyz')).toBe(4);
    expect(passwordStrength('Құпиясөз-2026!')).toBe(4);
    expect(passwordStrength('Asel.K-2026!x', ['asel.k'])).toBe(1);
    expect(passwordStrength('Teacher-2026!x', ['teacher@school.kz'])).toBe(1);
    expect(passwordStrength('Нурова-2026!xx', [null, 'Асель Нурова'])).toBe(1);
  });

  it('REQ-PRF-32 device names from User-Agent', () => {
    const chromeWin =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const edge = `${chromeWin} Edg/141.0`;
    const firefoxMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0';
    expect(parseUserAgent(chromeWin)).toEqual({ browser: 'Chrome', os: 'Windows' });
    expect(parseUserAgent(safariIphone)).toEqual({ browser: 'Safari', os: 'iPhone' });
    expect(parseUserAgent(edge)).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(parseUserAgent(firefoxMac)).toEqual({ browser: 'Firefox', os: 'macOS' });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
  });
});
