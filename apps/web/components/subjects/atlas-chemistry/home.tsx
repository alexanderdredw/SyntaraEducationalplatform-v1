'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { AppLink } from '../../app-link';
import { useAtlasData, useAtlasSubject } from './atlas-data';
import { Particles } from './particles';
import { atlasHref } from './routes';

const RANDOM = Math.random();
const randomSeed = () => RANDOM;
const noop = () => () => {};

/**
 * Главная атласа (REQ-ATL-03): «Архитектура материи», «Начать» → Explore, «Викторина» → квиз, сеть частиц и карточка
 * «А вы знали?» — случайный исправленный интересный факт элемента. Разметка и классы — как в index.html атласа.
 */
export default function AtlasHome() {
  const t = useTranslations('atlas');
  const subjectId = useAtlasSubject();
  const atlas = useAtlasData();
  const facts = useMemo(
    () => (atlas.data?.elements ?? []).flatMap((e) => (e.funFact ? [e.funFact] : [])),
    [atlas.data],
  );
  // Случайный факт — в браузере (как в оригинале); в HTML сервера — первый, без расхождения при гидратации.
  const seed = useSyncExternalStore(noop, randomSeed, () => 0);
  const index = Math.floor(seed * facts.length);

  return (
    <section className="hero-section active" id="view-home" data-testid="atlas-home">
      <Particles />
      <div className="hero-content">
        <h1 className="hero-title fade-in-up">
          {t.rich('hero.title', {
            br: () => <br />,
            accent: (chunks) => <span className="text-gradient">{chunks}</span>,
          })}
        </h1>
        <p className="hero-subtitle fade-in-up delay-1">{t('hero.subtitle')}</p>
        <div className="hero-actions fade-in-up delay-2">
          <AppLink href={atlasHref(subjectId, 'explore')} className="btn btn-primary glow-effect">
            {t('hero.start')}
          </AppLink>
          <AppLink href={atlasHref(subjectId, 'learn')} className="btn btn-secondary">
            {t('hero.quiz')}
          </AppLink>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="visual-container">
          <div className="anatomy-silhouette glow-pulse" />
        </div>
      </div>
      {facts.length ? (
        <div id="fun-fact-container" className="fun-fact-card fade-in-up delay-3" data-testid="atlas-fact">
          <div className="fact-icon" aria-hidden="true">
            💡
          </div>
          <div className="fact-content">
            <span className="fact-label">{t('fact.label')}</span>
            <p id="daily-fact">{facts[index] ?? facts[0]}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
