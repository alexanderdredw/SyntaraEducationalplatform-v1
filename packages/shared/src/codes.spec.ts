import { describe, expect, it } from 'vitest';
import { isWellFormedClassCode, normalizeClassCode } from './accounts';
import { BATTLE_CODE_RE, normalizeBattleCode } from './battle';

const PH07 = { length: 6, alphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', ttl_days: 30 };

/** CODES_TZ: коды класса (PH-07) и коды Battle (PH-45) нормализуются и проверяются раздельно. */
describe('Class and Battle codes (BR-CODE-02)', () => {
  it('BR-CODE-02 class code normalization stays as before: trim, upper case, spaces removed (PH-07)', () => {
    expect(normalizeClassCode(' 7kq 2mp ')).toBe('7KQ2MP');
    expect(isWellFormedClassCode(normalizeClassCode(' 7kq 2mp '), PH07)).toBe(true);
    // Дефис в коде класса не удаляется — правило PH-07 не меняется.
    expect(isWellFormedClassCode(normalizeClassCode('7KQ-2MP'), PH07)).toBe(false);
  });

  it('BR-CODE-02 Battle code normalization: trim, upper case, spaces and hyphens removed', () => {
    expect(normalizeBattleCode(' ktr-583 ')).toBe('KTR583');
    expect(BATTLE_CODE_RE.test(normalizeBattleCode(' ktr-583 '))).toBe(true);
    expect(BATTLE_CODE_RE.test(normalizeBattleCode('7KQ2MP'))).toBe(false);
  });

  it('BR-CODE-05 an old class code that looks like LLLDDD is still a well-formed class code', () => {
    expect(isWellFormedClassCode('KTR583', PH07)).toBe(true);
  });
});
