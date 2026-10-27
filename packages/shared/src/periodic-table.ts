/**
 * Данные блока «Периодическая таблица» (REQ-PTBL-02, docs/CHEM_TZ.md 6.3): все 118 элементов — номер, символ,
 * период, группа (1–18) и семейство. Лантаноиды и актиноиды — отдельными рядами (`row`), без группы. Названия —
 * в i18n (`student.periodicTable.elements.<символ>`), а не здесь.
 */

export const ELEMENT_FAMILIES = [
  'alkali_metal',
  'alkaline_earth',
  'transition_metal',
  'post_transition',
  'metalloid',
  'nonmetal',
  'halogen',
  'noble_gas',
  'lanthanide',
  'actinide',
] as const;
export type ElementFamily = (typeof ELEMENT_FAMILIES)[number];

export interface PeriodicElement {
  number: number;
  symbol: string;
  period: number;
  /** Группа 1–18; у лантаноидов и актиноидов — null (отдельный ряд). */
  group: number | null;
  family: ElementFamily;
  row?: 'lanthanides' | 'actinides';
}

type Row = [number, string, number, number | null, ElementFamily];

// prettier-ignore
const ROWS: Row[] = [
  [1, 'H', 1, 1, 'nonmetal'], [2, 'He', 1, 18, 'noble_gas'],
  [3, 'Li', 2, 1, 'alkali_metal'], [4, 'Be', 2, 2, 'alkaline_earth'], [5, 'B', 2, 13, 'metalloid'],
  [6, 'C', 2, 14, 'nonmetal'], [7, 'N', 2, 15, 'nonmetal'], [8, 'O', 2, 16, 'nonmetal'], [9, 'F', 2, 17, 'halogen'],
  [10, 'Ne', 2, 18, 'noble_gas'],
  [11, 'Na', 3, 1, 'alkali_metal'], [12, 'Mg', 3, 2, 'alkaline_earth'], [13, 'Al', 3, 13, 'post_transition'],
  [14, 'Si', 3, 14, 'metalloid'], [15, 'P', 3, 15, 'nonmetal'], [16, 'S', 3, 16, 'nonmetal'],
  [17, 'Cl', 3, 17, 'halogen'], [18, 'Ar', 3, 18, 'noble_gas'],
  [19, 'K', 4, 1, 'alkali_metal'], [20, 'Ca', 4, 2, 'alkaline_earth'], [21, 'Sc', 4, 3, 'transition_metal'],
  [22, 'Ti', 4, 4, 'transition_metal'], [23, 'V', 4, 5, 'transition_metal'], [24, 'Cr', 4, 6, 'transition_metal'],
  [25, 'Mn', 4, 7, 'transition_metal'], [26, 'Fe', 4, 8, 'transition_metal'], [27, 'Co', 4, 9, 'transition_metal'],
  [28, 'Ni', 4, 10, 'transition_metal'], [29, 'Cu', 4, 11, 'transition_metal'], [30, 'Zn', 4, 12, 'transition_metal'],
  [31, 'Ga', 4, 13, 'post_transition'], [32, 'Ge', 4, 14, 'metalloid'], [33, 'As', 4, 15, 'metalloid'],
  [34, 'Se', 4, 16, 'nonmetal'], [35, 'Br', 4, 17, 'halogen'], [36, 'Kr', 4, 18, 'noble_gas'],
  [37, 'Rb', 5, 1, 'alkali_metal'], [38, 'Sr', 5, 2, 'alkaline_earth'], [39, 'Y', 5, 3, 'transition_metal'],
  [40, 'Zr', 5, 4, 'transition_metal'], [41, 'Nb', 5, 5, 'transition_metal'], [42, 'Mo', 5, 6, 'transition_metal'],
  [43, 'Tc', 5, 7, 'transition_metal'], [44, 'Ru', 5, 8, 'transition_metal'], [45, 'Rh', 5, 9, 'transition_metal'],
  [46, 'Pd', 5, 10, 'transition_metal'], [47, 'Ag', 5, 11, 'transition_metal'], [48, 'Cd', 5, 12, 'transition_metal'],
  [49, 'In', 5, 13, 'post_transition'], [50, 'Sn', 5, 14, 'post_transition'], [51, 'Sb', 5, 15, 'metalloid'],
  [52, 'Te', 5, 16, 'metalloid'], [53, 'I', 5, 17, 'halogen'], [54, 'Xe', 5, 18, 'noble_gas'],
  [55, 'Cs', 6, 1, 'alkali_metal'], [56, 'Ba', 6, 2, 'alkaline_earth'],
  [57, 'La', 6, null, 'lanthanide'], [58, 'Ce', 6, null, 'lanthanide'], [59, 'Pr', 6, null, 'lanthanide'],
  [60, 'Nd', 6, null, 'lanthanide'], [61, 'Pm', 6, null, 'lanthanide'], [62, 'Sm', 6, null, 'lanthanide'],
  [63, 'Eu', 6, null, 'lanthanide'], [64, 'Gd', 6, null, 'lanthanide'], [65, 'Tb', 6, null, 'lanthanide'],
  [66, 'Dy', 6, null, 'lanthanide'], [67, 'Ho', 6, null, 'lanthanide'], [68, 'Er', 6, null, 'lanthanide'],
  [69, 'Tm', 6, null, 'lanthanide'], [70, 'Yb', 6, null, 'lanthanide'], [71, 'Lu', 6, null, 'lanthanide'],
  [72, 'Hf', 6, 4, 'transition_metal'], [73, 'Ta', 6, 5, 'transition_metal'], [74, 'W', 6, 6, 'transition_metal'],
  [75, 'Re', 6, 7, 'transition_metal'], [76, 'Os', 6, 8, 'transition_metal'], [77, 'Ir', 6, 9, 'transition_metal'],
  [78, 'Pt', 6, 10, 'transition_metal'], [79, 'Au', 6, 11, 'transition_metal'], [80, 'Hg', 6, 12, 'transition_metal'],
  [81, 'Tl', 6, 13, 'post_transition'], [82, 'Pb', 6, 14, 'post_transition'], [83, 'Bi', 6, 15, 'post_transition'],
  [84, 'Po', 6, 16, 'post_transition'], [85, 'At', 6, 17, 'halogen'], [86, 'Rn', 6, 18, 'noble_gas'],
  [87, 'Fr', 7, 1, 'alkali_metal'], [88, 'Ra', 7, 2, 'alkaline_earth'],
  [89, 'Ac', 7, null, 'actinide'], [90, 'Th', 7, null, 'actinide'], [91, 'Pa', 7, null, 'actinide'],
  [92, 'U', 7, null, 'actinide'], [93, 'Np', 7, null, 'actinide'], [94, 'Pu', 7, null, 'actinide'],
  [95, 'Am', 7, null, 'actinide'], [96, 'Cm', 7, null, 'actinide'], [97, 'Bk', 7, null, 'actinide'],
  [98, 'Cf', 7, null, 'actinide'], [99, 'Es', 7, null, 'actinide'], [100, 'Fm', 7, null, 'actinide'],
  [101, 'Md', 7, null, 'actinide'], [102, 'No', 7, null, 'actinide'], [103, 'Lr', 7, null, 'actinide'],
  [104, 'Rf', 7, 4, 'transition_metal'], [105, 'Db', 7, 5, 'transition_metal'], [106, 'Sg', 7, 6, 'transition_metal'],
  [107, 'Bh', 7, 7, 'transition_metal'], [108, 'Hs', 7, 8, 'transition_metal'], [109, 'Mt', 7, 9, 'transition_metal'],
  [110, 'Ds', 7, 10, 'transition_metal'], [111, 'Rg', 7, 11, 'transition_metal'], [112, 'Cn', 7, 12, 'transition_metal'],
  [113, 'Nh', 7, 13, 'post_transition'], [114, 'Fl', 7, 14, 'post_transition'], [115, 'Mc', 7, 15, 'post_transition'],
  [116, 'Lv', 7, 16, 'post_transition'], [117, 'Ts', 7, 17, 'halogen'], [118, 'Og', 7, 18, 'noble_gas'],
];

export const PERIODIC_ELEMENTS: readonly PeriodicElement[] = ROWS.map(
  ([number, symbol, period, group, family]) => ({
    number,
    symbol,
    period,
    group,
    family,
    ...(family === 'lanthanide' ? { row: 'lanthanides' as const } : {}),
    ...(family === 'actinide' ? { row: 'actinides' as const } : {}),
  }),
);

export const periodicElement = (number: number): PeriodicElement | undefined => PERIODIC_ELEMENTS[number - 1];
