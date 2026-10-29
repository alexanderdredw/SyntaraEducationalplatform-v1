'use client';

import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PERIODIC_ELEMENTS, type PeriodicElement } from '@syntara/shared';
import { type AtlasElement, GROUP_COLORS } from './atlas-data';
import { COLS, position } from './atlas-table';

/** Ряды вопроса: периоды 1–6 и лантаноиды — элементы с уроками (1–60); 7-й период и актиноиды уроков не имеют. */
const QUIZ_ROWS = [0, 1, 2, 3, 4, 5, 7];
/** Период ряда (лантаноиды — 6-й). */
const periodOf = (row: number) => (row === 7 ? 6 : row + 1);

/**
 * Вопрос `table-click` квиза атласа (REQ-TST-10.3): таблица Менделеева в стиле атласа (сетка блока C4 — atlas-table),
 * в ячейках только символы — названия выдали бы ответ. Выбрать можно только 60 элементов с уроками (остальные —
 * пустые рамки); стрелки,
 * Home/End двигают фокус, Enter/пробел выбирают ячейку; диктор слышит символ, период и группу. На телефоне таблица
 * прокручивается внутри блока. «50/50» — подсвечены два периода (`rows`), остальные приглушены. После ответа —
 * правильная ячейка зелёным, ошибочная — красным.
 */
export function TablePick({
  elements,
  selected,
  onSelect,
  rows,
  correctId,
  chosenId,
  disabled,
  labelledBy,
}: {
  elements: AtlasElement[];
  selected: string | null;
  onSelect: (topicId: string) => void;
  rows: number[];
  correctId: string | null;
  chosenId: string | null;
  disabled: boolean;
  labelledBy: string;
}) {
  const t = useTranslations('test.table');
  const lessons = useMemo(() => new Map(elements.map((e) => [e.number, e])), [elements]);
  const matrix = useMemo(() => {
    const m: Array<Array<number | null>> = QUIZ_ROWS.map(() => Array<number | null>(COLS).fill(null));
    for (const e of PERIODIC_ELEMENTS) {
      const [r, c] = position(e);
      const i = QUIZ_ROWS.indexOf(r);
      if (i >= 0) m[i]![c] = e.number;
    }
    return m;
  }, []);
  const [focused, setFocused] = useState(() => elements[0]?.number ?? 1);
  const cells = useRef(new Map<number, HTMLButtonElement>());

  const at = (n: number) => {
    const [r, c] = position(PERIODIC_ELEMENTS[n - 1]!);
    return [QUIZ_ROWS.indexOf(r), c] as const;
  };
  const move = (event: KeyboardEvent) => {
    const [r, c] = at(focused);
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    let next: number | null = null;
    const ok = (n: number | null | undefined): n is number => Boolean(n && lessons.has(n));
    if (event.key in step) {
      const [dr, dc] = step[event.key]!;
      for (
        let rr = r + dr, cc = c + dc;
        rr >= 0 && rr < matrix.length && cc >= 0 && cc < COLS;
        rr += dr, cc += dc
      ) {
        if (ok(matrix[rr]![cc])) {
          next = matrix[rr]![cc]!;
          break;
        }
      }
    } else if (event.key === 'Home') next = matrix[r]!.find(ok) ?? null;
    else if (event.key === 'End') next = [...matrix[r]!].reverse().find(ok) ?? null;
    else return;
    event.preventDefault();
    if (next) {
      setFocused(next);
      cells.current.get(next)?.focus();
    }
  };

  const cell = (p: PeriodicElement) => {
    const lesson = lessons.get(p.number);
    const color = GROUP_COLORS[p.family] ?? '#888';
    const dimmed = rows.length > 0 && !rows.includes(p.period);
    // Элементы без урока не выбираются: пустая рамка — форма таблицы видна, текста (и проблем контраста) нет.
    if (!lesson) return <span aria-hidden="true" className="atlas-ptable-cell atest-cell" />;
    const state =
      correctId === lesson.topicId
        ? 'correct'
        : chosenId === lesson.topicId
          ? 'wrong'
          : selected === lesson.topicId
            ? 'selected'
            : undefined;
    const label = p.group
      ? t('cell', { symbol: p.symbol, period: p.period, group: p.group })
      : t('cellRow', { symbol: p.symbol, period: p.period });
    return (
      <button
        type="button"
        ref={(node) => {
          if (node) cells.current.set(p.number, node);
          else cells.current.delete(p.number);
        }}
        className="atlas-ptable-cell has-lesson atest-cell"
        style={{ '--cell-color': color, opacity: dimmed ? 0.25 : undefined } as CSSProperties}
        tabIndex={p.number === focused ? 0 : -1}
        aria-label={label}
        aria-pressed={selected === lesson.topicId}
        aria-disabled={disabled || undefined}
        data-state={state}
        data-period={p.period}
        data-testid="atest-cell"
        data-symbol={p.symbol}
        onFocus={() => setFocused(p.number)}
        onClick={() => !disabled && onSelect(lesson.topicId)}
      >
        <span aria-hidden="true" className="atlas-ptable-symbol">
          {p.symbol}
        </span>
      </button>
    );
  };

  return (
    <div className="atest-table" data-testid="atest-table">
      <div className="atlas-ptable-scroll">
        <div
          role="grid"
          tabIndex={-1}
          aria-labelledby={labelledBy}
          aria-describedby="atest-table-help"
          onKeyDown={move}
          className="atlas-ptable-grid"
        >
          {matrix.map((row, r) => (
            <div
              role="row"
              key={r}
              className={`atlas-ptable-row${QUIZ_ROWS[r] === 7 ? ' gap-before' : ''}`}
              data-period={periodOf(QUIZ_ROWS[r]!)}
            >
              {row.map((n, c) => {
                const marker = QUIZ_ROWS[r] === 5 && c === 2 ? '57–71' : null;
                if (QUIZ_ROWS[r] === 7 && c < 2)
                  return c === 0 ? <div role="gridcell" key={c} className="span-2" /> : null;
                return (
                  <div role="gridcell" key={c}>
                    {n ? (
                      cell(PERIODIC_ELEMENTS[n - 1]!)
                    ) : marker ? (
                      <span aria-hidden="true" className="atlas-ptable-marker">
                        {marker}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p id="atest-table-help" className="atlas-sr-only">
        {t('label')}
      </p>
      <p className="atest-table-status" aria-live="polite">
        {rows.length && !chosenId ? t('hint') : ''}
        {selected && !chosenId ? (
          <span className="atest-table-picked">
            {' '}
            {t('picked', { symbol: elements.find((e) => e.topicId === selected)?.symbol ?? '' })}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Схема Бора (REQ-TST-10.2): ядро и электроны по оболочкам в стиле атласа — без символа, номера и других надписей
 * (логика — scripts/content-art/atoms.mjs). Для диктора — число оболочек и электроны на каждой.
 */
export function BohrDiagram({ shells }: { shells: number[] }) {
  const t = useTranslations('test.bohr');
  const size = 240;
  const c = size / 2;
  const nucleus = 16;
  const step = (c - nucleus - 10) / Math.max(1, shells.length);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="atest-bohr"
      role="img"
      aria-label={t('label', { count: shells.length, list: shells.join(', ') })}
      data-testid="atest-bohr"
    >
      {shells.map((count, i) => {
        const r = nucleus + step * (i + 1);
        const offset = -Math.PI / 2 + i * 0.37;
        return (
          <g key={i}>
            <circle cx={c} cy={c} r={r} className="atest-bohr-shell" />
            {Array.from({ length: count }, (_, k) => {
              const a = offset + (2 * Math.PI * k) / count;
              return (
                <circle
                  key={k}
                  cx={(c + r * Math.cos(a)).toFixed(1)}
                  cy={(c + r * Math.sin(a)).toFixed(1)}
                  r={3.4}
                  className="atest-bohr-electron"
                />
              );
            })}
          </g>
        );
      })}
      <circle cx={c} cy={c} r={nucleus} className="atest-bohr-nucleus" />
    </svg>
  );
}
