'use client';

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { periodicElement } from '@syntara/shared';
import { AppLink } from '../../app-link';
import { GROUP_COLORS, useAtlasData, useAtlasSubject } from './atlas-data';
import { atlasHref, elementHref } from './routes';
import type { Scientist } from './scientist-parts';

/**
 * «Ключевые факты» окна учёного (REQ-SCI-07): Годы жизни · Место рождения · Страна · Область науки · Главное открытие ·
 * Награды. Данные — scientists.yaml (S1b), годы и открытие — лента (timeline.yaml); нет наград — строки нет (В-1).
 */
export function KeyFacts({ scientist: s }: { scientist: Scientist }) {
  const t = useTranslations('atlas.sci.facts');
  const d = s.data;
  if (!d) return null;
  const rows: Array<[string, string | null]> = [
    ['lived', s.lived ? `${s.lived.from}–${s.lived.to}` : null],
    ['born', d.born],
    ['country', d.country],
    ['field', d.field],
    ['discovery', s.discovery || null],
    ['awards', d.awards],
  ];
  return (
    <section className="sci-facts" aria-labelledby="sci-facts-title" data-testid="atlas-sci-facts">
      <h4 id="sci-facts-title">{t('title')}</h4>
      <dl>
        {rows
          .filter((r): r is [string, string] => Boolean(r[1]))
          .map(([key, value]) => (
            <div key={key} className="sci-facts-row" data-key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

/**
 * «Связанные элементы» (REQ-SCI-08, BR-SCI-02): чипы в стиле атласа — символ, название, цвет семейства, подпись связи.
 * Элемент с уроком открывает окно элемента; без урока — неактивный чип «Скоро» с переходом к ячейке на виде «Таблица».
 */
export function RelatedElements({ scientist: s }: { scientist: Scientist }) {
  const t = useTranslations('atlas');
  const tp = useTranslations('student.periodicTable');
  const subjectId = useAtlasSubject();
  const atlas = useAtlasData();
  const elements = s.data?.elements ?? [];
  if (!elements.length) return null;
  const lessons = new Map((atlas.data?.elements ?? []).map((e) => [e.number, e]));
  return (
    <section className="sci-elements" aria-labelledby="sci-elements-title" data-testid="atlas-sci-elements">
      <h4 id="sci-elements-title">{t('sci.elements.title')}</h4>
      <ul>
        {elements.map(({ number, relation }) => {
          const p = periodicElement(number);
          if (!p) return null;
          const lesson = lessons.get(number);
          const name = lesson?.title ?? tp(`elements.${p.symbol}`);
          const rel = t(`sci.rel.${relation}`, { gender: s.data?.gender ?? 'other' });
          const style = { '--chip-color': GROUP_COLORS[p.family] ?? '#888' } as CSSProperties;
          const body = (
            <>
              <span className="sci-el-tile" aria-hidden="true">
                <span className="sci-el-number">{number}</span>
                <span className="sci-el-symbol">{p.symbol}</span>
              </span>
              <span className="sci-el-text">
                <span className="sci-el-rel">{rel}</span>
                <span className="sci-el-name">{name}</span>
                {lesson ? null : <span className="sci-el-soon">{tp('soon')}</span>}
              </span>
            </>
          );
          return (
            <li key={number}>
              {lesson ? (
                <AppLink
                  href={elementHref(subjectId, lesson.code)}
                  className="sci-el-chip"
                  style={style}
                  data-testid="atlas-sci-element"
                  data-number={number}
                >
                  {body}
                </AppLink>
              ) : (
                <AppLink
                  href={`${atlasHref(subjectId, 'explore')}?view=table&cell=${number}`}
                  className="sci-el-chip soon"
                  style={style}
                  aria-label={t('sci.elements.soonLabel', { rel, name })}
                  title={t('sci.elements.soonHint')}
                  data-testid="atlas-sci-element"
                  data-number={number}
                  data-soon="true"
                >
                  {body}
                </AppLink>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
