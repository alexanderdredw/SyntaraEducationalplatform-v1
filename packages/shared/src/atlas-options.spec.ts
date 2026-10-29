import { describe, expect, it } from 'vitest';
import {
  ATLAS_OPTIONS,
  type ElementCandidate,
  elementQuizText,
  elementStem,
  maskElementText,
  maskLeaks,
  pickElementDistractors,
  pickScientistDistractors,
  withAnswer,
} from './atlas';
import { type AtlasDifficulty } from './atlas';
import { periodicElement } from './periodic-table';

/** Детерминированный генератор для повторяемых тестов. */
function rng(seed: number) {
  let x = seed;
  return (n: number) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return Math.floor((x / 2147483648) * n);
  };
}

/** 60 элементов с уроками (номера 1–60) — как в квизе атласа. */
const POOL: ElementCandidate[] = Array.from({ length: 60 }, (_, i) => {
  const e = periodicElement(i + 1)!;
  return { id: e.symbol, number: e.number, family: e.family, period: e.period, group: e.group };
});

describe('atlas options and masking (docs/TESTS_TZ.md, T1b)', () => {
  it('AC-TST-07, BR-TST-02 1000 generated questions: always 4 different options, the answer at a random position', () => {
    const random = rng(7);
    const positions = [0, 0, 0, 0];
    const levels: AtlasDifficulty[] = ['easy', 'medium', 'hard'];
    for (let n = 0; n < 1000; n++) {
      const item = POOL[random(POOL.length)]!;
      const options = withAnswer(item.id, pickElementDistractors(item, POOL, levels[n % 3]!, random), random);
      expect(options).toHaveLength(ATLAS_OPTIONS);
      expect(new Set(options).size).toBe(ATLAS_OPTIONS);
      positions[options.indexOf(item.id)]!++;
    }
    // Верный — на каждой из 4 позиций (около 250 раз).
    for (const p of positions) expect(p).toBeGreaterThan(180);
  });

  it('AC-TST-07, REQ-TST-07.2 hard: every wrong option is from the same family or the same period/group (1000 questions)', () => {
    const random = rng(11);
    for (let n = 0; n < 1000; n++) {
      const item = POOL[random(POOL.length)]!;
      for (const id of pickElementDistractors(item, POOL, 'hard', random)) {
        const c = POOL.find((x) => x.id === id)!;
        const related =
          c.family === item.family ||
          c.period === item.period ||
          (item.group !== null && c.group === item.group);
        expect(related, `${item.id} → ${id}`).toBe(true);
      }
    }
  });

  it('REQ-TST-07.2 easy: wrong options from other families; medium: 1–2 close (family or ±2), the rest from others', () => {
    const random = rng(3);
    for (let n = 0; n < 1000; n++) {
      const item = POOL[random(POOL.length)]!;
      const easy = pickElementDistractors(item, POOL, 'easy', random).map((id) =>
        POOL.find((x) => x.id === id)!,
      );
      expect(easy.every((c) => c.family !== item.family)).toBe(true);
      const medium = pickElementDistractors(item, POOL, 'medium', random).map((id) =>
        POOL.find((x) => x.id === id)!,
      );
      const close = medium.filter((c) => c.family === item.family || Math.abs(c.number - item.number) <= 2);
      expect([1, 2]).toContain(close.length);
    }
  });

  it('REQ-TST-07.2 not enough candidates — the nearest by number fill up the options', () => {
    const tiny = POOL.slice(0, 5);
    const item = tiny[0]!;
    const options = pickElementDistractors(item, tiny, 'easy', rng(1));
    expect(new Set(options).size).toBe(3);
    expect(options).not.toContain(item.id);
  });

  it('REQ-TST-07.4 scientists game, hard: scientists of close epochs (±50 years), otherwise the nearest by year', () => {
    const pool = [
      { id: 'lavoisier', year: 1774 },
      { id: 'dalton', year: 1803 },
      { id: 'nobel', year: 1867 },
      { id: 'mendeleev', year: 1869 },
      { id: 'curie', year: 1898 },
      { id: 'rutherford', year: 1911 },
      { id: 'pauling', year: 1939 },
      { id: 'hodgkin', year: 1964 },
    ];
    const random = rng(5);
    for (let n = 0; n < 200; n++) {
      const options = pickScientistDistractors(pool[2]!, pool, 'hard', random);
      expect(options).toHaveLength(3);
      for (const id of options)
        expect(Math.abs(pool.find((p) => p.id === id)!.year - 1867)).toBeLessThanOrEqual(50);
    }
    expect(pickScientistDistractors(pool[0]!, pool, 'easy', random)).toHaveLength(3);
  });

  it('REQ-TST-08, BR-TST-03 masks every word form: cases, derivatives, KK endings, EN plural and derivatives', () => {
    expect(maskElementText('Без кислорода нет горения; кислородная маска.', 'Кислород', 'O')).toBe(
      'Без ___ нет горения; ___ маска',
    );
    // Слово «___» в начале убирается вместе со вступлением (как в оригинале) — поэтому примеры начинаются иначе.
    expect(maskElementText('Есть углеродное волокно и углерод.', 'Углерод', 'C')).toBe(
      'Есть ___ волокно и ___',
    );
    expect(maskElementText('Соли меди и медный купорос.', 'Медь', 'Cu')).toBe('Соли ___ и ___ купорос');
    expect(maskElementText('Есть литиевые батареи и соли лития.', 'Литий', 'Li')).toBe(
      'Есть ___ батареи и соли ___',
    );
    expect(maskElementText('Есть серная кислота и пары серы.', 'Сера', 'S', 'ru')).toBe(
      'Есть ___ кислота и пары ___',
    );
    expect(maskElementText('Ауадағы оттегінің үлесі — 21%.', 'Оттегі', 'O', 'kk')).toBe(
      'Ауадағы ___ үлесі — 21%',
    );
    expect(maskElementText('Электр мыстың сымдары.', 'Мыс', 'Cu', 'kk')).toBe('Электр ___ сымдары');
    expect(maskElementText('Salt chlorides and chlorine gas.', 'Chlorine', 'Cl', 'en')).toBe(
      'Salt ___ and ___ gas',
    );
    expect(maskElementText('Cast irons and iron ore.', 'Iron', 'Fe', 'en')).toBe('Cast ___ and ___ ore');
    // Посторонние слова не страдают.
    expect(maskElementText('Как и бор, ведёт себя как кремний.', 'Бор', 'B')).toBe(
      'Как и ___, ведёт себя как кремний',
    );
    expect(elementStem('Натрий', 'ru')).toBe('натр');
    expect(elementStem('Sodium', 'en')).toBe('sodium');
  });

  it('AC-TST-08 maskLeaks finds the stem, the name and the symbol as a word; elementQuizText falls back to the description', () => {
    expect(maskLeaks('Газ O2 и кислородный', 'Кислород', 'O', 'ru')).toEqual(['кислород']);
    expect(maskLeaks('Символ — O.', 'Кислород', 'O', 'ru')).toEqual(['O']);
    expect(maskLeaks('Чистый ___', 'Кислород', 'O', 'ru')).toEqual([]);
    const texts = {
      title: 'Кислород',
      description: 'Газ для дыхания.',
      funFact: 'Кислород — третий во Вселенной.',
    };
    expect(elementQuizText(3, texts, 'O', 'ru')).toBe('Третий во Вселенной');
    expect(elementQuizText(2, texts, 'O', 'ru')).toBe('Газ для дыхания');
    expect(elementQuizText(1, { title: 'Кислород', description: '' }, 'O', 'ru')).toBeNull();
  });
});
