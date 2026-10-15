import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SupportCategory } from '@syntara/shared';
import { SupportForm } from '@/components/forms/support-form';

/** /support (8.1.7): REQ-PUB-SUP-01..03; `?category=` предвыбирает категорию (REQ-PUB-SCH-01). */
export default async function SupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  setRequestLocale((await params).locale);
  const t = await getTranslations();
  const raw = (await searchParams).category;
  const parsed = SupportCategory.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return (
    <section data-testid="support-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto max-w-[640px]">
        <h1 className="text-page-title font-bold">{t('support.title')}</h1>
        <p className="mt-3 text-lg text-[var(--text-muted)]">{t('support.subtitle')}</p>
        <div className="mt-8">
          <SupportForm initialCategory={parsed.success ? parsed.data : undefined} />
        </div>
      </div>
    </section>
  );
}
