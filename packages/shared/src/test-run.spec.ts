import { describe, expect, it } from 'vitest';
import { atlasQuizXp } from './atlas';
import { topicQuizXp, topicQuizXpAward } from './gamification';
import {
  answerStreak,
  atlasCredit,
  HINT_LIMIT,
  hintAllowed,
  HintDto,
  percentDelta,
  pickHintRemovals,
  segmentState,
  weightedCorrect,
  xpPercent,
} from './test-run';

const a = (correct: boolean, hinted = false) => ({ correct, hinted });

describe('test run rules (docs/TESTS_TZ.md, T1)', () => {
  it('REQ-TST-04, BR-TST-01 «50/50» removes exactly two wrong options and never the correct one', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (let seed = 0; seed < 200; seed++) {
      let x = seed;
      const removed = pickHintRemovals(ids, 'c', (n) => (x = (x * 31 + 7) % 997) % n);
      expect(removed).toHaveLength(2);
      expect(new Set(removed).size).toBe(2);
      expect(removed).not.toContain('c');
      for (const id of removed) expect(ids).toContain(id);
    }
  });

  it('REQ-TST-04.1, REQ-TST-04.4 a hint only for single choice with 4+ options and at most 3 per attempt', () => {
    expect(HINT_LIMIT).toBe(3);
    expect(hintAllowed('single_choice', 4, 0)).toBe(true);
    expect(hintAllowed('single_choice', 4, 2)).toBe(true);
    expect(hintAllowed('single_choice', 4, 3)).toBe(false);
    expect(hintAllowed('single_choice', 3, 0)).toBe(false);
    expect(hintAllowed('true_false', 4, 0)).toBe(false);
    expect(hintAllowed('text_input', 4, 0)).toBe(false);
    expect(HintDto.safeParse({ questionId: 'x' }).success).toBe(false);
  });

  it('AC-TST-05, BR-TST-01 topic test XP: round(20 × (plain + 0.5 × hinted) / total), only the increase to the best', () => {
    // 10 вопросов: 6 верно без подсказки, 2 — с подсказкой, 2 — неверно → (6 + 1) / 10 = 70 % → 14 XP.
    const answers = [...Array(6).fill(a(true)), a(true, true), a(true, true), a(false), a(false, true)];
    expect(weightedCorrect(answers)).toBe(7);
    expect(xpPercent(answers, 10)).toBe(70);
    expect(topicQuizXp(xpPercent(answers, 10), 20)).toBe(14);
    // Тот же результат без подсказок — 16 XP; повтор с 70 % после 80 % — +0.
    expect(topicQuizXp(xpPercent([...Array(8).fill(a(true)), a(false), a(false)], 10), 20)).toBe(16);
    expect(topicQuizXpAward(70, 80, 20)).toBe(0);
    // Повтор: было 70 % (14 XP), теперь 100 % без подсказок → +6.
    expect(topicQuizXpAward(100, 70, 20)).toBe(6);
    // 3 вопроса, 1 верный с подсказкой: 16,67 % → round(3,33) = 3 XP.
    expect(topicQuizXp(xpPercent([a(true, true), a(false), a(false)], 3), 20)).toBe(3);
    expect(xpPercent([], 0)).toBe(0);
  });

  it('AC-TST-05, BR-TST-01, BR-XP-05 atlas quiz XP: floor(sum of weights), 1 XP each, daily cap 20', () => {
    expect(atlasCredit([a(true), a(true, true), a(true, true), a(true, true), a(false)])).toBe(2);
    expect(atlasCredit([a(true, true)])).toBe(0);
    expect(atlasCredit([a(true, true), a(true, true)])).toBe(1);
    expect(atlasQuizXp(atlasCredit(Array(10).fill(a(true))), 1, 20, 0)).toBe(10);
    expect(
      atlasQuizXp(atlasCredit([...Array(7).fill(a(true)), ...Array(3).fill(a(true, true))]), 1, 20, 15),
    ).toBe(5);
  });

  it('REQ-TST-02 segments: green, yellow-green with a hint, red; current; streak from the end', () => {
    expect(segmentState(a(true), false)).toBe('correct');
    expect(segmentState(a(true, true), false)).toBe('hinted');
    expect(segmentState(a(false, true), false)).toBe('wrong');
    expect(segmentState(undefined, true)).toBe('current');
    expect(segmentState(undefined, false)).toBe('todo');
    expect(answerStreak([a(true), a(false), a(true), a(true, true), a(true)])).toBe(3);
    expect(answerStreak([a(true), a(false)])).toBe(0);
    expect(answerStreak([])).toBe(0);
  });

  it('REQ-TST-05.2 «+Y к прошлой попытке» in whole percent; no previous attempt → null', () => {
    expect(percentDelta(80, 60)).toBe(20);
    expect(percentDelta(66.67, 70)).toBe(-3);
    expect(percentDelta(50, null)).toBeNull();
  });
});
