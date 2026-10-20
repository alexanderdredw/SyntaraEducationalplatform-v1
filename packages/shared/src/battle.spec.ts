import { describe, expect, it } from 'vitest';
import {
  BATTLE_CODE_RE,
  BattleJoinDto,
  BattleQuestionDto,
  battleDisplayName,
  normalizeBattleCode,
  rankBattle,
  scoreBattleAnswers,
} from './battle';

const option = (text: string, isCorrect = false) => ({ text, isCorrect });

describe('Battle (SPEC 7.12)', () => {
  it('BR-BTL-01 code format and normalization: «ktr 583» → KTR583', () => {
    expect(normalizeBattleCode(' ktr 583 ')).toBe('KTR583');
    expect(BATTLE_CODE_RE.test('KTR583')).toBe(true);
    expect(BATTLE_CODE_RE.test('KTR083')).toBe(false); // цифры 1–9
    expect(BATTLE_CODE_RE.test('KT5833')).toBe(false);
    expect(BattleJoinDto.parse({ code: 'ktr 583' }).code).toBe('KTR583');
  });

  it('BR-CODE-02 Battle code normalization: trim, upper case, spaces and hyphens removed', () => {
    expect(normalizeBattleCode('  ktr-583 ')).toBe('KTR583');
    expect(normalizeBattleCode('k t r - 5 8 3')).toBe('KTR583');
    expect(BattleJoinDto.parse({ code: 'ktr-583' }).code).toBe('KTR583');
    // Формат проверяет сервер (422 invalidBattleCode), DTO только нормализует.
    expect(BattleJoinDto.parse({ code: 'abc' }).code).toBe('ABC');
    expect(BATTLE_CODE_RE.test(normalizeBattleCode('7kq2mp'))).toBe(false);
  });

  it('BR-BTL-10 single_choice: 2–4 options, exactly one correct, option text required', () => {
    const base = { type: 'single_choice' as const, text: 'Q', timeLimitSec: 20 };
    expect(BattleQuestionDto.safeParse({ ...base, options: [option('A', true), option('B')] }).success).toBe(
      true,
    );
    const one = BattleQuestionDto.safeParse({ ...base, options: [option('A', true)] });
    expect(one.error?.issues.map((i) => i.message)).toContain('min2');
    const five = BattleQuestionDto.safeParse({
      ...base,
      options: [option('A', true), option('B'), option('C'), option('D'), option('E')],
    });
    expect(five.error?.issues.map((i) => i.message)).toContain('max4');
    const two = BattleQuestionDto.safeParse({ ...base, options: [option('A', true), option('B', true)] });
    expect(two.error?.issues.map((i) => i.message)).toContain('exactlyOneCorrect');
    const empty = BattleQuestionDto.safeParse({ ...base, options: [option('A', true), option('')] });
    expect(empty.error?.issues.map((i) => i.message)).toContain('required');
  });

  it('BR-BTL-10 true_false: exactly two options, texts may be empty (server sets them)', () => {
    const base = { type: 'true_false' as const, text: 'Q', timeLimitSec: 10 };
    expect(BattleQuestionDto.safeParse({ ...base, options: [option('', true), option('')] }).success).toBe(
      true,
    );
    const three = BattleQuestionDto.safeParse({
      ...base,
      options: [option('', true), option(''), option('')],
    });
    expect(three.error?.issues.map((i) => i.message)).toContain('trueFalseTwo');
  });

  it('BR-BTL-10 time limit is one of 5/10/20/30/60/90 s', () => {
    const q = { type: 'single_choice' as const, text: 'Q', options: [option('A', true), option('B')] };
    for (const t of [5, 10, 20, 30, 60, 90])
      expect(BattleQuestionDto.safeParse({ ...q, timeLimitSec: t }).success).toBe(true);
    expect(BattleQuestionDto.safeParse({ ...q, timeLimitSec: 15 }).success).toBe(false);
  });

  it('BR-BTL-07 display name: first name and initial of the second word', () => {
    expect(battleDisplayName('Асель Каримова')).toBe('Асель К.');
    expect(battleDisplayName('  Alexandr  ')).toBe('Alexandr');
    expect(battleDisplayName('ержан иванов петрович')).toBe('ержан И.');
  });

  it('BR-BTL-04 ranking: correct desc, then correct time asc, full tie — same place (1, 2, 2, 4)', () => {
    const ranked = rankBattle([
      { id: 'c', correctCount: 3, correctTimeMs: 9000 },
      { id: 'a', correctCount: 4, correctTimeMs: 12000 },
      { id: 'b', correctCount: 3, correctTimeMs: 9000 },
      { id: 'd', correctCount: 3, correctTimeMs: 8000 },
      { id: 'e', correctCount: 1, correctTimeMs: 1000 },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ['a', 1],
      ['d', 2],
      ['c', 3],
      ['b', 3],
      ['e', 5],
    ]);
  });

  it('BR-BTL-04 score: only correct answers count towards the time', () => {
    expect(
      scoreBattleAnswers([
        { isCorrect: true, responseMs: 1200 },
        { isCorrect: false, responseMs: 300 },
        { isCorrect: true, responseMs: 800 },
      ]),
    ).toEqual({ correctCount: 2, correctTimeMs: 2000, answeredCount: 3 });
  });
});
