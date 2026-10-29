import { describe, expect, it } from 'vitest';
import {
  ELEMENT_TAB_GROUPS,
  elementBlock,
  matchesElement,
  normalizeSearch,
  sectionGroup,
  UNCERTAIN_SECTIONS,
} from './atlas-explore';
import { ELECTRON_SHELLS, electronConfig, shellsFromConfig } from './atlas-questions';
import { PERIODIC_ELEMENTS, periodicElement } from './periodic-table';

describe('«Исследовать» и окно элемента (docs/EXPLORE_TZ.md, И1)', () => {
  it('REQ-EXP-02.1 search by name, symbol and number; case and «ё/е» do not matter', () => {
    const iron = { title: 'Железо', symbol: 'Fe', number: 26 };
    expect(matchesElement('Fe', iron)).toBe(true);
    expect(matchesElement('fe', iron)).toBe(true);
    expect(matchesElement('26', iron)).toBe(true);
    expect(matchesElement('2', iron)).toBe(false);
    expect(matchesElement('желез', iron)).toBe(true);
    expect(matchesElement('ЖЕЛЕЗ', iron)).toBe(true);
    expect(matchesElement('  ', iron)).toBe(true);
    expect(normalizeSearch('Ёж')).toBe('еж');
    expect(matchesElement('берилли', { title: 'Бериллий', symbol: 'Be', number: 4 })).toBe(true);
  });

  it('REQ-EXP-06.2 the block of every element: s, p, d, f', () => {
    const block = (n: number) => elementBlock(periodicElement(n)!);
    expect([1, 2, 3, 12, 55, 88].map(block)).toEqual(['s', 's', 's', 's', 's', 's']);
    expect([5, 10, 13, 54, 118].map(block)).toEqual(['p', 'p', 'p', 'p', 'p']);
    expect([21, 26, 30, 72, 112].map(block)).toEqual(['d', 'd', 'd', 'd', 'd']);
    expect([57, 60, 71, 89, 103].map(block)).toEqual(['f', 'f', 'f', 'f', 'f']);
    expect(PERIODIC_ELEMENTS.every((e) => ['s', 'p', 'd', 'f'].includes(elementBlock(e)))).toBe(true);
  });

  it('BR-EXP-01 sections map to the 5 groups by code; «Источники» — to none; unknown codes — by title', () => {
    expect(ELEMENT_TAB_GROUPS).toEqual(['overview', 'structure', 'properties', 'nature', 'applications']);
    expect(sectionGroup('chemistry/oxygen#basic-facts', 'Основные факты')).toBe('overview');
    expect(sectionGroup('isotopes', 'Изотопы')).toBe('structure');
    expect(sectionGroup('chemical-properties', '')).toBe('properties');
    expect(sectionGroup('production', '')).toBe('nature');
    expect(sectionGroup('connections', '')).toBe('applications');
    expect(sectionGroup('sources', 'Источники')).toBeNull();
    expect(sectionGroup('new-code', 'Физические свойства')).toBe('properties');
    expect(sectionGroup(null, 'Something else')).toBeNull();
    for (const code of Object.keys(UNCERTAIN_SECTIONS)) expect(sectionGroup(code, '')).not.toBeNull();
  });

  it('AC-EXP-05 the Bohr model data for all 60 elements: electrons sum to the number, shells follow the configuration', () => {
    for (let n = 1; n <= 60; n++) {
      const shells = ELECTRON_SHELLS[n]!;
      expect(
        shells.reduce((a, b) => a + b, 0),
        `element ${n}`,
      ).toBe(n);
      expect(shellsFromConfig(n), `element ${n}`).toEqual(shells);
      expect(electronConfig(n).length).toBeGreaterThan(0);
    }
  });
});
