import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LinkButton, PendingBlock } from '@/components/public/blocks';

/** /support (8.1.7): заголовок и подзаголовок REQ-PUB-SUP-01; форма обращения — итерация 4. */
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  return (
    <section data-testid="support-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-3xl font-bold md:text-4xl">{t('support.title')}</h1>
        <p className="mt-3 text-lg text-[var(--text-muted)]">{t('support.subtitle')}</p>
        <div className="mt-8">
          <PendingBlock text={t('common.sectionInDevelopment')} />
        </div>
        <div className="mt-8">
          <LinkButton href="/" variant="secondary">
            {t('common.backHome')}
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
