'use client';

import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PERIODIC_ELEMENTS, type PeriodicElement } from '@syntara/shared';
import { AppLink } from '../../app-link';
import { type AtlasElement, GROUP_COLORS, useAtlasSubject } from './atlas-data';
import { elementHref } from './routes';

/** Ряд и столбец ячейки: периоды 1–7 — ряды 0–6, лантаноиды и актиноиды — ряды 7 и 8 со столбца 3 (как в C4). */
function position(e: PeriodicElement): [number, number] {
  if (e.row === 'lanthanides') return [7, 2 + e.number - 57];
  if (e.row === 'actinides') return [8, 2 + e.number - 89];
  return [e.period - 1, e.group! - 1];
}

const ROWS = 9;
const COLS = 18;

/**
 * Вид «Таблица» в Explore (решение 3, REQ-ATL-03): 118 элементов, 60 — с уроками (ячейка открывает окно элемента),
 * остальные — «Скоро». Логика и доступность — блока C4 (REQ-PTBL-02…08: grid, стрелки, Home/End, подписи для
 * диктора, статусы ученика); вид — атласа: тёмная плитка, цвета групп атласа, свечение рамки. Фильтр по группе
 * подсвечивает свою группу. На телефоне таблица прокручивается внутри блока.
 */
export default function AtlasTable({
  elements,
  group,
  query,
}: {
  elements: AtlasElement[];
  group: string;
  query: string;
}) {
  const t = useTranslations('student.periodicTable');
  const ta = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const [focused, setFocused] = useState(1);
  const cells = useRef(new Map<number, HTMLElement>());
  const lessons = useMemo(() => new Map(elements.map((e) => [e.number, e])), [elements]);
  const matrix = useMemo(() => {
    const m: Array<Array<number | null>> = Array.from({ length: ROWS }, () =>
      Array<number | null>(COLS).fill(null),
    );
    for (const e of PERIODIC_ELEMENTS) {
      const [r, c] = position(e);
      m[r]![c] = e.number;
    }
    return m;
  }, []);

  const move = (event: KeyboardEvent) => {
    const [r, c] = position(PERIODIC_ELEMENTS[focused - 1]!);
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    let next: number | null = null;
    if (event.key in step) {
      const [dr, dc] = step[event.key]!;
      for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS; rr += dr, cc += dc) {
        if (matrix[rr]![cc]) {
          next = matrix[rr]![cc]!;
          break;
        }
      }
    } else if (event.key === 'Home') next = matrix[r]!.find((n) => n !== null) ?? null;
    else if (event.key === 'End') next = [...matrix[r]!].reverse().find((n) => n !== null) ?? null;
    else return;
    event.preventDefault();
    if (next) {
      setFocused(next);
      cells.current.get(next)?.focus();
    }
  };

  const cell = (p: PeriodicElement) => {
    const lesson = lessons.get(p.number);
    const name = lesson?.title ?? t(`elements.${p.symbol}`);
    const color = GROUP_COLORS[p.family] ?? '#888';
    const dimmed = group !== 'all' && p.family !== group;
    const state = !lesson
      ? t('soon')
      : lesson.status === 'mastered'
        ? t('mastered')
        : lesson.status === 'started'
          ? t('started')
          : null;
    const label = [
      t('cell', { name, symbol: p.symbol, number: p.number, family: ta(`group.${p.family}`) }),
      state,
    ]
      .filter(Boolean)
      .join(', ');
    const common = {
      'aria-label': label,
      title: lesson ? name : `${name} — ${t('soon')}`,
      tabIndex: p.number === focused ? 0 : -1,
      ref: (node: HTMLElement | null) => {
        if (node) cells.current.set(p.number, node);
        else cells.current.delete(p.number);
      },
      onFocus: () => setFocused(p.number),
      className: `atlas-ptable-cell${lesson ? ' has-lesson' : ''}`,
      style: { '--cell-color': color, opacity: dimmed ? 0.2 : undefined } as React.CSSProperties,
      'data-testid': 'atlas-ptable-cell',
      'data-number': p.number,
      'data-family': p.family,
      'data-status': lesson ? (lesson.status ?? 'none') : 'soon',
    };
    const content = (
      <>
        <span aria-hidden="true" className="atlas-ptable-number">
          {p.number}
        </span>
        <span aria-hidden="true" className="atlas-ptable-symbol">
          {p.symbol}
        </span>
        <span aria-hidden="true" className="atlas-ptable-name">
          {name}
        </span>
        {lesson?.status === 'mastered' || lesson?.status === 'started' ? (
          <span aria-hidden="true" className="atlas-status-dot" data-status={lesson.status} />
        ) : null}
      </>
    );
    return lesson ? (
      <AppLink href={`${elementHref(subjectId, lesson.code)}${query}`} scroll={false} {...common}>
        {content}
      </AppLink>
    ) : (
      <span role="link" aria-disabled="true" {...common}>
        {content}
      </span>
    );
  };

  return (
    <div className="atlas-ptable" data-testid="atlas-table">
      <div className="atlas-ptable-scroll">
        <div role="grid" tabIndex={-1} aria-label={t('title')} onKeyDown={move} className="atlas-ptable-grid">
          {matrix.map((row, r) => (
            <div role="row" key={r} className={`atlas-ptable-row${r === 7 ? ' gap-before' : ''}`}>
              {row.map((n, c) => {
                const marker = (r === 5 || r === 6) && c === 2 ? (r === 5 ? '57–71' : '89–103') : null;
                const rowLabel = c === 0 && r >= 7 ? t(r === 7 ? 'lanthanides' : 'actinides') : null;
                if (r >= 7 && c === 1) return null;
                return (
                  <div role="gridcell" key={c} className={rowLabel ? 'span-2' : undefined}>
                    {n ? (
                      cell(PERIODIC_ELEMENTS[n - 1]!)
                    ) : marker || rowLabel ? (
                      <span aria-hidden="true" className="atlas-ptable-marker">
                        {marker ?? rowLabel}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
