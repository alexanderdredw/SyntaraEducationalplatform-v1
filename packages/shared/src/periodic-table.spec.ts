import { describe, expect, it } from 'vitest';
import { ELEMENT_FAMILIES, PERIODIC_ELEMENTS, periodicElement } from './periodic-table';

describe('periodic table data (REQ-PTBL-02)', () => {
  it('REQ-PTBL-02 all 118 elements in order, unique symbols, every family is used', () => {
    expect(PERIODIC_ELEMENTS).toHaveLength(118);
    expect(PERIODIC_ELEMENTS.map((e) => e.number)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    expect(new Set(PERIODIC_ELEMENTS.map((e) => e.symbol)).size).toBe(118);
    expect(new Set(PERIODIC_ELEMENTS.map((e) => e.family))).toEqual(new Set(ELEMENT_FAMILIES));
    expect(periodicElement(8)).toMatchObject({ symbol: 'O', period: 2, group: 16, family: 'nonmetal' });
  });

  it('REQ-PTBL-02 the standard layout: 18 groups × 7 periods without overlaps, 15 lanthanides and 15 actinides in own rows', () => {
    const main = PERIODIC_ELEMENTS.filter((e) => e.group !== null);
    expect(new Set(main.map((e) => `${e.period}:${e.group}`)).size).toBe(main.length);
    expect(main.every((e) => e.group! >= 1 && e.group! <= 18 && e.period >= 1 && e.period <= 7)).toBe(true);
    expect(PERIODIC_ELEMENTS.filter((e) => e.row === 'lanthanides').map((e) => e.number)).toEqual(
      Array.from({ length: 15 }, (_, i) => 57 + i),
    );
    expect(PERIODIC_ELEMENTS.filter((e) => e.row === 'actinides').map((e) => e.number)).toEqual(
      Array.from({ length: 15 }, (_, i) => 89 + i),
    );
    // Период 7 заполнен целиком: 18 групп − ячейка-ссылка на ряд актиноидов = 17 элементов.
    expect(main.filter((e) => e.period === 7)).toHaveLength(17);
  });
});
