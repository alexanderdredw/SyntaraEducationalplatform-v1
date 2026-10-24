import { describe, expect, it } from 'vitest';
import { RegisterStudentDto } from './accounts';

const base = { displayName: 'Асель', login: 'asel.k', password: 'student-pass-1' };
const errors = (input: object) => {
  const r = RegisterStudentDto.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('регистрация ученика (API-AUTH-03S, PH-44)', () => {
  it('AC-STF-01 login: 3–32 characters a-z 0-9 . _ -, stored in lower case', () => {
    expect(RegisterStudentDto.parse({ ...base, login: '  Asel_K-1.x ' }).login).toBe('asel_k-1.x');
    for (const ok of ['abc', 'a'.repeat(32), 'a.b', 'a_b', 'a-b', '007']) {
      expect(errors({ ...base, login: ok }), ok).toEqual({});
    }
    for (const bad of ['ab', 'a'.repeat(33), 'асель', 'a b', 'a+b', '.ab', '-ab']) {
      expect(errors({ ...base, login: bad }), bad).toEqual({ login: 'invalidLogin' });
    }
    expect(errors({ ...base, login: 'a@b.kz' })).toEqual({ login: 'loginIsEmail' });
  });

  it('AC-STF-01 password ≥ 8; email, school and class code are optional', () => {
    expect(errors({ ...base, password: '1234567' })).toEqual({ password: 'passwordTooShort' });
    expect(errors(base)).toEqual({});
    expect(errors({ ...base, email: '', schoolId: '', schoolName: '', code: '' })).toEqual({});
    expect(errors({ ...base, schoolName: 'Школа №1' })).toEqual({});
    expect(errors({ ...base, email: 'not-an-email' })).toHaveProperty('email');
  });
});
