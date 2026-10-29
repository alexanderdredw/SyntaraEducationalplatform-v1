'use client';

import { useSearchParams } from 'next/navigation';
import { ELEMENT_FAMILIES } from '@syntara/shared';

export const EXPLORE_VIEWS = ['cards', 'table', 'list'] as const;
export type ExploreView = (typeof EXPLORE_VIEWS)[number];
export const EXPLORE_SORTS = ['number', 'alpha'] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];
export const PROGRESS_FILTERS = ['not_started', 'started', 'mastered'] as const;
export type ProgressFilter = (typeof PROGRESS_FILTERS)[number];

export interface ExploreState {
  q: string;
  families: string[];
  statuses: ProgressFilter[];
  sort: ExploreSort;
  view: ExploreView;
}

const list = <T extends string>(value: string | null, allowed: readonly T[]): T[] =>
  (value ?? '')
    .split(',')
    .filter((v): v is T => (allowed as readonly string[]).includes(v))
    .filter((v, i, a) => a.indexOf(v) === i);

/** Строка запроса без значений по умолчанию (адрес короче, «назад» возвращает прежнее состояние). */
export function exploreSearch(s: ExploreState): string {
  const p = new URLSearchParams();
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.families.length) p.set('family', s.families.join(','));
  if (s.statuses.length) p.set('status', s.statuses.join(','));
  if (s.sort !== 'number') p.set('sort', s.sort);
  if (s.view !== 'cards') p.set('view', s.view);
  const str = p.toString();
  return str ? `?${str}` : '';
}

/**
 * Состояние «Исследовать» в адресе (docs/EXPLORE_TZ.md, REQ-EXP-02.6): ?q=&family=&status=&sort=&view= — сохраняется
 * при открытии и закрытии окна элемента. Старый ?group= (до И1) читается как одно семейство.
 */
export function useExploreQuery() {
  const params = useSearchParams();
  const state: ExploreState = {
    q: params.get('q') ?? '',
    families: list(params.get('family') ?? params.get('group'), ELEMENT_FAMILIES),
    statuses: list(params.get('status'), PROGRESS_FILTERS),
    sort: list(params.get('sort'), EXPLORE_SORTS)[0] ?? 'number',
    view: list(params.get('view'), EXPLORE_VIEWS)[0] ?? 'cards',
  };
  const query = (next: Partial<ExploreState>) => exploreSearch({ ...state, ...next });
  return { ...state, query };
}
