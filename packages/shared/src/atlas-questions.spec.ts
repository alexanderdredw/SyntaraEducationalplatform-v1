import { describe, expect, it } from 'vitest';
import {
  alternates,
  ATLAS_QUESTION_TYPES,
  type AtlasQuestionType,
  buildQuestion,
  checkSymbol,
  ELECTRON_SHELLS,
  electronConfig,
  electronCountOptions,
  familiesWithLessons,
  LEVEL_QUESTION_TYPES,
  makeFact,
  pickQuestionType,
  type QuizElement,
  shellsFromConfig,
  tableHintPeriods,
} from './atlas-questions';
import { AtlasQuizAnswerDto, AtlasQuizStartDto } from './atlas';
import { PERIODIC_ELEMENTS } from './periodic-table';

/** Детерминированный генератор: LCG, старшие биты. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return (k: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor(((s >>> 8) / 2 ** 24) * k);
  };
}

const POOL: QuizElement[] = PERIODIC_ELEMENTS.slice(0, 60).map((e) => ({
  id: `e${e.number}`,
  number: e.number,
  symbol: e.symbol,
  family: e.family,
  period: e.period,
  group: e.group,
}));
const byNumber = (n: number) => POOL[n - 1]!;

describe('atlas quiz question types (docs/TESTS_TZ.md, T2)', () => {
  it('REQ-TST-10 nine types; every type belongs to a level; each level has four', () => {
    expect(ATLAS_QUESTION_TYPES).toHaveLength(9);
    const used = new Set(Object.values(LEVEL_QUESTION_TYPES).flat());
    expect([...used].sort()).toEqual([...ATLAS_QUESTION_TYPES].sort());
    for (const set of Object.values(LEVEL_QUESTION_TYPES)) expect(set).toHaveLength(4);
  });

  it('REQ-TST-10.1 types alternate: never three of a kind in a row over 1000 picks per level', () => {
    for (const level of [1, 2, 3]) {
      const random = rng(level);
      const types: AtlasQuestionType[] = [];
      for (let i = 0; i < 1000; i++) types.push(pickQuestionType(level, 'quick', types, () => true, random)!);
      expect(alternates(types)).toBe(true);
      expect(new Set(types)).toEqual(new Set(LEVEL_QUESTION_TYPES[level as 1 | 2 | 3]));
    }
  });

  it('REQ-TST-10.1 an unavailable type is skipped; with one available type it may repeat', () => {
    const random = rng(3);
    const onlyBohr = (t: AtlasQuestionType) => t === 'bohr';
    expect(pickQuestionType(2, 'quick', ['bohr', 'bohr'], onlyBohr, random)).toBe('bohr');
    expect(pickQuestionType(3, 'quick', [], (t) => t !== 'fun-fact' && t !== 'config', random)).toMatch(
      /table-click|type-symbol/,
    );
  });

  it('REQ-TST-11 «Таблица-челлендж» asks only table-click on every level', () => {
    const random = rng(4);
    for (const level of [1, 2, 3])
      expect(pickQuestionType(level, 'table', [], () => true, random)).toBe('table-click');
  });

  it('REQ-TST-11 «По семейству»: only families with at least 4 elements with lessons', () => {
    expect(familiesWithLessons(POOL.map((p) => p.family))).toEqual([
      'alkali_metal',
      'alkaline_earth',
      'transition_metal',
      'post_transition',
      'metalloid',
      'nonmetal',
      'halogen',
      'noble_gas',
      'lanthanide',
    ]);
    expect(familiesWithLessons(['halogen', 'halogen', 'halogen', 'nonmetal'])).toEqual([]);
  });
});

describe('electron configurations and shells (REQ-TST-10, config and bohr)', () => {
  it('REQ-TST-10 configurations with a noble-gas core, as in the lessons', () => {
    expect(electronConfig(1)).toBe('1s¹');
    expect(electronConfig(2)).toBe('1s²');
    expect(electronConfig(3)).toBe('[He] 2s¹');
    expect(electronConfig(11)).toBe('[Ne] 3s¹');
    expect(electronConfig(26)).toBe('[Ar] 3d⁶ 4s²');
    expect(electronConfig(24)).toBe('[Ar] 3d⁵ 4s¹');
    expect(electronConfig(29)).toBe('[Ar] 3d¹⁰ 4s¹');
    expect(electronConfig(35)).toBe('[Ar] 3d¹⁰ 4s² 4p⁵');
    expect(electronConfig(46)).toBe('[Kr] 4d¹⁰');
    expect(electronConfig(56)).toBe('[Xe] 6s²');
    expect(electronConfig(57)).toBe('[Xe] 5d¹ 6s²');
    expect(electronConfig(60)).toBe('[Xe] 4f⁴ 6s²');
  });

  it('REQ-TST-10.2 shells from the configuration equal the atom schemes of the lessons (1–60)', () => {
    for (let n = 1; n <= 60; n++) {
      expect(shellsFromConfig(n), `element ${n}`).toEqual(ELECTRON_SHELLS[n]);
      expect(ELECTRON_SHELLS[n]!.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('REQ-TST-10 all 60 configurations are distinct (the config question has one answer)', () => {
    const all = Array.from({ length: 60 }, (_, i) => electronConfig(i + 1));
    expect(new Set(all).size).toBe(60);
  });
});

describe('question data (REQ-TST-10)', () => {
  it('REQ-TST-10.4 true/false statements come only from data fields and are checked against them', () => {
    const random = rng(7);
    let trues = 0;
    for (let i = 0; i < 1000; i++) {
      const item = POOL[random(POOL.length)]!;
      const { fact, truth } = makeFact(item, POOL, random);
      const expected =
        fact.kind === 'family'
          ? fact.family === item.family
          : fact.kind === 'period'
            ? fact.period === item.period
            : fact.kind === 'group'
              ? fact.group === item.group
              : item.number > POOL.find((p) => p.id === fact.other)!.number;
      expect(truth).toBe(expected);
      if (fact.kind === 'group') expect(item.group).not.toBeNull();
      if (truth) trues++;
    }
    expect(trues).toBeGreaterThan(350);
    expect(trues).toBeLessThan(650);
  });

  it('REQ-TST-10 bohr «how many electrons» — the right number and three neighbours, all ≥ 1', () => {
    const random = rng(8);
    for (const n of [1, 2, 8, 60]) {
      const options = electronCountOptions(n, random);
      expect(options).toHaveLength(4);
      expect(new Set(options).size).toBe(4);
      expect(options).toContain(String(n));
      for (const o of options) expect(Number(o)).toBeGreaterThanOrEqual(1);
    }
  });

  it('REQ-TST-10, BR-TST-02 choice questions always have 4 options with the answer; others have none', () => {
    const random = rng(9);
    for (const type of ATLAS_QUESTION_TYPES)
      for (const level of [1, 2, 3]) {
        const item = byNumber(20);
        const q = buildQuestion(type, item, POOL, level, random);
        if (type === 'fact-true-false') expect(q.options).toEqual(['true', 'false']);
        else if (type === 'table-click' || type === 'type-symbol') expect(q.options).toEqual([]);
        else {
          expect(q.options).toHaveLength(4);
          expect(q.options).toContain(q.answer);
        }
      }
    expect(buildQuestion('type-symbol', byNumber(20), POOL, 3, random).answer).toBe('Ca');
    expect(buildQuestion('bohr', byNumber(8), POOL, 1, random)).toMatchObject({
      variant: 'count',
      answer: '8',
    });
    expect(buildQuestion('bohr', byNumber(8), POOL, 2, random)).toMatchObject({
      variant: 'element',
      answer: 'e8',
    });
    expect(buildQuestion('table-click', byNumber(16), POOL, 3, random).variant).toBe('cell');
    expect(buildQuestion('table-click', byNumber(16), POOL, 2, random).variant).toBe('name');
    // У лантаноидов нет группы — поиск по названию и на сложном.
    expect(buildQuestion('table-click', byNumber(58), POOL, 3, random).variant).toBe('name');
  });

  it('REQ-TST-10 «Впишите символ»: case matters; «ca» is wrong with a hint about the capital letter', () => {
    expect(checkSymbol('Ca', 'Ca')).toBe('correct');
    expect(checkSymbol(' Ca ', 'Ca')).toBe('correct');
    expect(checkSymbol('ca', 'Ca')).toBe('case');
    expect(checkSymbol('CA', 'Ca')).toBe('case');
    expect(checkSymbol('C', 'Ca')).toBe('wrong');
  });

  it('REQ-TST-10.3 «50/50» on the table highlights two periods: the right one and another', () => {
    const random = rng(10);
    for (let i = 0; i < 100; i++) {
      const rows = tableHintPeriods(3, [1, 2, 3, 4, 5, 6], random);
      expect(rows).toHaveLength(2);
      expect(rows).toContain(3);
      expect(rows[0]!).toBeLessThan(rows[1]!);
    }
  });

  it('REQ-TST-11 start: mode «quick» by default; an answer is an option or a text', () => {
    expect(AtlasQuizStartDto.parse({})).toMatchObject({ kind: 'elements', mode: 'quick' });
    expect(AtlasQuizStartDto.parse({ mode: 'family', family: 'halogen' }).family).toBe('halogen');
    expect(AtlasQuizStartDto.safeParse({ mode: 'speed' }).success).toBe(false);
    expect(AtlasQuizAnswerDto.safeParse({ text: 'Ca' }).success).toBe(true);
    expect(AtlasQuizAnswerDto.safeParse({ optionId: 'x' }).success).toBe(true);
    expect(AtlasQuizAnswerDto.safeParse({}).success).toBe(false);
  });
});
