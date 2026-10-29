'use client';

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { elementBlock, PERIODIC_ELEMENTS, periodicElement } from '@syntara/shared';
import { AppLink } from '../../app-link';
import { type AtlasElement, GROUP_COLORS, useAtlasSubject } from './atlas-data';
import { COLS, position, ROWS } from './atlas-table';
import { elementHref } from './routes';

const DIRS = [
  ['up', -1, 0],
  ['left', 0, -1],
  ['right', 0, 1],
  ['down', 1, 0],
] as const;

/**
 * Мини-таблица окна элемента (docs/EXPLORE_TZ.md, REQ-EXP-06): схема 18 × 7 и ряды лантаноидов и актиноидов,
 * текущий элемент подсвечен, соседи сверху, снизу, слева и справа с уроком — ссылки с названием (под схемой);
 * сама схема — aria-hidden. Подпись — «Период {p} · Группа {g} · {блок}-блок». На телефоне — точки без подписей.
 */
export function MiniTable({
  element,
  lessons,
  query,
}: {
  element: AtlasElement;
  lessons: Map<number, AtlasElement>;
  query: string;
}) {
  const t = useTranslations('atlas.mini');
  const subjectId = useAtlasSubject();
  const self = periodicElement(element.number)!;
  const [r0, c0] = position(self);
  const at = new Map(PERIODIC_ELEMENTS.map((e) => [position(e).join(','), e]));
  const neighbors = DIRS.flatMap(([dir, dr, dc]) => {
    const e = at.get(`${r0 + dr},${c0 + dc}`);
    const lesson = e ? lessons.get(e.number) : undefined;
    return e && lesson ? [{ dir, e, lesson }] : [];
  });
  const block = elementBlock(self);
  const caption =
    self.group === null
      ? t('captionRow', {
          period: self.period,
          row: t(self.row === 'actinides' ? 'actinides' : 'lanthanides'),
          block,
        })
      : t('caption', { period: self.period, group: self.group, block });
  return (
    <section className="mini-table" aria-labelledby="mini-table-title" data-testid="atlas-mini-table">
      <h4 id="mini-table-title">{t('title')}</h4>
      <div
        className="mini-grid"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {PERIODIC_ELEMENTS.map((e) => {
          const [r, c] = position(e);
          const near = neighbors.some((n) => n.e.number === e.number);
          return (
            <span
              key={e.number}
              className={`mini-cell${lessons.has(e.number) ? ' has-lesson' : ''}${near ? ' near' : ''}`}
              data-current={e.number === element.number || undefined}
              style={
                {
                  gridRow: r + 1 + (r >= 7 ? 1 : 0),
                  gridColumn: c + 1,
                  '--cell-color': GROUP_COLORS[e.family] ?? '#888',
                } as CSSProperties
              }
            >
              <span className="mini-symbol">{e.symbol}</span>
            </span>
          );
        })}
        <span className="mini-gap" style={{ gridRow: ROWS - 1, gridColumn: '1 / -1' }} />
      </div>
      <p className="mini-caption" data-testid="atlas-mini-caption">
        {caption}
      </p>
      {neighbors.length ? (
        <ul className="mini-neighbors" aria-label={t('neighbors')}>
          {neighbors.map(({ dir, e, lesson }) => (
            <li key={dir}>
              <AppLink
                href={`${elementHref(subjectId, lesson.code)}${query}`}
                scroll={false}
                replace
                className="mini-neighbor"
                style={{ '--cell-color': GROUP_COLORS[e.family] ?? '#888' } as CSSProperties}
                data-testid="atlas-mini-neighbor"
                data-dir={dir}
              >
                <span aria-hidden="true" className="mini-arrow">
                  {{ up: '↑', down: '↓', left: '←', right: '→' }[dir]}
                </span>
                <span className="mini-neighbor-symbol" aria-hidden="true">
                  {e.symbol}
                </span>
                <span>{t(`dir.${dir}`, { name: lesson.title })}</span>
              </AppLink>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
