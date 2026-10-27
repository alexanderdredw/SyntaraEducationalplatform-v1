import { describe, expect, it } from 'vitest';
import {
  AtlasQuizStartDto,
  atlasQuizXp,
  elementDifficulty,
  initials,
  maskElementText,
  nextElementLevel,
  nextScientistLevel,
  scientistDescription,
  scientistDifficulty,
} from './atlas';

describe('atlas quiz rules (REQ-ATL-03, Quiz.js / ScientistsQuiz.js of the atlas)', () => {
  it('REQ-ATL-03 masks the element name and symbol and drops the boilerplate intro', () => {
    expect(maskElementText('Кислород — жизненно важный газ.', 'Кислород', 'O')).toBe('Жизненно важный газ');
    expect(maskElementText('Газ O₂, кислород дыхания. Символ O.', 'Кислород', 'O')).toBe(
      'Газ ___₂, ___ дыхания. Символ ___',
    );
    expect(maskElementText('Oxygen is element #8, a reactive gas.', 'Oxygen', 'O')).toBe('Reactive gas');
    // Символ — с учётом регистра: «о» в словах не заменяется.
    expect(maskElementText('Основа воды', 'Кислород', 'O')).toBe('Основа воды');
  });

  it('REQ-ATL-03 element quiz: levels 1–3 by the last 5 answers, 2 options on easy', () => {
    expect(elementDifficulty(1)).toBe('easy');
    expect(elementDifficulty(2)).toBe('medium');
    expect(elementDifficulty(3)).toBe('hard');
    expect(nextElementLevel(2, [1, 1])).toEqual({ level: 2, history: [1, 1] });
    expect(nextElementLevel(2, [1, 1, 1])).toEqual({ level: 3, history: [] });
    expect(nextElementLevel(3, [1, 1, 1])).toEqual({ level: 3, history: [1, 1, 1] });
    expect(nextElementLevel(2, [0, 0, 1])).toEqual({ level: 1, history: [] });
    expect(nextElementLevel(1, [0, 0, 0])).toEqual({ level: 1, history: [0, 0, 0] });
    expect(nextElementLevel(2, [1, 0, 1, 0, 1, 1]).history).toHaveLength(5);
  });

  it('decision А-5 scientists game: two right in a row — up, two wrong — down', () => {
    expect(scientistDifficulty(0)).toBe('easy');
    expect(scientistDifficulty(2)).toBe('hard');
    let s = nextScientistLevel(1, { correct: 0, wrong: 0 }, true);
    expect(s).toEqual({ level: 1, streak: { correct: 1, wrong: 0 } });
    s = nextScientistLevel(s.level, s.streak, true);
    expect(s).toEqual({ level: 2, streak: { correct: 0, wrong: 0 } });
    s = nextScientistLevel(2, { correct: 0, wrong: 1 }, false);
    expect(s).toEqual({ level: 1, streak: { correct: 0, wrong: 0 } });
    expect(nextScientistLevel(0, { correct: 0, wrong: 1 }, false).level).toBe(0);
  });

  it('BR-XP-05 1 XP per right answer within the common daily cap', () => {
    expect(atlasQuizXp(7, 1, 20, 0)).toBe(7);
    expect(atlasQuizXp(10, 1, 20, 15)).toBe(5);
    expect(atlasQuizXp(10, 1, 20, 20)).toBe(0);
    expect(atlasQuizXp(0, 1, 20, 0)).toBe(0);
    expect(atlasQuizXp(5, 1, 20, 25)).toBe(0);
  });

  it('REQ-ATL-03 scientist description and initials from the lesson «Учёные-химики»', () => {
    const body = '**«Отец современной химии».**\n\n_Человек, который взвесил невидимое_\n\n### Закон';
    expect(scientistDescription(body)).toBe('«Отец современной химии».');
    expect(scientistDescription(null)).toBe('');
    expect(initials('Дмитрий Менделеев')).toBe('ДМ');
    expect(initials('Antoine Lavoisier')).toBe('AL');
  });

  it('API-S-24 the quiz kind is validated', () => {
    expect(AtlasQuizStartDto.safeParse({ kind: 'elements' }).success).toBe(true);
    expect(AtlasQuizStartDto.safeParse({ kind: 'x' }).success).toBe(false);
  });
});
