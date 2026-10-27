'use client';

import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppLink } from '../../app-link';
import { type AtlasElement, useAtlasData, useAtlasGlossary, useAtlasSubject } from './atlas-data';
import { atlasHref, elementHref } from './routes';

/** Недавние запросы — только в браузере ученика (REQ-ATL-03); хранилище может быть недоступно. */
const RECENT_KEY = 'syntara.atlas.recentSearches';
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* приватный режим или запрет сайта — без недавних запросов */
  }
}

/** Без учёта регистра и «ё/е» (как глоссарий платформы, REQ-GLOS-03); замена посимвольная — индексы те же. */
const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е');

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;
  const hay = norm(text);
  const parts: ReactNode[] = [];
  let from = 0;
  for (let i = hay.indexOf(query); i >= 0; i = hay.indexOf(query, i + query.length)) {
    parts.push(
      text.slice(from, i),
      <mark key={i} className="search-highlight">
        {text.slice(i, i + query.length)}
      </mark>,
    );
    from = i + query.length;
  }
  parts.push(text.slice(from));
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * Поиск атласа (REQ-ATL-03, Search.js): поле с подсказкой «/», чипы «Все», «Определения» и групп, результаты —
 * элементы (название, символ, группа, номер, описание) и определения глоссария на языке интерфейса, подсветка
 * совпадений, «Показать все N определений →», «Недавние запросы». Данные — платформы (API-S-23, API-S-22);
 * запрос — в адресе (?q=).
 */
export default function AtlasSearch() {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const atlas = useAtlasData();
  const glossary = useAtlasGlossary();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [recent, setRecent] = useState<string[]>([]);

  // Запрос из адреса и недавние запросы — после загрузки в браузере.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q') ?? '';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- состояние из адреса и localStorage браузера
    setValue(q);
    setQuery(norm(q.trim()));
    setRecent(readRecent());
  }, []);

  // Задержка 120 мс, как в оригинале; запрос сохраняется в адресе и в недавних (от 2 символов).
  useEffect(() => {
    const id = window.setTimeout(() => {
      const q = value.trim();
      setQuery(norm(q));
      const url = new URL(window.location.href);
      if (q) url.searchParams.set('q', q);
      else url.searchParams.delete('q');
      window.history.replaceState(null, '', url);
      if (q.length >= 2) {
        const next = [q, ...readRecent().filter((s) => s !== q)].slice(0, 8);
        writeRecent(next);
        setRecent(next);
      }
    }, 120);
    return () => window.clearTimeout(id);
  }, [value]);

  // «/» — фокус в поле, Esc — снять фокус.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement !== input.current &&
        !(e.target instanceof HTMLInputElement)
      ) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === input.current) input.current?.blur();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const elements = useMemo(() => atlas.data?.elements ?? [], [atlas.data]);
  // Группы — по первому элементу группы; цвет чипа — цвет этого элемента (как в оригинале).
  const groups = useMemo(() => {
    const seen = new Map<string, AtlasElement>();
    for (const e of elements) if (!seen.has(e.group)) seen.set(e.group, e);
    return [...seen.values()];
  }, [elements]);

  const elementResults = useMemo(() => {
    if (filter === 'glossary') return [];
    if (!query && filter === 'all') return [];
    return elements
      .filter((e) => {
        if (filter !== 'all' && e.group !== filter) return false;
        if (!query) return true;
        return [e.title, e.description ?? '', e.symbol, t(`group.${e.group}`), String(e.number)].some((f) =>
          norm(f).includes(query),
        );
      })
      .sort((a, b) => {
        if (!query) return a.number - b.number;
        const at = norm(a.title).startsWith(query) ? 0 : 1;
        const bt = norm(b.title).startsWith(query) ? 0 : 1;
        return at - bt || a.number - b.number;
      });
  }, [elements, filter, query, t]);

  const glossaryResults = useMemo(() => {
    if (filter !== 'all' && filter !== 'glossary') return [];
    if (!query && filter === 'all') return [];
    const out: Array<{ id: string; term: string; definition: string; section: string; score: number }> = [];
    for (const s of glossary.data?.sections ?? []) {
      for (const term of s.terms) {
        const tn = norm(term.term);
        const dn = norm(term.definition);
        if (query && !tn.includes(query) && !dn.includes(query)) continue;
        out.push({
          ...term,
          section: s.title,
          score: !query ? 0 : tn.startsWith(query) ? 0 : tn.includes(query) ? 1 : 2,
        });
      }
    }
    return out.sort((a, b) => a.score - b.score);
  }, [glossary.data, filter, query]);

  const total = elementResults.length + glossaryResults.length;
  const showAll = filter === 'glossary';
  const shownGlossary = showAll ? glossaryResults : glossaryResults.slice(0, 8);
  const searching = Boolean(query) || filter !== 'all';
  let cardIndex = 0;
  const delay = (): CSSProperties => ({ animationDelay: `${cardIndex++ * 0.04}s` });

  const chip = (key: string, label: string, color: string, dot: boolean) => (
    <button
      key={key}
      type="button"
      className={`filter-chip${filter === key ? ' active' : ''}`}
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      style={
        {
          '--chip-active-color': color,
          '--chip-active-bg': key === 'all' ? 'rgba(0,122,255,0.13)' : `${color}22`,
          '--chip-active-border': key === 'all' ? 'rgba(0,122,255,0.35)' : `${color}55`,
          '--chip-active-glow': key === 'all' ? 'rgba(0,122,255,0.1)' : `${color}1a`,
        } as CSSProperties
      }
      data-filter={key}
    >
      {dot ? <span className="chip-dot" style={{ background: color }} aria-hidden="true" /> : null}
      {label}
    </button>
  );

  return (
    <section
      id="view-search"
      className="search-section"
      style={{ display: 'flex' }}
      data-testid="atlas-search"
    >
      <div className="search-hero">
        <div className="search-hero-inner fade-in-up">
          <div className="search-icon-wrap" aria-hidden="true">
            <svg
              className="search-hero-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div className="search-icon-glow" />
          </div>
          <h1 className="search-title">{t('search.title')}</h1>
          <p className="search-subtitle">{t('search.subtitle')}</p>
        </div>

        <div className="search-input-wrapper fade-in-up delay-1">
          <svg
            className="search-input-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={input}
            type="text"
            id="search-input"
            className="search-input"
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="atlas-search-input"
          />
          <div className="search-kbd-hint" aria-hidden="true" style={{ opacity: value ? 0 : 1 }}>
            <kbd>/</kbd>
          </div>
          <button
            type="button"
            className="search-clear-btn"
            style={{ display: value ? 'flex' : 'none' }}
            aria-label={t('search.clearRecent')}
            onClick={() => {
              setValue('');
              input.current?.focus();
            }}
            data-testid="atlas-search-clear"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="search-filters" id="search-filters" role="group" aria-label={t('filter.title')}>
          {chip('all', t('filter.all'), '#007aff', false)}
          {chip('glossary', t('search.definitions'), '#a78bfa', true)}
          {groups.map((g) => chip(g.group, t(`group.${g.group}`), g.color ?? '#007aff', true))}
        </div>

        <div className="search-meta fade-in-up delay-2" id="search-meta" role="status" aria-live="polite">
          {searching && total > 0 ? (
            <span className="search-result-count" data-testid="atlas-search-count">
              <strong>{total}</strong> {t('search.resultsFound')}
            </span>
          ) : null}
        </div>
      </div>

      <div id="search-results" className="search-results-grid" data-testid="atlas-search-results">
        {!searching && recent.length ? (
          <div className="recent-searches fade-in" data-testid="atlas-search-recent">
            <div className="recent-header">
              <span className="recent-label">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="16"
                  height="16"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {t('search.recent')}
              </span>
              <button
                type="button"
                className="recent-clear"
                onClick={() => {
                  writeRecent([]);
                  setRecent([]);
                }}
              >
                {t('search.clearRecent')}
              </button>
            </div>
            <div className="recent-tags">
              {recent.slice(0, 6).map((s) => (
                <button key={s} type="button" className="recent-tag" onClick={() => setValue(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {searching && total === 0 ? (
          <div className="search-empty fade-in" data-testid="atlas-search-empty">
            <div className="empty-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                width="48"
                height="48"
              >
                <circle cx="11" cy="11" r="8" opacity="0.3" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" opacity="0.3" />
                <line x1="8" y1="8" x2="14" y2="14" strokeWidth="2" />
                <line x1="14" y1="8" x2="8" y2="14" strokeWidth="2" />
              </svg>
            </div>
            <p className="empty-text">{t('search.noResults')}</p>
            <p className="empty-hint">{t('search.tryDifferent')}</p>
          </div>
        ) : null}

        {elementResults.length ? (
          <>
            {glossaryResults.length && filter === 'all' ? (
              <div className="search-section-header fade-in">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="12" cy="12" r="9" opacity="0.3" />
                </svg>
                <span>{t('search.elements')}</span>
                <span className="section-count">{elementResults.length}</span>
              </div>
            ) : null}
            {elementResults.map((e) => (
              <AppLink
                key={e.code}
                href={elementHref(subjectId, e.code)}
                className="search-result-card fade-in"
                style={delay()}
                data-testid="atlas-search-element"
              >
                <div className="result-card-header">
                  <div
                    className="element-badge"
                    aria-hidden="true"
                    style={{
                      background: `${e.color}15`,
                      borderColor: `${e.color}40`,
                      color: e.color ?? undefined,
                    }}
                  >
                    <span className="element-symbol">{e.symbol}</span>
                    <span className="element-number">{e.number}</span>
                  </div>
                  <div className="result-card-info">
                    <h4 className="result-card-title">
                      <Highlight text={e.title} query={query} />
                    </h4>
                    <span
                      className="result-card-group atlas-gtext"
                      style={{ color: e.color ?? undefined, ['--atlas-gc' as string]: e.color ?? undefined }}
                    >
                      {t(`group.${e.group}`)}
                    </span>
                  </div>
                  <svg
                    className="result-card-arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
                <p className="result-card-desc">
                  <Highlight text={truncate(e.description ?? '', 100)} query={query} />
                </p>
              </AppLink>
            ))}
          </>
        ) : null}

        {glossaryResults.length ? (
          <>
            {elementResults.length && filter === 'all' ? (
              <div className="search-section-header fade-in" style={delay()}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span>{t('search.definitions')}</span>
                <span className="section-count">{glossaryResults.length}</span>
              </div>
            ) : null}
            {shownGlossary.map((g) => (
              <AppLink
                key={g.id}
                href={`${atlasHref(subjectId, 'glossary')}#t-${g.id}`}
                className="glossary-result-card fade-in"
                style={delay()}
                data-testid="atlas-search-term"
              >
                <div className="glossary-card-header">
                  <div className="glossary-badge" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      width="20"
                      height="20"
                    >
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <div className="glossary-card-info">
                    <h4 className="glossary-card-term">
                      <Highlight text={g.term} query={query} />
                    </h4>
                    <span className="glossary-card-section">{g.section}</span>
                  </div>
                </div>
                <p className="glossary-card-def">
                  <Highlight text={g.definition} query={query} />
                </p>
              </AppLink>
            ))}
            {filter === 'all' && glossaryResults.length > shownGlossary.length ? (
              <button
                type="button"
                className="glossary-show-more fade-in"
                style={delay()}
                onClick={() => setFilter('glossary')}
                data-testid="atlas-search-more"
              >
                {t('search.showAll', { count: glossaryResults.length })}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
