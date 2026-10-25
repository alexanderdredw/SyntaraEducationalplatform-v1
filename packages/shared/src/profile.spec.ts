import { describe, expect, it } from 'vitest';
import {
  AVATAR_PRESETS,
  AvatarPutDto,
  EmailChangeDto,
  joinDisplayName,
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

  it('BR-PRF-08 password strength: too short, weak, fair, strong', () => {
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('abcdefg1')).toBe(2);
    expect(passwordStrength('Abcdefg1!xyz')).toBe(3);
    expect(passwordStrength('Құпиясөз-2026!')).toBe(3);
  });
});
