'use client';

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  ELEMENT_FAMILIES,
  PERIODIC_ELEMENTS,
  type ElementFamily,
  type PeriodicElement,
} from '@syntara/shared';
import { cn, SegmentedControl } from '@syntara/ui';
import { AppLink } from '../app-link';

type Status = 'mastered' | 'started' | 'not_started' | undefined;

/** Ряд и столбец ячейки: периоды 1–7 — ряды 0–6, лантаноиды и актиноиды — ряды 7 и 8 со столбца 3. */
function position(e: PeriodicElement): [number, number] {
  if (e.row === 'lanthanides') return [7, 2 + e.number - 57];
  if (e.row === 'actinides') return [8, 2 + e.number - 89];
  return [e.period - 1, e.group! - 1];
}

const ROWS = 9;
const COLS = 18;
const familyStyle = (family: ElementFamily): CSSProperties => ({
  backgroundColor: `color-mix(in srgb, var(--family-${family}) var(--family-mix), var(--surface))`,
  borderColor: `var(--family-${family})`,
});

/**
 * Блок «Периодическая таблица» на странице предмета (REQ-PTBL-01…08): 118 элементов в стандартной раскладке;
 * элемент с уроком — ссылка, без урока — «Скоро»; у ученика — статус темы. Легенда-фильтр подсвечивает семейство.
 * Клавиатура: роль grid, стрелки, Home/End, Enter открывает урок. На телефоне таблица прокручивается внутри блока;
 * есть вид «Списком». Анимаций нет при «Экономии трафика» и prefers-reduced-motion (tokens.css).
 */
export default function PeriodicTable({
  elements,
  statuses,
}: {
  /** Номер элемента → опубликованный урок (API-S-18 / API-PUB-12, periodicTable.elements). */
  elements: Array<{ number: number; topicId: string }>;
  /** Статус темы ученика; у гостя — пусто. */
  statuses: Map<string, Status>;
}) {
  const t = useTranslations('student.periodicTable');
  const [view, setView] = useState<'table' | 'list'>('table');
  const [family, setFamily] = useState<ElementFamily | null>(null);
  const [focused, setFocused] = useState(1);
  const cells = useRef(new Map<number, HTMLElement>());
  const topicOf = useMemo(() => new Map(elements.map((e) => [e.number, e.topicId])), [elements]);
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

  const info = (e: PeriodicElement) => {
    const topicId = topicOf.get(e.number);
    const status = topicId ? statuses.get(topicId) : undefined;
    const name = t(`elements.${e.symbol}`);
    const state = !topicId
      ? t('soon')
      : status === 'mastered'
        ? t('mastered')
        : status === 'started'
          ? t('started')
          : null;
    const label = [
      t('cell', { name, symbol: e.symbol, number: e.number, family: t(`families.${e.family}`) }),
      state,
    ]
      .filter(Boolean)
      .join(', ');
    return { topicId, status, name, label };
  };

  // REQ-PTBL-07: стрелки — к ближайшему элементу в направлении, Home/End — край ряда.
  const move = (event: KeyboardEvent) => {
    const e = PERIODIC_ELEMENTS[focused - 1]!;
    const [r, c] = position(e);
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

  const cell = (e: PeriodicElement) => {
    const { topicId, status, name, label } = info(e);
    const dimmed = family !== null && e.family !== family;
    const common = {
      'aria-label': label,
      title: topicId ? name : `${name} — ${t('soon')}`,
      tabIndex: e.number === focused ? 0 : -1,
      ref: (node: HTMLElement | null) => {
        if (node) cells.current.set(e.number, node);
        else cells.current.delete(e.number);
      },
      onFocus: () => setFocused(e.number),
      'data-testid': 'ptable-cell',
      'data-number': e.number,
      'data-family': e.family,
      'data-status': topicId ? (status ?? 'none') : 'soon',
      'data-dimmed': dimmed || undefined,
      style: familyStyle(e.family),
      className: cn(
        'relative flex h-full min-h-14 flex-col items-center justify-center rounded-[var(--radius-item)] border px-0.5 py-1 text-center leading-tight transition-opacity duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        topicId ? 'hover:brightness-110' : 'cursor-default border-dashed text-[var(--text-muted)]',
        dimmed && 'opacity-25',
      ),
    };
    const content = (
      <>
        <span aria-hidden="true" className="self-start text-[10px]">
          {e.number}
        </span>
        <span aria-hidden="true" className="text-base font-bold">
          {e.symbol}
        </span>
        <span aria-hidden="true" className="hidden w-full truncate text-[9px] xl:block">
          {name}
        </span>
        {status === 'mastered' || status === 'started' ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute right-1 top-1 size-2 rounded-full',
              status === 'mastered' ? 'bg-[var(--success)]' : 'bg-[var(--accent)]',
            )}
          />
        ) : null}
      </>
    );
    return topicId ? (
      <AppLink href={`/learn/topics/${topicId}`} {...common}>
        {content}
      </AppLink>
    ) : (
      <span role="link" aria-disabled="true" {...common}>
        {content}
      </span>
    );
  };

  return (
    <section aria-labelledby="ptable-title" className="flex flex-col gap-4" data-testid="periodic-table">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ptable-title" className="text-cabinet-block font-semibold">
          {t('title')}
        </h2>
        <SegmentedControl
          label={t('view')}
          value={view}
          onValueChange={(v) => setView(v as 'table' | 'list')}
          options={[
            { value: 'table', label: t('asTable') },
            { value: 'list', label: t('asList') },
          ]}
        />
      </div>
      {/* REQ-PTBL-03, REQ-PTBL-06: легенда — она же фильтр; цвет не единственный носитель смысла. */}
      <div role="group" aria-label={t('legend')} className="flex flex-wrap gap-2" data-testid="ptable-legend">
        {ELEMENT_FAMILIES.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={family === f}
            onClick={() => setFamily(family === f ? null : f)}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-3 text-sm first-letter:uppercase',
              family === f ? 'border-[var(--text)] font-semibold' : 'border-[var(--border)]',
            )}
          >
            <span aria-hidden="true" className="size-3 rounded-full border" style={familyStyle(f)} />
            <span className="first-letter:uppercase">{t(`families.${f}`)}</span>
          </button>
        ))}
      </div>
      {view === 'table' ? (
        // REQ-PTBL-08: прокрутка — внутри блока, страница по горизонтали не прокручивается.
        <div className="overflow-x-auto pb-2" data-testid="ptable-scroll">
          <div
            role="grid"
            tabIndex={-1}
            aria-label={t('title')}
            onKeyDown={move}
            className="grid min-w-[56rem] grid-cols-[repeat(18,minmax(0,1fr))] gap-1"
          >
            {matrix.map((row, r) => (
              <div role="row" key={r} className={cn('contents', r === 7 && '[&>*]:mt-3')}>
                {row.map((n, c) => {
                  const marker = (r === 5 || r === 6) && c === 2 ? (r === 5 ? '57–71' : '89–103') : null;
                  const rowLabel = c === 0 && r >= 7 ? t(r === 7 ? 'lanthanides' : 'actinides') : null;
                  return (
                    <div role="gridcell" key={c} className="min-h-14">
                      {n ? (
                        cell(PERIODIC_ELEMENTS[n - 1]!)
                      ) : marker || rowLabel ? (
                        <span
                          aria-hidden="true"
                          className="flex h-full items-center justify-center text-center text-[10px] text-[var(--text-muted)]"
                        >
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
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="ptable-list">
          {PERIODIC_ELEMENTS.filter((e) => family === null || e.family === family).map((e) => {
            const { topicId, name, label, status } = info(e);
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-item)] border font-bold"
                  style={familyStyle(e.family)}
                >
                  {e.symbol}
                </span>
                <span aria-hidden="true" className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {e.number}. {name}
                  </span>
                  <span className="truncate text-xs text-[var(--text-muted)]">
                    {!topicId
                      ? t('soon')
                      : status === 'mastered'
                        ? t('mastered')
                        : status === 'started'
                          ? t('started')
                          : t(`families.${e.family}`)}
                  </span>
                </span>
              </>
            );
            const className =
              'flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-2';
            return (
              <li key={e.number} data-testid="ptable-list-item">
                {topicId ? (
                  <AppLink
                    href={`/learn/topics/${topicId}`}
                    aria-label={label}
                    className={`${className} hover:border-[var(--border-strong)]`}
                  >
                    {body}
                  </AppLink>
                ) : (
                  <span className={`${className} text-[var(--text-muted)]`}>
                    <span className="sr-only">{label}</span>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
