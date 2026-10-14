import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SchoolRequestForm } from '@/components/forms/school-request-form';

/** /schools/request (8.1.6): заголовок и форма REQ-PUB-REQ-01..02, отправка — SM-FORM (API-PUB-04). */
export default async function SchoolRequestPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  return (
    <section data-testid="school-request-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-3xl font-bold md:text-4xl">{t('schoolRequest.title')}</h1>
        <div className="mt-8">
          <SchoolRequestForm />
        </div>
      </div>
    </section>
  );
}
