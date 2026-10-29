'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ELEMENT_FAMILIES, MASTERY_THRESHOLD, matchesElement, periodicElement } from '@syntara/shared';
import { useRouter } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import { type AtlasElement, GROUP_COLORS, useAtlasData, useAtlasLesson, useAtlasSubject } from './atlas-data';
import AtlasTable from './atlas-table';
import { useDialog } from './dialog';
import ElementWindow, { formatMass } from './element-window';
import {
  EXPLORE_SORTS,
  EXPLORE_VIEWS,
  type ExploreState,
  PROGRESS_FILTERS,
  type ProgressFilter,
  useExploreQuery,
} from './explore-query';
import { useAtlasViewer } from './gate';
import { atlasHref, elementHref } from './routes';

export { useExploreQuery } from './explore-query';

const statusOf = (e: AtlasElement): ProgressFilter => e.status ?? 'not_started';

/**
 * «Исследовать» (REQ-ATL-03; docs/EXPLORE_TZ.md, И1): шапка прогресса ученика с кольцами семейств (REQ-EXP-01),
 * панель инструментов — поиск, чипы семейств, фильтр прогресса, сортировка, вид «Карточки · Таблица · Список»
 * (REQ-EXP-02; состояние — в адресе), новая карточка с быстрым просмотром «i» (REQ-EXP-03). Окно элемента
 * (/explore/:code) — поверх: при закрытии фильтры и прокрутка сохраняются.
 */
export default function AtlasExplore({ code, test }: { code?: string; test?: boolean }) {
  const t = useTranslations('atlas');
  const locale = useLocale();
  const subjectId = useAtlasSubject();
  const atlas = useAtlasData();
  const viewer = useAtlasViewer();
  const state = useExploreQuery();
  const { q, families, statuses, sort, view, query } = state;
  const router = useRouter();
  const params = useSearchParams();
  const cell = Number(params.get('cell')) || undefined;
  const elements = useMemo(() => atlas.data?.elements ?? [], [atlas.data]);
  const student = viewer === 'student';
  const open = code ? elements.find((e) => e.code === code) : undefined;
  const [quick, setQuick] = useState<{ element: AtlasElement; trigger: HTMLElement } | null>(null);

  // Поиск: ввод — сразу в списке, адрес — через короткую паузу (replace, без лишних шагов «назад»).
  const [text, setText] = useState(q);
  // «Назад» меняет ?q= — поле ввода следует за адресом.
  const [shownQ, setShownQ] = useState(q);
  if (q !== shownQ) {
    setShownQ(q);
    setText(q);
  }

  // Любая смена фильтров берёт текущий текст поиска и отменяет отложенную запись поиска — иначе она перезапишет
  // адрес фильтра, пока тот ещё применяется.
  const timer = useRef<number | undefined>(undefined);
  const go = (next: Partial<ExploreState>, replace = false) => {
    window.clearTimeout(timer.current);
    const href = `${atlasHref(subjectId, 'explore')}${query({ q: text, ...next })}`;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };
  const latest = useRef(go);
  useEffect(() => {
    latest.current = go;
  });
  useEffect(() => {
    if (text === q) return;
    timer.current = window.setTimeout(() => latest.current({}, true), 250);
    return () => window.clearTimeout(timer.current);
  }, [text, q]);

  const shown = useMemo(() => {
    const list = elements.filter(
      (e) =>
        matchesElement(text, e) &&
        (!families.length || families.includes(e.group)) &&
        (!student || !statuses.length || statuses.includes(statusOf(e))),
    );
    return sort === 'alpha'
      ? [...list].sort((a, b) => a.title.localeCompare(b.title, locale))
      : [...list].sort((a, b) => a.number - b.number);
  }, [elements, text, families, statuses, sort, student, locale]);

  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const present = ELEMENT_FAMILIES.filter((f) => elements.some((e) => e.group === f));

  return (
    <section
      className="explore-section"
      id="view-explore"
      style={{ display: 'flex' }}
      data-testid="atlas-explore"
    >
      {student && elements.length ? (
        <ProgressHeader
          elements={elements}
          families={families}
          onFamily={(f) => go({ families: toggle(families, f) })}
        />
      ) : null}

      <div className="ex-toolbar" data-testid="atlas-toolbar">
        <div className="ex-search">
          <label htmlFor="atlas-search" className="atlas-sr-only">
            {t('explore.searchLabel')}
          </label>
          <span aria-hidden="true" className="ex-search-icon">
            ⌕
          </span>
          <input
            id="atlas-search"
            type="search"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            placeholder={t('explore.searchPlaceholder')}
            autoComplete="off"
            data-testid="atlas-search-input"
          />
        </div>

        <div className="ex-chips-wrap">
          <div
            className="ex-chips"
            role="group"
            aria-label={t('filter.title')}
            data-testid="atlas-family-chips"
          >
            <button
              type="button"
              className="ex-chip"
              aria-pressed={families.length === 0}
              onClick={() => go({ families: [] })}
              data-family="all"
            >
              {t('filter.all')}
            </button>
            {present.map((f) => (
              <button
                key={f}
                type="button"
                className="ex-chip"
                aria-pressed={families.includes(f)}
                style={{ '--chip-color': GROUP_COLORS[f] ?? '#888' } as CSSProperties}
                onClick={() => go({ families: toggle(families, f) })}
                data-family={f}
              >
                <span className="ex-chip-dot" aria-hidden="true" />
                {t(`group.${f}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="ex-row">
          {student ? (
            <div
              className="ex-seg"
              role="group"
              aria-label={t('explore.progressLabel')}
              data-testid="atlas-status-filter"
            >
              {PROGRESS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={statuses.includes(s)}
                  onClick={() => go({ statuses: toggle(statuses, s) })}
                  data-status={s}
                >
                  {t(`explore.status.${s}`)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="ex-seg" role="group" aria-label={t('explore.sortLabel')} data-testid="atlas-sort">
            {EXPLORE_SORTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sort === s}
                onClick={() => go({ sort: s })}
                data-sort={s}
              >
                {t(`explore.sort.${s}`)}
              </button>
            ))}
          </div>
          <div className="ex-seg" role="group" aria-label={t('view.label')} data-testid="atlas-view">
            {EXPLORE_VIEWS.map((v) => (
              <AppLink
                key={v}
                href={`${atlasHref(subjectId, 'explore')}${query({ q: text, view: v })}`}
                scroll={false}
                onClick={() => window.clearTimeout(timer.current)}
                aria-current={view === v ? 'true' : undefined}
                className={view === v ? 'active' : undefined}
                data-view={v}
              >
                {t(`view.${v}`)}
              </AppLink>
            ))}
          </div>
        </div>
        <p className="ex-count" aria-live="polite" data-testid="atlas-count">
          {t('explore.count', { count: view === 'table' ? elements.length : shown.length })}
        </p>
      </div>

      {view === 'table' ? (
        <AtlasTable elements={elements} families={families} search={text} query={query({})} target={cell} />
      ) : shown.length === 0 ? (
        <p className="ex-empty" data-testid="atlas-empty">
          {t('filter.empty')}
        </p>
      ) : view === 'list' ? (
        <ul className="ex-list" data-testid="atlas-list">
          {shown.map((e) => (
            <li key={e.code}>
              <ListRow element={e} href={`${elementHref(subjectId, e.code)}${query({})}`} student={student} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="ex-grid" data-testid="atlas-grid">
          {shown.map((e) => (
            <ElementCard
              key={e.code}
              element={e}
              href={`${elementHref(subjectId, e.code)}${query({})}`}
              testHref={`${elementHref(subjectId, e.code, true)}${query({})}`}
              student={student}
              onQuick={(trigger) => setQuick({ element: e, trigger })}
            />
          ))}
        </div>
      )}

      {quick ? (
        <QuickView
          element={quick.element}
          href={`${elementHref(subjectId, quick.element.code)}${query({})}`}
          onClose={() => setQuick(null)}
        />
      ) : null}

      {open ? (
        <ElementWindow
          key={open.code}
          element={open}
          all={elements}
          test={test === true}
          onClose={() => router.push(`${atlasHref(subjectId, 'explore')}${query({})}`, { scroll: false })}
        />
      ) : null}
    </section>
  );
}

/**
 * Шапка прогресса ученика (REQ-EXP-01): «Изучено {n} из 60», «Освоено (тест ≥ 80 %): {m}» — по статусам тем платформы
 * (в процессе или освоена / освоена), мини-кольца семейств (доля освоенных); нажатие — фильтр по семейству.
 */
function ProgressHeader({
  elements,
  families,
  onFamily,
}: {
  elements: AtlasElement[];
  families: string[];
  onFamily: (family: string) => void;
}) {
  const t = useTranslations('atlas');
  const studied = elements.filter((e) => e.status === 'started' || e.status === 'mastered').length;
  const mastered = elements.filter((e) => e.status === 'mastered').length;
  const rings = ELEMENT_FAMILIES.map((f) => {
    const list = elements.filter((e) => e.group === f);
    return { f, total: list.length, done: list.filter((e) => e.status === 'mastered').length };
  }).filter((r) => r.total);
  return (
    <div className="ex-progress" data-testid="atlas-progress">
      <div className="ex-progress-counts">
        <p data-testid="atlas-progress-studied">
          {t('explore.studied', { count: studied, total: elements.length })}
        </p>
        <p data-testid="atlas-progress-mastered">
          {t('explore.mastered', { count: mastered, threshold: MASTERY_THRESHOLD })}
        </p>
      </div>
      <ul className="ex-rings">
        {rings.map(({ f, total, done }) => {
          const share = done / total;
          const r = 15;
          const len = 2 * Math.PI * r;
          return (
            <li key={f}>
              <button
                type="button"
                className="ex-ring"
                title={t(`group.${f}`)}
                aria-pressed={families.includes(f)}
                aria-label={t('explore.ring', { family: t(`group.${f}`), done, total })}
                style={{ '--chip-color': GROUP_COLORS[f] ?? '#888' } as CSSProperties}
                onClick={() => onFamily(f)}
                data-family={f}
                data-testid="atlas-ring"
              >
                <svg viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r={r} className="ex-ring-track" />
                  <circle
                    cx="20"
                    cy="20"
                    r={r}
                    className="ex-ring-value"
                    strokeDasharray={`${len * share} ${len}`}
                    transform="rotate(-90 20 20)"
                  />
                </svg>
                <span aria-hidden="true" className="ex-ring-text">
                  {done}/{total}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** «Период p · Группа g» (у лантаноидов — «Период 6 · Лантаноиды») по справочнику C4 (REQ-EXP-03.3). */
function usePlace() {
  const t = useTranslations('atlas');
  const tp = useTranslations('student.periodicTable');
  return (number: number) => {
    const p = periodicElement(number);
    if (!p) return '';
    return p.group === null
      ? t('explore.placeRow', {
          period: p.period,
          row: tp(p.row === 'actinides' ? 'actinides' : 'lanthanides'),
        })
      : t('explore.place', { period: p.period, group: p.group });
  };
}

/** Плитка элемента в стиле таблицы: номер, символ, атомная масса (REQ-EXP-03.1). */
function Tile({ element: e, size = 'md' }: { element: AtlasElement; size?: 'sm' | 'md' }) {
  const locale = useLocale();
  return (
    <span className={`ex-tile ${size}`} aria-hidden="true">
      <span className="ex-tile-number">{e.number}</span>
      <span className="ex-tile-symbol">{e.symbol}</span>
      {e.mass !== null && size === 'md' ? (
        <span className="ex-tile-mass">{formatMass(e.mass, locale)}</span>
      ) : null}
    </span>
  );
}

function StatusMark({ element: e }: { element: AtlasElement }) {
  const t = useTranslations('atlas');
  if (e.status === 'mastered')
    return (
      <span className="ex-mark mastered" data-testid="atlas-card-mark" data-status="mastered">
        {t('explore.markMastered')}
      </span>
    );
  if (e.status === 'started')
    return (
      <span className="ex-mark started" data-testid="atlas-card-mark" data-status="started">
        {t('explore.markStudied')}
      </span>
    );
  return null;
}

/**
 * Карточка элемента (REQ-EXP-03): плитка с массой, иллюстрация целиком на фоне цвета семейства, «Период · Группа»,
 * описание полностью, прогресс ученика, быстрый просмотр «i» и «Тест». Название — ссылка на окно (вся карточка
 * нажимается), кнопки — поверх.
 */
function ElementCard({
  element: e,
  href,
  testHref,
  student,
  onQuick,
}: {
  element: AtlasElement;
  href: string;
  testHref: string;
  student: boolean;
  onQuick: (trigger: HTMLElement) => void;
}) {
  const t = useTranslations('atlas');
  const tp = useTranslations('student.periodicTable');
  const place = usePlace();
  const color = GROUP_COLORS[e.group] ?? e.color ?? '#888';
  const state = e.status === 'mastered' ? tp('mastered') : e.status === 'started' ? tp('started') : null;
  return (
    <article
      className="ex-card"
      style={{ '--fam': color } as CSSProperties}
      data-system={e.code}
      data-status={e.status}
      data-testid="atlas-card"
    >
      <div className="ex-card-visual" aria-hidden="true">
        {e.imageUrl ? (
          <img src={e.imageUrl} alt="" loading="lazy" decoding="async" width={1024} height={1024} />
        ) : null}
        <Tile element={e} />
        <span className="ex-family">{t(`group.${e.group}`)}</span>
      </div>
      <div className="ex-card-body">
        <h3 className="ex-card-title">
          <AppLink
            href={href}
            scroll={false}
            className="ex-card-link"
            aria-label={[
              tp('cell', {
                name: e.title,
                symbol: e.symbol,
                number: e.number,
                family: t(`group.${e.group}`),
              }),
              state,
            ]
              .filter(Boolean)
              .join(', ')}
            data-testid="atlas-card-link"
          >
            {e.title}
          </AppLink>
        </h3>
        <p className="ex-place" data-testid="atlas-card-place">
          {place(e.number)}
        </p>
        {e.description ? <p className="ex-desc">{e.description}</p> : null}
        {student ? (
          <div className="ex-card-progress">
            <div className="ex-bar-label">
              <span>
                {e.bestPercent !== null && e.bestPercent !== undefined
                  ? t('explore.best', { percent: e.bestPercent })
                  : t('explore.bestNone')}
              </span>
              <StatusMark element={e} />
            </div>
            <div
              className="ex-bar"
              role="progressbar"
              aria-label={t('explore.bestLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={e.bestPercent ?? 0}
            >
              <span style={{ width: `${e.bestPercent ?? 0}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="ex-card-actions">
        <button
          type="button"
          className="ex-icon-btn"
          aria-label={t('explore.quick', { name: e.title })}
          aria-haspopup="dialog"
          onClick={(ev) => onQuick(ev.currentTarget)}
          data-testid="atlas-quick-open"
        >
          i
        </button>
        <AppLink href={testHref} scroll={false} className="ex-test-btn" data-testid="atlas-card-test">
          {t('explore.test')}
          <span className="atlas-sr-only">: {e.title}</span>
        </AppLink>
      </div>
    </article>
  );
}

/** Вид «Список» (REQ-EXP-02.5): компактные строки — плитка, название, семейство, статус. */
function ListRow({ element: e, href, student }: { element: AtlasElement; href: string; student: boolean }) {
  const t = useTranslations('atlas');
  const color = GROUP_COLORS[e.group] ?? '#888';
  return (
    <AppLink
      href={href}
      scroll={false}
      className="ex-row-link"
      style={{ '--fam': color } as CSSProperties}
      data-testid="atlas-list-row"
    >
      <Tile element={e} size="sm" />
      <span className="ex-row-name">{e.title}</span>
      <span className="ex-row-family">{t(`group.${e.group}`)}</span>
      {student ? <StatusMark element={e} /> : null}
    </AppLink>
  );
}

/**
 * Быстрый просмотр «i» (REQ-EXP-03.7): 3 первых пункта «Основных фактов», интересный факт и «Открыть урок».
 * Компьютер — всплывающая карточка, телефон — нижняя шторка; Esc и крестик закрывают, фокус возвращается.
 */
function QuickView({
  element: e,
  href,
  onClose,
}: {
  element: AtlasElement;
  href: string;
  onClose: () => void;
}) {
  const t = useTranslations('atlas');
  const tc = useTranslations('common');
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const lesson = useAtlasLesson(e.topicId);
  useDialog(panel, onClose);
  // Нажатие на фон закрывает карточку (как панель фильтра); с клавиатуры — Esc (useDialog).
  useEffect(() => {
    const node = overlay.current;
    const onClick = (ev: MouseEvent) => {
      if (ev.target === node) onClose();
    };
    node?.addEventListener('click', onClick);
    return () => node?.removeEventListener('click', onClick);
  }, [onClose]);
  const facts = (lesson.data?.sections.find((s) => s.code === 'basic-facts')?.body ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .slice(0, 3)
    .map((l) => l.slice(2));
  return (
    <div ref={overlay} className="ex-quick-overlay">
      <div
        ref={panel}
        className="ex-quick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ex-quick-title"
        style={{ '--fam': GROUP_COLORS[e.group] ?? '#888' } as CSSProperties}
        data-testid="atlas-quick"
      >
        <button
          type="button"
          className="ex-quick-close"
          aria-label={tc('close')}
          onClick={onClose}
          data-testid="atlas-quick-close"
        >
          ×
        </button>
        <div className="ex-quick-head">
          <Tile element={e} />
          <h2 id="ex-quick-title">{e.title}</h2>
        </div>
        <h3>{t('explore.quickFacts')}</h3>
        {facts.length ? (
          <ul className="ex-quick-facts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : (
          <p className="ex-quick-loading">…</p>
        )}
        {e.funFact ? (
          <p className="ex-quick-fun">
            <b>{t('explore.funFact')}</b> {e.funFact}
          </p>
        ) : null}
        <AppLink href={href} scroll={false} className="btn btn-primary" data-testid="atlas-quick-lesson">
          {t('explore.openLesson')}
        </AppLink>
      </div>
    </div>
  );
}
