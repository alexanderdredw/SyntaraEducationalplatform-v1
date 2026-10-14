import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicConfig } from '@/lib/api/server';
import { PublicChatLoader } from '@/components/ai/public-chat-loader';

/** /ai (8.1.4): слева — REQ-PUB-AI-01, справа — чат помощника (REQ-PUB-AI-01..06, API-PUB-06). */
export default async function AiPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations('ai');
  const config = await getPublicConfig();
  // BR-AI-07: кроме внутренних маршрутов разрешены только ссылки на атласы из конфигурации (PH-10).
  const atlasUrls = Object.values(config?.atlasUrls ?? {}).filter((u): u is string => typeof u === 'string');
  return (
    <section data-testid="ai-page" className="px-4 py-12 md:py-16">
      <div className="mx-auto grid max-w-[1240px] gap-8 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--accent)]">{t('label')}</p>
          <h1 className="mt-2 text-4xl font-bold md:text-6xl">{t('title')}</h1>
          <p className="mt-4 text-lg text-[var(--text-muted)]">{t('text')}</p>
        </div>
        <PublicChatLoader atlasUrls={atlasUrls} />
      </div>
    </section>
  );
}
