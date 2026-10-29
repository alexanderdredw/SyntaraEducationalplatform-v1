/**
 * «Исследовать» и окно элемента атласа (docs/EXPLORE_TZ.md, этап И1): поиск, блок таблицы, 5 смысловых групп вкладок.
 */
import { type PeriodicElement } from './periodic-table';

/** 5 групп вкладок окна элемента (REQ-EXP-07, BR-EXP-01) в порядке показа. */
export const ELEMENT_TAB_GROUPS = ['overview', 'structure', 'properties', 'nature', 'applications'] as const;
export type ElementTabGroup = (typeof ELEMENT_TAB_GROUPS)[number];

/**
 * Отнесение раздела урока к группе (REQ-EXP-07.3) — по коду раздела. Неуверенные отнесения — UNCERTAIN_SECTIONS
 * (на утверждение владельцу).
 */
const BY_CODE: Record<string, ElementTabGroup> = {
  'basic-facts': 'overview',
  'atomic-structure': 'structure',
  isotopes: 'structure',
  allotropes: 'structure',
  'physical-properties': 'properties',
  'chemical-properties': 'properties',
  occurrence: 'nature',
  production: 'nature',
  'carbon-cycle': 'nature',
  'nitrogen-cycle': 'nature',
  'industrial-significance': 'applications',
  applications: 'applications',
  significance: 'applications',
  connections: 'applications',
};

/** Разделы, отнесённые неуверенно (отчёт И1, на утверждение). */
export const UNCERTAIN_SECTIONS: Readonly<Record<string, string>> = {
  allotropes: 'Аллотропные модификации (углерод) → «Строение»: формы строения вещества; можно и «Свойства»',
  'carbon-cycle': 'Углеродный цикл → «В природе и производстве»: круговорот в природе; можно и «Применение»',
  'nitrogen-cycle': 'Азотный цикл → «В природе и производстве»: круговорот в природе; можно и «Применение»',
  'industrial-significance':
    'Промышленное значение (углерод) → «Применение»; можно и «В природе и производстве»',
};

/** Запасное правило — по названию раздела (RU, KK, EN), если код незнаком. */
const BY_TITLE: Array<[RegExp, ElementTabGroup]> = [
  [/основн|негізгі|basic|key facts/i, 'overview'],
  [/строени|структур|изотоп|құрылым|изотоп|structure|isotop|allotrop/i, 'structure'],
  [/свойств|қасиет|propert/i, 'properties'],
  [/природ|производ|получени|цикл|табиғат|өндір|occurr|product|cycle/i, 'nature'],
  [/применени|значени|взаимодейств|қолдан|маңыз|applic|signific|connect/i, 'applications'],
];

/** Группа раздела урока; «Источники» и неизвестное — null. */
export function sectionGroup(code: string | null | undefined, title: string): ElementTabGroup | null {
  const short = code?.split('#').pop();
  if (short === 'sources') return null;
  if (short && BY_CODE[short]) return BY_CODE[short];
  return BY_TITLE.find(([re]) => re.test(title))?.[1] ?? null;
}

/** Нормализация для поиска (REQ-EXP-02.1): без учёта регистра и «ё/е». */
export function normalizeSearch(s: string): string {
  return s.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

/** Поиск по названию (язык интерфейса), символу и номеру: «Fe», «26», «желез». */
export function matchesElement(query: string, e: { title: string; symbol: string; number: number }): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  if (/^\d+$/.test(q)) return e.number === Number(q);
  return normalizeSearch(e.symbol) === q || normalizeSearch(e.title).includes(q);
}

/** Блок таблицы (REQ-EXP-06.2): s, p, d, f — по группе и ряду таблицы C4; гелий — s. */
export function elementBlock(e: PeriodicElement): 's' | 'p' | 'd' | 'f' {
  if (e.row || e.group === null) return 'f';
  if (e.number === 2 || e.group <= 2) return 's';
  if (e.group >= 13) return 'p';
  return 'd';
}
