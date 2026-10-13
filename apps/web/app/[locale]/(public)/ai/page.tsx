import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PendingBlock } from '@/components/public/blocks';

/** /ai (8.1.4): левая часть REQ-PUB-AI-01; чат помощника (REQ-PUB-AI-01..06) — итерация 5. */
export default async function AiPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('ai');
  const common = await getTranslations('common');
  return (
    <section data-testid="ai-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto grid max-w-[1240px] gap-8 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--accent)]">{t('label')}</p>
          <h1 className="mt-2 text-4xl font-bold md:text-6xl">{t('title')}</h1>
          <p className="mt-4 text-lg text-[var(--text-muted)]">{t('text')}</p>
        </div>
        <PendingBlock text={common('sectionInDevelopment')} />
      </div>
    </section>
  );
}
