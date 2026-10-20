import { BATTLE_CODE_RE, isWellFormedClassCode, type ClassCodeConfig } from '@syntara/shared';
import { type Database } from '@syntara/db';
import { ApiException } from '../../common/api-exception';
import { type AppConfigService } from '../../config/app-config.service';
import { type Env } from '../../config/env';
import { type BattleCodes } from '../battle/battle-codes.service';
import { ClassCodesService } from './class-codes.service';

const PH07: ClassCodeConfig = { length: 6, alphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', ttl_days: 30 };

/** БД-заглушка: вставка кода всегда успешна; коды запоминаются для проверки. */
function service(isActiveBattleCode: (code: string) => Promise<boolean> = async () => false) {
  const inserted: Buffer[] = [];
  const db = {
    insert: () => ({
      values: async (v: { codeHash: Buffer }) => {
        inserted.push(v.codeHash);
      },
    }),
  } as unknown as Database;
  const config = { get: async () => PH07 } as unknown as AppConfigService;
  const battleCodes = { isActiveCode: vi.fn(isActiveBattleCode) } as unknown as BattleCodes;
  const env = { SESSION_SECRET: 'x'.repeat(64) } as Env;
  return { codes: new ClassCodesService(db, env, config, battleCodes), battleCodes, inserted };
}

describe('ClassCodesService (BR-CODE-03, AC-CODE-03)', () => {
  it('BR-CODE-03 AC-CODE-03 the class code generator never issues ^[A-Z]{3}[1-9]{3}$ in 100 000 iterations', async () => {
    const { codes } = service();
    for (let i = 0; i < 100_000; i++) {
      const { code } = await codes.issue('class-id', 'teacher-id');
      expect(BATTLE_CODE_RE.test(code)).toBe(false);
      expect(isWellFormedClassCode(code, PH07)).toBe(true);
    }
  });

  it('BR-CODE-03 a code taken by an active Battle session is retried; after 10 attempts — 503', async () => {
    const { codes, battleCodes, inserted } = service(async () => true);
    const error = await codes.issue('class-id', 'teacher-id').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(503);
    expect(inserted).toHaveLength(0);
    // Коды вида LLLDDD отбрасываются ещё до проверки, поэтому вызовов не больше 10.
    expect(vi.mocked(battleCodes.isActiveCode).mock.calls.length).toBeLessThanOrEqual(10);
    expect(vi.mocked(battleCodes.isActiveCode).mock.calls.length).toBeGreaterThan(0);
  });

  it('BR-CODE-03 a taken code is skipped and the next free one is issued', async () => {
    let calls = 0;
    const { codes, inserted } = service(async () => ++calls === 1);
    const { code } = await codes.issue('class-id', 'teacher-id');
    expect(calls).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.equals(codes.hash(code))).toBe(true);
  });
});
