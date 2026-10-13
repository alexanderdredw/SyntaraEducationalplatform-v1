'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AppLink } from '../app-link';
import { usePreferences } from '../preferences/preferences-provider';

/**
 * Cookie-баннер при первом визите (REQ-PUB-LEGAL-02): «Только необходимые» и «Принять все».
 * Необязательных cookie сейчас нет; при «Только необходимые» они не будут подключаться и в будущем.
 * Высота баннера публикуется в --cookie-banner-h, чтобы плавающие кнопки его не перекрывали (REQ-GEN-SHELL-04).
 */
export function CookieBanner() {
  const t = useTranslations('cookieBanner');
  const { consent, setConsent } = usePreferences();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) {
      root.style.setProperty('--cookie-banner-h', '0px');
      return;
    }
    const update = () => root.style.setProperty('--cookie-banner-h', `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty('--cookie-banner-h', '0px');
    };
  }, [consent]);

  if (consent) return null;
  const button =
    'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-pill)] px-5 text-sm font-semibold';
  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('label')}
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
    >
      <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-4 py-4 md:flex-row md:items-center">
        <p className="flex-1 text-sm">
          {t('text')}{' '}
          <AppLink href="/cookies" className="text-[var(--accent)] underline">
            {t('more')}
          </AppLink>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConsent('necessary')}
            className={`${button} border border-[var(--border)] text-[var(--text)]`}
          >
            {t('necessary')}
          </button>
          <button
            type="button"
            onClick={() => setConsent('all')}
            className={`${button} bg-[var(--accent-strong)] text-white`}
          >
            {t('acceptAll')}
          </button>
        </div>
      </div>
    </div>
  );
}
