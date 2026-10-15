import { getTranslations } from 'next-intl/server';
import { cn } from '@syntara/ui';
import { AppLink } from '../app-link';

export type LegalDoc = 'terms' | 'privacy' | 'cookies';

/** Число разделов документов (REQ-PUB-LEGAL-01): соглашение — 13, политика — 13, cookie — 7. */
export const LEGAL_SECTIONS: Record<LegalDoc, number> = { terms: 13, privacy: 13, cookies: 7 };
const UPDATED = '2026-09-14';

/**
 * Шаблон правового документа (REQ-PUB-LEGAL-01, PH-14): заголовок, «Обновлено», плашка черновика,
 * нумерованные разделы, внизу «Мои данные», три документа и «← На главную». Ширина 780–900 px.
 */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const t = await getTranslations();
  const docs: LegalDoc[] = ['terms', 'privacy', 'cookies'];
  const link = 'inline-flex min-h-11 items-center text-[var(--accent)] hover:underline';
  return (
    <article data-testid={`legal-${doc}`} className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[840px]">
        <h1 className="text-page-title font-bold">{t(`legal.${doc}`)}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t('legal.updated', { date: UPDATED })}</p>
        <p
          role="note"
          data-testid="legal-draft-banner"
          className="mt-6 rounded-[var(--radius-field)] border border-[var(--danger)] px-4 py-3 text-sm font-semibold"
        >
          {t('legal.draftBanner')}
        </p>
        <ol className="mt-8 space-y-6" data-testid="legal-sections">
          {Array.from({ length: LEGAL_SECTIONS[doc] }, (_, i) => (
            <li key={i}>
              <h2 className="text-xl font-semibold">
                {i + 1}. {t('legal.section', { n: i + 1 })}
              </h2>
              <p className="mt-2 text-[var(--text-muted)]">{t('legal.sectionPlaceholder')}</p>
            </li>
          ))}
        </ol>
        <nav aria-label={t('legal.docsLabel')} className="mt-12 border-t border-[var(--border)] pt-6">
          <ul className="flex flex-wrap gap-x-6">
            <li>
              <AppLink href="/account/privacy" className={link}>
                {t('legal.myData')}
              </AppLink>
            </li>
            {docs.map((d) => (
              <li key={d}>
                <AppLink
                  href={`/${d}`}
                  aria-current={d === doc ? 'page' : undefined}
                  className={cn(link, d === doc && 'font-semibold')}
                >
                  {t(`legal.${d}`)}
                </AppLink>
              </li>
            ))}
            <li>
              <AppLink href="/" className={link}>
                {t('common.backHome')}
              </AppLink>
            </li>
          </ul>
        </nav>
      </div>
    </article>
  );
}
