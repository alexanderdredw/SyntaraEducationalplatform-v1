'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAtlasGlossary } from './atlas-data';

/** Отступ от верха при переходе к разделу или термину: шапка платформы и полоса атласа. */
const OFFSET = 150;

/**
 * Глоссарий атласа «Химический лексикон» (REQ-ATL-03, app.js renderGlossary): чипы разделов, термины и
 * определения из glossary.yaml предмета (212 исправленных терминов; внутри раздела — по алфавиту, решение А-13).
 * Термин из Поиска (#t-<id>) — прокрутка и подсветка на 5 с, как в оригинале; кнопка «Наверх» — после 300 px.
 */
export default function AtlasGlossary() {
  const t = useTranslations('atlas.glossary');
  const glossary = useAtlasGlossary();
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [top, setTop] = useState(false);

  // Переход к термину из Поиска: после отрисовки — прокрутка и подсветка (navigateToGlossaryTerm оригинала).
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!glossary.data || !id.startsWith('t-')) return;
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - OFFSET, behavior: 'smooth' });
    const on = window.setTimeout(() => setSpotlight(id), 600);
    const off = window.setTimeout(() => setSpotlight(null), 5600);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [glossary.data]);

  useEffect(() => {
    const onScroll = () => setTop(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section
      id="view-glossary"
      className="glossary-section"
      style={{ display: 'flex' }}
      data-testid="atlas-glossary"
    >
      <div className="glossary-container fade-in-up">
        <h2 className="section-title">{t('title')}</h2>
        <div className="glossary-content">
          <nav className="glossary-quick-nav" aria-label={t('title')}>
            {glossary.data?.sections.map((s, i) => (
              <a
                key={s.id}
                href={`#glossary-section-${i}`}
                className="glossary-nav-chip"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(`glossary-section-${i}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {s.title}
              </a>
            ))}
          </nav>
          {glossary.data?.sections.map((s, i) => (
            <div
              key={s.id}
              className="glossary-section-wrapper"
              id={`glossary-section-${i}`}
              data-testid="atlas-glossary-section"
            >
              <h3 className="glossary-section-title">{s.title}</h3>
              <dl className="glossary-list">
                {s.terms.map((term) => (
                  <div
                    key={term.id}
                    id={`t-${term.id}`}
                    className={`glossary-term-pair${spotlight === `t-${term.id}` ? ' search-spotlight' : ''}`}
                    data-testid="atlas-glossary-term"
                  >
                    <dt>{term.term}</dt>
                    <dd>{term.definition}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        className={`glossary-scroll-top-btn${top ? ' visible' : ''}`}
        aria-label={t('top')}
        title={t('top')}
        tabIndex={top ? 0 : -1}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        data-testid="atlas-glossary-top"
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </section>
  );
}
