'use client';

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDayMonth, type Locale } from '@syntara/shared';
import { cn } from '@syntara/ui';
import type { components } from '@/lib/api/schema';

type Activity = components['schemas']['ActivityDto'];

const CELL = 14;
const GAP = 3;
const WEEKS = 12;
const PHONE_WEEKS = 8;

/** REQ-PRF-21.2: 5 уровней — 0, 1, 2–3, 4–6, 7+. */
export function activityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

const dayMs = 86_400_000;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
/** Полдень дня в UTC — для подписей Intl (день не сдвигается часовым поясом платформы). */
const noon = (day: string) => `${day}T07:00:00Z`;

/**
 * Календарь активности (REQ-PRF-21): 12 недель (столбцы) × Пн…Вс (строки), уровни цвета, подписи месяцев и дней
 * недели, легенда, итоги. Доступность: сетка — `role="img"` с итогом, фокусируемая; стрелки двигают выбранный день,
 * подсказка и `aria-live` озвучивают «12 октября: 3 занятия»; скрытая таблица — альтернатива. На телефоне видны
 * последние 8 недель, ранние — прокруткой влево.
 */
export function ActivityCalendar({ data, timeZone }: { data: Activity; timeZone: string }) {
  const t = useTranslations('account.calendar');
  const locale = useLocale() as Locale;
  const [active, setActive] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const { cells, weeks } = useMemo(() => {
    const byDate = new Map(data.days.map((d) => [d.date, d.count]));
    const total = Math.ceil(data.days.length / 7) * 7;
    const list = Array.from({ length: total }, (_, i) => {
      const date = addDays(data.from, i);
      return { date, count: byDate.get(date) ?? 0, future: date > data.to };
    });
    return { cells: list, weeks: total / 7 };
  }, [data]);

  useEffect(() => {
    // Телефон: сначала видны последние недели.
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cells]);

  const label = (i: number) =>
    t('day', { date: formatDayMonth(noon(cells[i]!.date), locale, timeZone), count: cells[i]!.count });
  const lastPast = cells.findLastIndex((c) => !c.future);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    if (!(e.key in moves) && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const from = active ?? lastPast;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? lastPast : from + moves[e.key]!;
    if (next >= 0 && next <= lastPast) setActive(next);
  };

  const months = Array.from({ length: weeks }, (_, w) => {
    const first = cells[w * 7]!.date;
    const prev = w > 0 ? cells[(w - 1) * 7]!.date : null;
    return !prev || first.slice(5, 7) !== prev.slice(5, 7)
      ? new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
          new Date(`${first}T00:00:00Z`),
        )
      : '';
  });
  const weekday = (offset: number) => {
    const s = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(`${addDays(data.from, offset)}T00:00:00Z`),
    );
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const summary = t('summary', { weeks: WEEKS, active: data.activeDays, streak: data.longestStreak });

  return (
    <div className="flex flex-col gap-3" data-testid="activity-calendar">
      {/* REQ-PRF-21.7: на телефоне видны последние 8 недель (подписи дней + 8 столбцов), ранние — прокруткой влево. */}
      <div
        ref={scroller}
        data-testid="activity-scroller"
        className="max-w-[var(--calendar-phone)] overflow-x-auto pb-1 sm:max-w-none"
        style={{ ['--calendar-phone' as string]: `${28 + 4 + PHONE_WEEKS * (CELL + GAP)}px` }}
      >
        <div className="inline-flex flex-col gap-1">
          {/* Подписи месяцев (REQ-PRF-21.4). */}
          <div
            aria-hidden="true"
            className="flex pl-7 text-[10px] text-[var(--text-muted)]"
            style={{ gap: GAP }}
          >
            {months.map((m, w) => (
              <span key={w} style={{ width: CELL }} className="overflow-visible whitespace-nowrap">
                {m}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <div
              aria-hidden="true"
              // Подписи дней закреплены слева: на телефоне сетка прокручена к последним неделям.
              className="sticky left-0 z-10 grid w-6 bg-[var(--surface)] text-[10px] text-[var(--text-muted)]"
              style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <span key={d} className="leading-[14px]">
                  {d % 2 === 0 && d < 6 ? weekday(d) : ''}
                </span>
              ))}
            </div>
            {/* REQ-PRF-21.6: сетка — role="img" с итогом и навигацией стрелками по дням (озвучивание — aria-live). */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              role="img"
              aria-label={summary}
              aria-describedby="activity-calendar-live activity-calendar-hint"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(null)}
              data-testid="activity-grid"
              className="relative grid grid-flow-col rounded-sm"
              style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, gridAutoColumns: `${CELL}px`, gap: GAP }}
            >
              {cells.map((c, i) => (
                <span
                  key={c.date}
                  data-date={c.date}
                  data-count={c.count}
                  data-level={c.future ? undefined : activityLevel(c.count)}
                  title={c.future ? undefined : label(i)}
                  onMouseEnter={() => !c.future && setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className={cn(
                    'rounded-[3px]',
                    i === active && 'ring-2 ring-[var(--text)] ring-offset-1 ring-offset-[var(--surface)]',
                  )}
                  style={{
                    width: CELL,
                    height: CELL,
                    background: c.future ? 'transparent' : `var(--activity-${activityLevel(c.count)})`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Подсказка о выбранном дне (наведение и стрелки) и озвучивание (REQ-PRF-21.3, 21.6). */}
      <p
        id="activity-calendar-live"
        aria-live="polite"
        className="min-h-5 text-xs"
        data-testid="activity-tooltip"
      >
        {active !== null ? label(active) : ''}
      </p>
      <p id="activity-calendar-hint" className="sr-only">
        {t('keyboardHint')}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        <div className="flex flex-col gap-0.5">
          <span data-testid="activity-active-days">
            {t('activeDays', { weeks: WEEKS, active: data.activeDays })}
          </span>
          <span data-testid="activity-longest">{t('longestStreak', { days: data.longestStreak })}</span>
        </div>
        <div aria-hidden="true" className="flex items-center gap-1">
          {t('less')}
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="rounded-[3px]"
              style={{ width: CELL - 2, height: CELL - 2, background: `var(--activity-${l})` }}
            />
          ))}
          {t('more')}
        </div>
      </div>
      {/* Таблица-альтернатива для экранного диктора (REQ-PRF-21.6). */}
      <table className="sr-only">
        <caption>{t('tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('dateCol')}</th>
            <th scope="col">{t('countCol')}</th>
          </tr>
        </thead>
        <tbody>
          {cells
            .filter((c) => !c.future && c.count > 0)
            .map((c) => (
              <tr key={c.date}>
                <td>{formatDayMonth(noon(c.date), locale, timeZone)}</td>
                <td>{c.count}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
