'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { AppLink } from '../../app-link';
import { type AtlasElement, GROUP_COLORS, useAtlasData, useAtlasSubject } from './atlas-data';
import { useDialog } from './dialog';
import { atlasHref, elementHref } from './routes';

const ElementWindow = dynamic(() => import('./element-window'));
const AtlasTable = dynamic(() => import('./atlas-table'));

/** Порядок групп в фильтре — по первому появлению в данных, как в оригинале. */
function groupsOf(elements: AtlasElement[]): string[] {
  return [...new Set(elements.map((e) => e.group))];
}

/** Запрос адреса Explore: фильтр (?group=) и вид (?view=table) — сохраняются при открытии и закрытии окна. */
export function useExploreQuery() {
  const params = useSearchParams();
  const group = params.get('group') ?? 'all';
  const view = params.get('view') === 'table' ? 'table' : 'cards';
  const query = (next: { group?: string; view?: string }) => {
    const p = new URLSearchParams();
    const g = next.group ?? group;
    const v = next.view ?? view;
    if (g !== 'all') p.set('group', g);
    if (v === 'table') p.set('view', 'table');
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  return { group, view: view as 'cards' | 'table', query };
}

/**
 * Explore (REQ-ATL-03): строка «Фильтр по группам», панель фильтра, сетка карточек — как в AnatomyViewer.js
 * атласа; переключатель «Карточки / Таблица» (решение 3, А-7); статус темы ученика — точка у номера (А-6).
 * Окно элемента (/explore/:code) — поверх сетки: при закрытии фильтр и прокрутка сохраняются.
 */
export default function AtlasExplore({ code, test }: { code?: string; test?: boolean }) {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const atlas = useAtlasData();
  const { group, view, query } = useExploreQuery();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const elements = useMemo(() => atlas.data?.elements ?? [], [atlas.data]);
  const groups = useMemo(() => ['all', ...groupsOf(elements)], [elements]);
  const filtered = group === 'all' ? elements : elements.filter((e) => e.group === group);
  const open = code ? elements.find((e) => e.code === code) : undefined;

  const activeColor = group === 'all' ? 'var(--text-primary, #ffffff)' : (GROUP_COLORS[group] ?? '#888');
  const activeText = group === 'all' ? t('filter.all') : t(`group.${group}`);
  const setGroup = (g: string) =>
    router.replace(`${atlasHref(subjectId, 'explore')}${query({ group: g })}`, { scroll: false });

  return (
    <section
      className="explore-section"
      id="view-explore"
      style={{ display: 'flex' }}
      data-testid="atlas-explore"
    >
      <div className="explore-filter-trigger" id="explore-filter-trigger">
        <button
          type="button"
          className="atlas-filter-open"
          aria-haspopup="dialog"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
          data-testid="atlas-filter"
        >
          <span className="explore-trigger-content">
            <span className="explore-trigger-icon" aria-hidden="true">
              ⚏
            </span>
            <span className="explore-trigger-text">{t('filter.title')}:</span>
            <span className="explore-trigger-active-val" style={{ color: activeColor }}>
              {activeText}
            </span>
          </span>
          <span className="explore-trigger-chevron" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
        <div className="atlas-view-toggle" role="group" aria-label={t('view.label')} data-testid="atlas-view">
          {(['cards', 'table'] as const).map((v) => (
            <AppLink
              key={v}
              href={`${atlasHref(subjectId, 'explore')}${query({ view: v })}`}
              scroll={false}
              replace
              className={`atlas-view-btn${view === v ? ' active' : ''}`}
              aria-current={view === v ? 'true' : undefined}
              data-view={v}
            >
              {t(`view.${v}`)}
            </AppLink>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <AtlasTable elements={elements} group={group} query={query({})} />
      ) : (
        <div className="anatomy-grid" data-testid="atlas-grid">
          {filtered.length === 0 ? (
            <p
              style={{
                color: 'var(--text-secondary)',
                padding: '40px',
                gridColumn: '1/-1',
                textAlign: 'center',
              }}
            >
              {t('filter.empty')}
            </p>
          ) : (
            filtered.map((e) => (
              <ElementCard key={e.code} element={e} href={`${elementHref(subjectId, e.code)}${query({})}`} />
            ))
          )}
        </div>
      )}

      {drawer ? (
        <FilterDrawer
          groups={groups}
          active={group}
          onSelect={(g) => {
            setDrawer(false);
            setGroup(g);
          }}
          onClose={() => setDrawer(false)}
        />
      ) : null}

      {open ? (
        <ElementWindow
          element={open}
          test={test === true}
          onClose={() => router.push(`${atlasHref(subjectId, 'explore')}${query({})}`, { scroll: false })}
        />
      ) : null}
    </section>
  );
}

/** Карточка элемента (AnatomyViewer.js, createSystemCard): вся карточка — ссылка на окно элемента. */
function ElementCard({ element: e, href }: { element: AtlasElement; href: string }) {
  const t = useTranslations('atlas');
  const tp = useTranslations('student.periodicTable');
  const groupColor = GROUP_COLORS[e.group] ?? e.color ?? '#888';
  const color = e.color ?? groupColor;
  const state = e.status === 'mastered' ? tp('mastered') : e.status === 'started' ? tp('started') : null;
  const label = [
    tp('cell', { name: e.title, symbol: e.symbol, number: e.number, family: t(`group.${e.group}`) }),
    state,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <AppLink
      href={href}
      scroll={false}
      className="anatomy-card"
      data-system={e.code}
      data-status={e.status}
      aria-label={label}
      data-testid="atlas-card"
    >
      <div
        className="card-visual"
        style={{ borderColor: `${color}40`, overflow: 'hidden', position: 'relative' }}
        aria-hidden="true"
      >
        {e.imageUrl ? (
          <img
            src={e.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={1024}
            height={1024}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.55,
              mixBlendMode: 'luminosity',
              transition: 'opacity 0.4s ease',
            }}
          />
        ) : null}
        <div
          className="element-badge"
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(6px)',
            border: `1px solid ${groupColor}40`,
            borderRadius: 8,
            padding: '4px 8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minWidth: 38,
            zIndex: 2,
          }}
        >
          <span style={{ fontSize: '0.65rem', color: groupColor, fontWeight: 700, lineHeight: 1 }}>
            {e.number}
          </span>
          <span
            style={{
              fontSize: '1rem',
              color: '#fff',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
            }}
          >
            {e.symbol}
          </span>
          {e.status === 'mastered' || e.status === 'started' ? (
            <span className="atlas-status-dot" data-status={e.status} data-testid="atlas-card-status" />
          ) : null}
        </div>
        <span
          className="group-tag"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 2,
            background: `${groupColor}20`,
            border: `1px solid ${groupColor}40`,
            color: groupColor,
            fontSize: '0.6rem',
            fontWeight: 700,
            padding: '3px 7px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(4px)',
          }}
        >
          {t(`group.${e.group}`)}
        </span>
        <div
          className="visual-placeholder"
          style={{
            background: `radial-gradient(circle at 50% 50%,${color} 0%,transparent 80%)`,
            opacity: 0.3,
          }}
        />
      </div>
      <div className="card-content">
        <h3 className="card-title">{e.title}</h3>
        <p className="card-desc">{e.description}</p>
      </div>
      <div className="card-actions">
        <span className="btn-text">{t('detail.explore')} &rarr;</span>
      </div>
    </AppLink>
  );
}

/** Панель «Фильтр по группам» (AnatomyViewer.js, openFilterDrawer): на телефоне — шторка снизу. */
function FilterDrawer({
  groups,
  active,
  onSelect,
  onClose,
}: {
  groups: string[];
  active: string;
  onSelect: (group: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('atlas');
  const tc = useTranslations('common');
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const close = () => {
    setShown(false);
    window.setTimeout(onClose, 400);
  };
  useDialog(panel, close);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 10);
    // Нажатие на фон закрывает панель (как в оригинале); с клавиатуры — Esc (useDialog).
    const node = overlay.current;
    const onClick = (e: MouseEvent) => {
      if (e.target === node) close();
    };
    node?.addEventListener('click', onClick);
    return () => {
      window.clearTimeout(id);
      node?.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- обработчик фона ставится один раз при открытии
  }, []);

  return (
    <div ref={overlay} className={`explore-drawer-overlay${shown ? ' active' : ''}`}>
      <div
        ref={panel}
        className="explore-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-filter-title"
        data-testid="atlas-filter-drawer"
      >
        <button type="button" className="explore-drawer-close" aria-label={tc('close')} onClick={close}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="explore-drawer-header">
          <h2 className="explore-drawer-title" id="atlas-filter-title">
            {t('filter.title')}
          </h2>
          <p className="explore-drawer-subtitle">{t('filter.subtitle')}</p>
        </div>
        <div className="explore-drawer-list">
          {groups.map((g) => {
            const color = g === 'all' ? '#ffffff' : (GROUP_COLORS[g] ?? '#888');
            return (
              <button
                type="button"
                key={g}
                className={`explore-drawer-item${active === g ? ' active' : ''}`}
                aria-pressed={active === g}
                style={
                  {
                    '--item-active-border': color,
                    '--item-active-color': color,
                    '--dot-glow': `${color}40`,
                  } as CSSProperties
                }
                onClick={() => onSelect(g)}
                data-group={g}
              >
                <span className="explore-drawer-item-left">
                  <span className="explore-drawer-dot" style={{ background: color }} aria-hidden="true" />
                  <span>{g === 'all' ? t('filter.all') : t(`group.${g}`)}</span>
                </span>
                <span className="explore-drawer-check" aria-hidden="true">
                  ✓
                </span>
              </button>
            );
          })}
        </div>
        <div className="explore-drawer-footer">
          <button type="button" className="explore-drawer-reset-btn" onClick={() => onSelect('all')}>
            {t('filter.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}
