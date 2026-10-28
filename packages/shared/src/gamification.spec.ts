import { describe, expect, it } from 'vitest';
import {
  AnswerDto,
  badgeEarned,
  type BadgeFacts,
  LessonEventDto,
  levelOf,
  localDate,
  normalizeAnswer,
  scorePercent,
  streakOf,
  topicQuizXp,
  topicQuizXpAward,
} from './gamification';

const none: BadgeFacts = {
  quizFinished: 0,
  streak: 0,
  masteredTopics: 0,
  subjectConquered: false,
  level: 1,
  comebackTopics: 0,
};

describe('quiz and gamification rules', () => {
  it('BR-XP-01 topic test XP = round(20 × correct / total), from the attempt percent', () => {
    const pct = (c: number, n: number) => Math.round((10000 * c) / n) / 100; // BR-QZ-05
    expect(topicQuizXp(pct(5, 5), 20)).toBe(20);
    expect(topicQuizXp(pct(4, 5), 20)).toBe(16);
    expect(topicQuizXp(pct(0, 5), 20)).toBe(0);
    expect(topicQuizXp(pct(1, 3), 20)).toBe(7); // 6.67
    expect(topicQuizXp(pct(1, 8), 20)).toBe(3); // 2.5 → 3
    for (let n = 1; n <= 40; n++)
      for (let c = 0; c <= n; c++) expect(topicQuizXp(pct(c, n), 20)).toBe(Math.round((20 * c) / n));
  });

  it('BR-XP-01 a repeat gives only the increase over the best previous result, never negative', () => {
    expect(topicQuizXpAward(60, null, 20)).toBe(12);
    expect(topicQuizXpAward(100, 60, 20)).toBe(8);
    expect(topicQuizXpAward(60, 100, 20)).toBe(0);
    expect(topicQuizXpAward(100, 100, 20)).toBe(0);
    expect(topicQuizXpAward(0, null, 20)).toBe(0);
  });

  it('BR-QZ-03, PH-28 text answers: trim, collapse spaces, lower case', () => {
    expect(normalizeAnswer('  Левый   Желудочек ')).toBe('левый желудочек');
    expect(normalizeAnswer('ЧЕТЫРЕ')).toBe(normalizeAnswer('четыре'));
    expect(normalizeAnswer('Ә\tҒ')).toBe('ә ғ');
  });

  it('BR-QZ-05 score is rounded to 2 decimals', () => {
    expect(scorePercent(2, 3)).toBe(66.67);
    expect(scorePercent(17, 20)).toBe(85);
    expect(scorePercent(0, 0)).toBe(0);
  });

  it('BR-XP-03 level and xpToNext', () => {
    expect(levelOf(0)).toEqual({ level: 1, xpToNext: 100 });
    expect(levelOf(99)).toEqual({ level: 1, xpToNext: 1 });
    expect(levelOf(100)).toEqual({ level: 2, xpToNext: 100 });
    expect(levelOf(450)).toEqual({ level: 5, xpToNext: 50 });
  });

  it('BR-ST-01 the day is taken in PLATFORM_TZ (UTC+5) at the day boundaries', () => {
    // 18:59 UTC — ещё 2026-10-16 в Алматы; 19:00 UTC — уже 2026-10-17.
    expect(localDate(new Date('2026-10-16T18:59:00Z'), 'Asia/Almaty')).toBe('2026-10-16');
    expect(localDate(new Date('2026-10-16T19:00:00Z'), 'Asia/Almaty')).toBe('2026-10-17');
    expect(localDate(new Date('2026-10-16T19:00:00Z'), 'UTC')).toBe('2026-10-16');
  });

  it('BR-ST-02/03 streak ends today or yesterday; otherwise 0; best is kept', () => {
    const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-15'];
    expect(streakOf(days, '2026-10-15')).toEqual({ current: 2, best: 3 });
    expect(streakOf(days, '2026-10-16')).toEqual({ current: 2, best: 3 });
    expect(streakOf(days, '2026-10-17')).toEqual({ current: 0, best: 3 });
    expect(streakOf([], '2026-10-17')).toEqual({ current: 0, best: 0 });
    // Переход через месяц.
    expect(streakOf(['2026-09-30', '2026-10-01'], '2026-10-01')).toEqual({ current: 2, best: 2 });
  });

  // BR-BDG-01: каждое из 12 правил seed.
  it.each([
    ['first_step', { event: 'quiz_finished', count: 1 }, { quizFinished: 1 }, { quizFinished: 0 }],
    ['warmup', { streak: 3 }, { streak: 3 }, { streak: 2 }],
    ['week_power', { streak: 7 }, { streak: 8 }, { streak: 6 }],
    ['marathon', { streak: 30 }, { streak: 30 }, { streak: 29 }],
    ['topic_mastered', { masteredTopics: 1 }, { masteredTopics: 1 }, { masteredTopics: 0 }],
    ['five_topics', { masteredTopics: 5 }, { masteredTopics: 5 }, { masteredTopics: 4 }],
    ['erudition', { masteredTopics: 10 }, { masteredTopics: 12 }, { masteredTopics: 9 }],
    [
      'subject_conquered',
      { subjectAllTopicsMastered: true },
      { subjectConquered: true },
      { subjectConquered: false },
    ],
    ['erudite', { level: 5 }, { level: 5 }, { level: 4 }],
    ['legend', { level: 10 }, { level: 11 }, { level: 9 }],
    ['comeback', { comebackTopics: 1, failedBelowPercent: 50 }, { comebackTopics: 1 }, { comebackTopics: 0 }],
    [
      'bug_fixing',
      { comebackTopics: 5, failedBelowPercent: 50 },
      { comebackTopics: 5 },
      { comebackTopics: 4 },
    ],
  ])('BR-BDG-01 %s', (_code, rule, yes, no) => {
    expect(badgeEarned(rule, { ...none, ...yes })).toBe(true);
    expect(badgeEarned(rule, { ...none, ...no })).toBe(false);
  });

  it('BR-BDG-01 an unknown rule is never earned', () => {
    expect(badgeEarned({ something: 1 }, { ...none, quizFinished: 100 })).toBe(false);
  });

  it('REQ-ST-LES-04, API-S-08 request schemas', () => {
    const id = '01a14486-b58f-70e1-8ae1-d9d47fdb1672';
    expect(
      LessonEventDto.safeParse({
        type: 'lesson_opened',
        topicId: id,
        idempotencyKey: `lesson:${id}:2026-10-16`,
      }).success,
    ).toBe(true);
    expect(
      LessonEventDto.safeParse({ type: 'lesson_opened', topicId: id, idempotencyKey: 'x' }).success,
    ).toBe(false);
    expect(AnswerDto.safeParse({ questionId: id, optionId: id }).success).toBe(true);
    expect(AnswerDto.safeParse({ questionId: id, textAnswer: 'четыре' }).success).toBe(true);
    expect(AnswerDto.safeParse({ questionId: id }).success).toBe(false);
    expect(AnswerDto.safeParse({ questionId: id, optionId: id, textAnswer: 'x' }).success).toBe(false);
  });
});
