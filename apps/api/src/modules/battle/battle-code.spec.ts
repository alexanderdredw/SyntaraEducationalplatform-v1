import { BATTLE_CODE_RE } from '@syntara/shared';
import { allocateBattleCode, BATTLE_CODE_ATTEMPTS, generateBattleCode } from './battle-code';

describe('Battle code (BR-BTL-01, BR-CODE-03, AC-CODE-04)', () => {
  it('BR-BTL-01 BR-CODE-03 the Battle code generator always issues ^[A-Z]{3}[1-9]{3}$', () => {
    for (let i = 0; i < 100_000; i++) expect(BATTLE_CODE_RE.test(generateBattleCode())).toBe(true);
  });

  it('BR-CODE-03 AC-CODE-04 a code equal to an active class code is retried; after 10 attempts — none (503)', async () => {
    const insert = vi.fn(async (code: string) => code);
    const isClassCode = vi.fn(async () => true);
    expect(await allocateBattleCode(generateBattleCode, isClassCode, insert)).toBeNull();
    expect(isClassCode).toHaveBeenCalledTimes(BATTLE_CODE_ATTEMPTS);
    expect(insert).not.toHaveBeenCalled();
  });

  it('BR-CODE-03 a taken code is skipped, the next free one is inserted', async () => {
    const codes = ['KTR583', 'ABC234'];
    const result = await allocateBattleCode(
      () => codes.shift()!,
      async (code) => code === 'KTR583',
      async (code) => ({ code }),
    );
    expect(result).toEqual({ code: 'ABC234' });
  });

  it('BR-BTL-01 a unique-index collision on insert is retried within the same 10 attempts', async () => {
    const insert = vi.fn(async () => null);
    expect(await allocateBattleCode(generateBattleCode, async () => false, insert)).toBeNull();
    expect(insert).toHaveBeenCalledTimes(BATTLE_CODE_ATTEMPTS);
  });
});
