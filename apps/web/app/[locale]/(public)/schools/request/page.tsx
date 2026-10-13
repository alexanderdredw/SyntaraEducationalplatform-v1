import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LinkButton, PendingBlock } from '@/components/public/blocks';

/** /schools/request (8.1.6): заголовок REQ-PUB-REQ-01; форма и отправка по SM-FORM — итерация 4. */
export default async function SchoolRequestPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  return (
    <section data-testid="school-request-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-3xl font-bold md:text-4xl">{t('schoolRequest.title')}</h1>
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
